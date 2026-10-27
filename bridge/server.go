package main

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var version = "development"

type Request struct {
	RequestID string          `json:"requestId"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
}
type Reply struct {
	RequestID string `json:"requestId"`
	OK        bool   `json:"ok"`
	Data      any    `json:"data,omitempty"`
	Error     string `json:"error,omitempty"`
}
type receiver struct {
	instanceID string
	info       ReceiverInfo
	conn       *websocket.Conn
	writeMu    sync.Mutex
	stop       chan struct{}
	once       sync.Once
	acks       chan receiverMessage
}
type receiverMessage struct {
	InstanceID string `json:"instanceId"`
	Type       string `json:"type"`
	Token      string `json:"token"`
	TargetID   string `json:"targetId"`
	Label      string `json:"label"`
	ID         string `json:"id"`
	OK         bool   `json:"ok"`
	NodeID     string `json:"nodeId"`
	Error      string `json:"error"`
}

func (r *receiver) close() { r.once.Do(func() { close(r.stop); r.conn.Close() }) }
func (r *receiver) write(v any) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	r.conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
	return r.conn.WriteJSON(v)
}
func (r *receiver) ping() error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	return r.conn.WriteControl(websocket.PingMessage, []byte("alive"), time.Now().Add(5*time.Second))
}

type Server struct {
	store     *Store
	config    Config
	mu        sync.Mutex
	receivers map[string]*receiver
	stop      chan struct{}
	once      sync.Once
	workers   sync.WaitGroup
}

func NewServer(store *Store, c Config) *Server {
	s := &Server{store: store, config: c, receivers: map[string]*receiver{}, stop: make(chan struct{})}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-s.stop:
				return
			case now := <-ticker.C:
				s.store.ExpireCaptures(now)
			}
		}
	}()
	return s
}
func (s *Server) Close() {
	s.once.Do(func() {
		close(s.stop)
		s.mu.Lock()
		for _, r := range s.receivers {
			r.close()
		}
		s.mu.Unlock()
		s.workers.Wait()
	})
}
func tokenEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func (s *Server) status(includeToken bool) Status {
	out := s.store.Snapshot()
	s.mu.Lock()
	for _, r := range s.receivers {
		out.Receivers = append(out.Receivers, r.info)
	}
	s.mu.Unlock()
	if includeToken {
		out.PairingToken = s.config.PairingToken
	}
	return out
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		writeJSON(w, 200, map[string]string{"product": "send-to-figma", "version": version, "pid": fmt.Sprint(os.Getpid())})
	})
	mux.HandleFunc("/rpc", s.rpc)
	mux.HandleFunc("/receiver", s.receive)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, e := net.SplitHostPort(host); e == nil {
			host = h
		}
		if host != "127.0.0.1" && host != "localhost" && host != "::1" {
			http.Error(w, "Invalid host", 403)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func (s *Server) rpc(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	if r.Header.Get("Origin") != "" || !tokenEqual(r.Header.Get("Authorization"), "Bearer "+s.config.NativeToken) {
		http.Error(w, "Unauthorized", 401)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 30*1024*1024)
	var req Request
	dec := json.NewDecoder(r.Body)
	if e := dec.Decode(&req); e != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	var extra any
	if e := dec.Decode(&extra); e != io.EOF {
		http.Error(w, "Invalid trailing data", 400)
		return
	}
	writeJSON(w, 200, s.Handle(req))
}
func (s *Server) Handle(req Request) Reply {
	reply := Reply{RequestID: cleanText(req.RequestID, 100)}
	var result any
	var e error
	switch req.Type {
	case "installation":
		exe, err := os.Executable()
		if err != nil {
			e = err
			break
		}
		appDir := filepath.Dir(filepath.Dir(exe))
		result = map[string]string{"extensionPath": filepath.Join(appDir, "extension"), "pluginPath": filepath.Join(appDir, "figma-plugin", "manifest.json"), "version": version}
	case "status":
		s.store.ExpireCaptures(time.Now())
		result = s.status(true)
	case "pause":
		var in struct {
			Paused *bool `json:"paused"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			if in.Paused == nil {
				e = errors.New("Укажите состояние паузы")
			} else {
				e = s.store.Pause(*in.Paused)
				result = s.status(false)
			}
		}
	case "batch":
		var in struct {
			Operation string   `json:"operation"`
			IDs       []string `json:"ids"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			result, e = s.store.Batch(in.Operation, in.IDs)
		}
	case "thumbnail", "source":
		var in struct {
			ID string `json:"id"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			if req.Type == "thumbnail" {
				var data string
				data, e = s.store.Preview(in.ID)
				result = map[string]string{"data": data}
			} else {
				var link string
				link, e = s.store.Source(in.ID)
				result = map[string]string{"url": link}
			}
		}
	case "begin_capture":
		var in struct {
			ID string `json:"id"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			result, e = s.store.BeginCapture(in.ID)
		}
	case "reserve":
		var in ReserveInput
		if e = json.Unmarshal(req.Data, &in); e == nil {
			result, e = s.store.Reserve(in)
		}
	case "upload":
		var in struct {
			ID          string `json:"id"`
			Data        string `json:"data"`
			Mime        string `json:"mime"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			CaptureMode string `json:"captureMode"`
			Preview     string `json:"preview"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			var data []byte
			data, e = base64.StdEncoding.DecodeString(in.Data)
			if e == nil {
				result, e = s.store.Upload(in.ID, data, in.Mime, in.Width, in.Height, UploadOptions{CaptureMode: in.CaptureMode, Preview: in.Preview})
			}
		}
	case "fail", "cancel", "retry":
		var in struct {
			ID    string `json:"id"`
			Error string `json:"error"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			switch req.Type {
			case "fail":
				e = s.store.CaptureFailed(in.ID, in.Error)
			case "cancel":
				e = s.store.Cancel(in.ID)
			case "retry":
				e = s.store.Retry(in.ID)
			}
			result = s.status(false)
		}
	case "destination":
		var in struct {
			TargetID string `json:"targetId"`
		}
		if e = json.Unmarshal(req.Data, &in); e == nil {
			s.mu.Lock()
			r := s.receivers[in.TargetID]
			s.mu.Unlock()
			if r == nil {
				e = errors.New("Приёмник не подключён. Запустите плагин в нужном файле")
			} else {
				e = s.store.Destination(r.info.TargetID, r.info.Label)
				result = s.status(false)
			}
		}
	default:
		e = errors.New("Неизвестная команда")
	}
	if e != nil {
		reply.Error = cleanText(e.Error(), 350)
		return reply
	}
	reply.OK = true
	reply.Data = result
	return reply
}
func (s *Server) receiverStatus() Status { return s.store.Summary() }
func (s *Server) receive(w http.ResponseWriter, req *http.Request) {
	up := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 65536, CheckOrigin: func(r *http.Request) bool {
		o := r.Header.Get("Origin")
		return o == "null" || o == "https://www.figma.com" || o == "https://figma.com"
	}}
	c, e := up.Upgrade(w, req, nil)
	if e != nil {
		return
	}
	c.SetReadLimit(1024 * 1024)
	c.SetReadDeadline(time.Now().Add(7 * time.Second))
	var hello receiverMessage
	if e = c.ReadJSON(&hello); e != nil || hello.Type != "hello" || !tokenEqual(hello.Token, s.config.PairingToken) || !validID.MatchString(hello.TargetID) || (hello.InstanceID != "" && !validID.MatchString(hello.InstanceID)) {
		c.WriteJSON(map[string]string{"type": "error", "error": "Код подключения неверен. Скопируйте его из расширения"})
		c.Close()
		return
	}
	r := &receiver{instanceID: hello.InstanceID, info: ReceiverInfo{TargetID: hello.TargetID, Label: cleanText(hello.Label, 240), Connected: true}, conn: c, stop: make(chan struct{}), acks: make(chan receiverMessage, 8)}
	s.mu.Lock()
	old := s.receivers[hello.TargetID]
	if old != nil && (hello.InstanceID == "" || old.instanceID != hello.InstanceID) {
		s.mu.Unlock()
		r.write(map[string]string{"type": "error", "code": "target-in-use", "error": "Эта коллекция уже подключена в другом приёмнике. Остановите его или создайте новую коллекцию в копии файла"})
		r.close()
		return
	}
	s.receivers[hello.TargetID] = r
	s.mu.Unlock()
	if old != nil {
		old.close()
	}
	defer func() {
		r.close()
		s.mu.Lock()
		if s.receivers[hello.TargetID] == r {
			delete(s.receivers, hello.TargetID)
		}
		s.mu.Unlock()
	}()
	s.mu.Lock()
	current := s.store.Summary()
	activeDestination := s.receivers[current.TargetID] != nil
	if current.TargetID == "" || !activeDestination {
		// First-use captures have no destination yet. The first receiver owns
		// them; already assigned jobs always keep their original destination.
		if current.TargetID == "" {
			e = s.store.Claim(r.info.TargetID, r.info.Label)
		} else {
			e = s.store.Destination(r.info.TargetID, r.info.Label)
		}
	}
	s.mu.Unlock()
	if e != nil {
		r.write(map[string]string{"type": "error", "error": e.Error()})
		return
	}
	c.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.SetPongHandler(func(string) error { return c.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	if e = r.write(map[string]any{"type": "connected", "targetId": hello.TargetID, "status": s.receiverStatus()}); e != nil {
		return
	}
	s.workers.Add(1)
	go func() { defer s.workers.Done(); s.dispatch(r) }()
	for {
		var m receiverMessage
		if e = c.ReadJSON(&m); e != nil {
			return
		}
		c.SetReadDeadline(time.Now().Add(60 * time.Second))
		switch m.Type {
		case "ack":
			select {
			case r.acks <- m:
			default:
				return
			}
		case "claim":
			if e = s.store.Claim(r.info.TargetID, r.info.Label); e != nil {
				r.write(map[string]string{"type": "error", "error": e.Error()})
			}
			r.write(map[string]any{"type": "status", "status": s.receiverStatus()})
		case "activate":
			if e = s.store.Destination(r.info.TargetID, r.info.Label); e != nil {
				r.write(map[string]string{"type": "error", "error": e.Error()})
			}
			r.write(map[string]any{"type": "status", "status": s.receiverStatus()})
		case "status":
			r.write(map[string]any{"type": "status", "status": s.receiverStatus()})
		default:
			r.write(map[string]string{"type": "error", "error": "Неизвестное сообщение приёмника"})
		}
	}
}
func (s *Server) dispatch(r *receiver) {
	ticker := time.NewTicker(250 * time.Millisecond)
	ping := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer ping.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-s.stop:
			return
		case <-ping.C:
			if r.ping() != nil {
				r.close()
				return
			}
		case <-ticker.C:
			d, e := s.store.Lease(r.info.TargetID)
			if e != nil {
				r.write(map[string]string{"type": "error", "error": e.Error()})
				continue
			}
			if d == nil {
				continue
			}
			if e = r.write(map[string]any{"type": "image", "job": d}); e != nil {
				s.store.Release(d.ID)
				r.close()
				return
			}
			timer := time.NewTimer(35 * time.Second)
			finished := false
			for !finished {
				select {
				case <-r.stop:
					s.store.Release(d.ID)
					timer.Stop()
					return
				case <-s.stop:
					s.store.Release(d.ID)
					timer.Stop()
					return
				case <-timer.C:
					s.store.Release(d.ID)
					r.close()
					return
				case ack := <-r.acks:
					if ack.ID != d.ID {
						continue
					}
					if ack.OK {
						e = s.store.Ack(d.ID, ack.NodeID)
					} else {
						message := ack.Error
						if message == "" {
							message = "Не удалось вставить изображение в Figma"
						}
						e = s.store.Fail(d.ID, message)
					}
					if e != nil {
						r.write(map[string]string{"type": "error", "error": fmt.Sprintf("Вставка выполнена, но очередь не сохранена: %s", e)})
						s.store.Release(d.ID)
						r.close()
						timer.Stop()
						return
					}
					finished = true
					timer.Stop()
					r.write(map[string]any{"type": "status", "status": s.receiverStatus()})
				}
			}
		}
	}
}
