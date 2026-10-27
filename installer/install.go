package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const extensionID = "bmkagaljfnifdpdchjkbgehfijgecmap"

var version = "development"

type Hooks struct {
	Stop     func() error
	Register func(string) error
	Restore  func() error
}

// Stage the complete application before stopping anything. Keep the previous
// installation available until file replacement and registration both succeed.
func installPackage(source, base, arch string, hooks Hooks) error {
	if arch != "amd64" && arch != "arm64" {
		return errors.New("Требуется 64-разрядная Windows 10 или 11")
	}
	raw, err := os.ReadFile(filepath.Join(source, "payload-sha256.json"))
	if err != nil {
		return errors.New("Распакуйте весь ZIP и запустите Setup.exe из распакованной папки")
	}
	var hashes map[string]string
	if len(raw) > 128*1024 || json.Unmarshal(raw, &hashes) != nil || len(hashes) < 5 || len(hashes) > 256 {
		return errors.New("Список файлов установки повреждён; распакуйте архив заново")
	}
	if err = os.MkdirAll(base, 0700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(base, ".install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	installed := filepath.Join(base, "app")
	copied := map[string]bool{}
	paths := make([]string, 0, len(hashes))
	for p := range hashes {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, rel := range paths {
		if strings.Contains(rel, "\\") || strings.Contains(rel, ":") || strings.HasPrefix(rel, "/") || filepath.ToSlash(filepath.Clean(rel)) != rel || strings.HasPrefix(rel, "../") {
			return errors.New("Некорректный путь в установочном пакете")
		}
		destination := rel
		switch {
		case strings.HasPrefix(rel, "extension/"), strings.HasPrefix(rel, "figma-plugin/"):
		case rel == "windows/"+arch+"/send-to-figma-bridge.exe":
			destination = "bin/send-to-figma-bridge.exe"
		case strings.HasPrefix(rel, "windows/"):
			continue
		default:
			return fmt.Errorf("Неизвестный компонент установки: %s", rel)
		}
		src := filepath.Join(source, filepath.FromSlash(rel))
		info, e := os.Lstat(src)
		if e != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("Файл установки отсутствует: %s", rel)
		}
		if info.Size() > 32*1024*1024 {
			return fmt.Errorf("Слишком большой файл: %s", rel)
		}
		b, e := os.ReadFile(src)
		if e != nil {
			return e
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != hashes[rel] {
			return fmt.Errorf("Файл повреждён: %s. Распакуйте архив заново", rel)
		}
		dest := filepath.Join(stage, filepath.FromSlash(destination))
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		if e = os.WriteFile(dest, b, 0600); e != nil {
			return e
		}
		copied[destination] = true
	}
	for _, rel := range []string{"bin/send-to-figma-bridge.exe", "extension/manifest.json", "extension/background.js", "extension/setup.html", "figma-plugin/manifest.json", "figma-plugin/code.js", "figma-plugin/ui.html"} {
		if !copied[rel] {
			return fmt.Errorf("В архиве нет компонента %s", rel)
		}
	}
	var manifest struct {
		Version string `json:"version"`
		Key     string `json:"key"`
	}
	b, _ := os.ReadFile(filepath.Join(stage, "extension", "manifest.json"))
	if json.Unmarshal(b, &manifest) != nil || manifest.Version != version {
		return errors.New("Версии установщика и расширения различаются")
	}
	codePath := filepath.Join(stage, "figma-plugin", "code.js")
	code, err := os.ReadFile(codePath)
	if err != nil {
		return err
	}
	if strings.Count(string(code), installTokenMarker) != 1 {
		return errors.New("В приёмнике отсутствует настройка автоматического подключения")
	}
	token, err := installationPairing(base)
	if err != nil {
		return err
	}
	if err = os.WriteFile(codePath, []byte(strings.Replace(string(code), installTokenMarker, token, 1)), 0600); err != nil {
		return err
	}
	host := map[string]any{"name": "com.sendtofigma.bridge", "description": "Local image receiver for Figma", "path": filepath.Join(installed, "bin", "send-to-figma-bridge.exe"), "type": "stdio", "allowed_origins": []string{"chrome-extension://" + extensionID + "/"}}
	b, _ = json.MarshalIndent(host, "", "  ")
	if err = os.WriteFile(filepath.Join(stage, "native-host.json"), b, 0600); err != nil {
		return err
	}
	if err = writeGuide(filepath.Join(stage, "START-HERE.html"), installed); err != nil {
		return err
	}
	if hooks.Stop != nil {
		if err = hooks.Stop(); err != nil {
			return err
		}
	}
	backup := filepath.Join(base, ".previous-app")
	if _, e := os.Stat(backup); e == nil {
		return errors.New("Осталась предыдущая установка .previous-app. Сохраните её и обратитесь за помощью; данные не удалены")
	}
	hadPrevious := false
	if _, e := os.Stat(installed); e == nil {
		if err = os.Rename(installed, backup); err != nil {
			return err
		}
		hadPrevious = true
	}
	rollback := func(cause error) error {
		if e := os.RemoveAll(installed); e != nil {
			return fmt.Errorf("%w; возврат предыдущей версии: %v", cause, e)
		}
		if hadPrevious {
			if e := os.Rename(backup, installed); e != nil {
				return fmt.Errorf("%w; предыдущая версия сохранена в %s: %v", cause, backup, e)
			}
		}
		if hooks.Restore != nil {
			if e := hooks.Restore(); e != nil {
				return fmt.Errorf("%w; восстановление регистрации: %v", cause, e)
			}
		}
		return cause
	}
	if err = os.Rename(stage, installed); err != nil {
		if hadPrevious {
			os.Rename(backup, installed)
		}
		return err
	}
	if hooks.Register != nil {
		if err = hooks.Register(filepath.Join(installed, "native-host.json")); err != nil {
			return rollback(err)
		}
	}
	if hadPrevious {
		if err = os.RemoveAll(backup); err != nil {
			return fmt.Errorf("Программа установлена, но старая копия не удалена: %w", err)
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	if e = os.MkdirAll(filepath.Dir(dst), 0700); e != nil {
		return e
	}
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = io.Copy(out, in)
	ce := out.Close()
	if e != nil {
		return e
	}
	return ce
}
