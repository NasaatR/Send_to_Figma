package main

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultPort = 47821

type Config struct {
	Version      int    `json:"version"`
	NativeToken  string `json:"nativeToken"`
	PairingToken string `json:"pairingToken"`
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	_, e := rand.Read(b)
	return hex.EncodeToString(b), e
}
func dataDirectory() string {
	if d := os.Getenv("STF_DATA_DIR"); d != "" {
		return d
	}
	if runtime.GOOS == "windows" {
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "SendToFigma", "data")
		}
	}
	d, e := os.UserConfigDir()
	if e != nil {
		d = "."
	}
	return filepath.Join(d, "SendToFigma", "data")
}
func loadConfig(dir string) (Config, error) {
	var c Config
	if e := os.MkdirAll(dir, 0700); e != nil {
		return c, e
	}
	path := filepath.Join(dir, "config.json")
	for attempt := 0; attempt < 20; attempt++ {
		b, e := os.ReadFile(path)
		if e == nil {
			if json.Unmarshal(b, &c) == nil && c.Version == 1 && len(c.NativeToken) == 64 && len(c.PairingToken) == 64 {
				return c, nil
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if !os.IsNotExist(e) {
			return c, e
		}
		a, e := randomToken()
		if e != nil {
			return c, e
		}
		btoken, e := randomToken()
		if e != nil {
			return c, e
		}
		c = Config{Version: 1, NativeToken: a, PairingToken: btoken}
		encoded, _ := json.Marshal(c)
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if os.IsExist(e) {
			continue
		}
		if e != nil {
			return c, e
		}
		_, e = f.Write(encoded)
		if e == nil {
			e = f.Sync()
		}
		ce := f.Close()
		if e != nil {
			os.Remove(path)
			return c, e
		}
		if ce != nil {
			return c, ce
		}
		return c, nil
	}
	return c, errors.New("Не удалось прочитать код подключения. Сохраните папку данных и проверьте config.json")
}
func ReadNative(r io.Reader) ([]byte, error) {
	var h [4]byte
	if _, e := io.ReadFull(r, h[:]); e != nil {
		return nil, e
	}
	n := binary.LittleEndian.Uint32(h[:])
	if n == 0 || n > 64*1024*1024 {
		return nil, errors.New("Native message exceeds allowed size")
	}
	b := make([]byte, int(n))
	_, e := io.ReadFull(r, b)
	return b, e
}
func WriteNative(w io.Writer, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if len(b) > 1024*1024 {
		return errors.New("Native response exceeds 1 MiB")
	}
	var h [4]byte
	binary.LittleEndian.PutUint32(h[:], uint32(len(b)))
	if _, e = w.Write(h[:]); e != nil {
		return e
	}
	_, e = w.Write(b)
	return e
}
func healthy(base string) bool {
	client := http.Client{Timeout: 400 * time.Millisecond}
	r, e := client.Get(base + "/health")
	if e != nil {
		return false
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return false
	}
	var d map[string]string
	return json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&d) == nil && d["product"] == "send-to-figma" && d["version"] == version
}
func ensureServer(base, dir string, port int) error {
	if healthy(base) {
		return nil
	}
	exe, e := os.Executable()
	if e != nil {
		exe, e = filepath.Abs(os.Args[0])
	}
	if e != nil {
		return e
	}
	diagnostic, e := os.CreateTemp(dir, ".startup-*")
	if e != nil {
		return e
	}
	diagnosticPath := diagnostic.Name()
	diagnostic.Close()
	defer os.Remove(diagnosticPath)
	cmd := exec.Command(exe, "--serve", "--data-dir", dir, "--port", fmt.Sprint(port), "--startup-error-file", diagnosticPath)
	detach(cmd)
	if e = cmd.Start(); e != nil {
		return fmt.Errorf("Не удалось запустить помощник: %w", e)
	}
	cmd.Process.Release()
	for i := 0; i < 30; i++ {
		if healthy(base) {
			return nil
		}
		if b, e := os.ReadFile(diagnosticPath); e == nil && len(b) > 0 && len(b) < 8192 {
			var v struct {
				Error string `json:"error"`
			}
			if json.Unmarshal(b, &v) == nil && v.Error != "" {
				return errors.New(cleanText(v.Error, 350))
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("Локальный помощник не отвечает. Проверьте, свободен ли порт 47821, и папку данных")
}
func initializationError(e error) {
	for {
		b, readError := ReadNative(os.Stdin)
		if readError != nil {
			return
		}
		var req Request
		json.Unmarshal(b, &req)
		if WriteNative(os.Stdout, Reply{RequestID: cleanText(req.RequestID, 100), Error: cleanText(e.Error(), 350)}) != nil {
			return
		}
	}
}
func runNative(base string, c Config, dir string, port int) error {
	client := http.Client{Timeout: 40 * time.Second}
	for {
		b, e := ReadNative(os.Stdin)
		if e == io.EOF {
			return nil
		}
		if e != nil {
			return e
		}
		var req Request
		if e = json.Unmarshal(b, &req); e != nil {
			WriteNative(os.Stdout, Reply{OK: false, Error: "Некорректное сообщение расширения"})
			continue
		}
		httpReq, e := http.NewRequest("POST", base+"/rpc", bytes.NewReader(b))
		if e != nil {
			return e
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+c.NativeToken)
		res, e := client.Do(httpReq)
		// A dial failure means no request reached the server. Only that case is safe
		// to retry automatically; a timeout after writing has an unknown outcome.
		var networkError *net.OpError
		if errors.As(e, &networkError) && networkError.Op == "dial" {
			if restartError := ensureServer(base, dir, port); restartError != nil {
				e = restartError
			} else {
				httpReq, _ = http.NewRequest("POST", base+"/rpc", bytes.NewReader(b))
				httpReq.Header.Set("Content-Type", "application/json")
				httpReq.Header.Set("Authorization", "Bearer "+c.NativeToken)
				res, e = client.Do(httpReq)
			}
		}
		if e != nil {
			WriteNative(os.Stdout, Reply{RequestID: req.RequestID, Error: "Помощник временно недоступен. Откройте расширение и проверьте очередь перед повтором: " + cleanText(e.Error(), 200)})
			continue
		}
		var out Reply
		if res.StatusCode != 200 {
			out = Reply{RequestID: req.RequestID, Error: "Помощник отклонил запрос. Перезапустите браузер после переустановки"}
		} else if e = json.NewDecoder(io.LimitReader(res.Body, 1024*1024)).Decode(&out); e != nil {
			out = Reply{RequestID: req.RequestID, Error: "Некорректный ответ помощника"}
		}
		res.Body.Close()
		if e = WriteNative(os.Stdout, out); e != nil {
			return e
		}
	}
}
func main() {
	// Chrome passes its origin as a positional argument. Flags are only used by our detached server and tests.
	serve := flag.Bool("serve", false, "Run localhost receiver")
	dir := flag.String("data-dir", dataDirectory(), "Local queue directory")
	port := flag.Int("port", defaultPort, "Loopback port")
	startupErrorFile := flag.String("startup-error-file", "", "Bounded startup diagnostic")
	flag.Parse()
	startupFailure := func(e error) {
		fmt.Fprintln(os.Stderr, e)
		if *startupErrorFile != "" {
			b, _ := json.Marshal(map[string]string{"error": cleanText(e.Error(), 350)})
			atomicWrite(*startupErrorFile, b)
		}
	}
	if *port < 1024 || *port > 65535 {
		fmt.Fprintln(os.Stderr, "Invalid port")
		os.Exit(1)
	}
	cfg, e := loadConfig(*dir)
	if e != nil {
		if *serve {
			startupFailure(e)
		} else {
			initializationError(e)
		}
		return
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", *port)
	if *serve {
		listener, e := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		if e != nil {
			startupFailure(e)
			return
		}
		store, e := OpenStore(*dir)
		if e != nil {
			startupFailure(e)
			listener.Close()
			return
		}
		s := NewServer(store, cfg)
		defer s.Close()
		server := http.Server{Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 45 * time.Second, MaxHeaderBytes: 16 * 1024}
		if e = server.Serve(listener); e != nil && e != http.ErrServerClosed {
			fmt.Fprintln(os.Stderr, e)
		}
		return
	}
	if flag.NArg() > 0 && !strings.HasPrefix(flag.Arg(0), "chrome-extension://") {
		fmt.Fprintln(os.Stderr, "Use install.cmd to install this native host")
		return
	}
	if e = ensureServer(base, *dir, *port); e != nil {
		initializationError(e)
		return
	}
	if e = runNative(base, cfg, *dir, *port); e != nil {
		fmt.Fprintln(os.Stderr, e)
	}
}
