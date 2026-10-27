package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
)

const installTokenMarker = "__STF_INSTALL_TOKEN__"

var tokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Only the per-user installed bundle receives this token. The distributable ZIP
// keeps its placeholder and can safely be shared with another computer.
func installationPairing(base string) (string, error) {
	dir := filepath.Join(base, "data")
	if e := os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	path := filepath.Join(dir, "config.json")
	read := func() (string, error) {
		info, e := os.Lstat(path)
		if e != nil {
			return "", e
		}
		if !info.Mode().IsRegular() || info.Size() > 8192 {
			return "", errors.New("Некорректный config.json; данные не изменены")
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return "", e
		}
		var c struct {
			Version int    `json:"version"`
			Native  string `json:"nativeToken"`
			Pairing string `json:"pairingToken"`
		}
		if json.Unmarshal(b, &c) != nil || c.Version != 1 || !tokenPattern.MatchString(c.Native) || !tokenPattern.MatchString(c.Pairing) {
			return "", errors.New("Не удалось прочитать config.json. Сохраните папку данных; существующие коды не заменены")
		}
		return c.Pairing, nil
	}
	if token, e := read(); e == nil {
		return token, nil
	} else if !os.IsNotExist(e) {
		return "", e
	}
	secret := make([]byte, 64)
	if _, e := rand.Read(secret); e != nil {
		return "", e
	}
	native, pairing := hex.EncodeToString(secret[:32]), hex.EncodeToString(secret[32:])
	b, _ := json.Marshal(map[string]any{"version": 1, "nativeToken": native, "pairingToken": pairing})
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(e) {
		return read()
	}
	if e != nil {
		return "", e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return "", e
	}
	if ce != nil {
		return "", ce
	}
	return pairing, nil
}
