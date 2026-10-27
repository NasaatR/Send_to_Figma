//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func pinWindowsPath(t *testing.T, path string, directory bool) {
	t.Helper()
	flags := uint32(0)
	share := uint32(syscall.FILE_SHARE_READ)
	if directory {
		flags = syscall.FILE_FLAG_BACKUP_SEMANTICS
		share |= syscall.FILE_SHARE_WRITE
	}
	p, e := syscall.UTF16PtrFromString(path)
	if e != nil {
		t.Fatal(e)
	}
	h, e := syscall.CreateFile(p, syscall.GENERIC_READ, share, nil, syscall.OPEN_EXISTING, flags, 0)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { syscall.CloseHandle(h) })
}
func replaceFixtureFile(t *testing.T, source, rel, data string) {
	t.Helper()
	writeUpdateFixture(t, source, rel, data)
	p := filepath.Join(source, "payload-sha256.json")
	raw, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	var hashes map[string]string
	if e = json.Unmarshal(raw, &hashes); e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256([]byte(data))
	hashes[rel] = hex.EncodeToString(h[:])
	raw, _ = json.Marshal(hashes)
	if e = os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
}
func pinnedInstallation(t *testing.T) (string, string) {
	t.Helper()
	source, base := fixturePackage(t), t.TempDir()
	if e := installPackage(source, base, "amd64", Hooks{}); e != nil {
		t.Fatal(e)
	}
	app := filepath.Join(base, "app")
	pinWindowsPath(t, app, true)
	pinWindowsPath(t, filepath.Join(app, "extension"), true)
	// Prove the same directory rename from the reported failure is prohibited.
	probe := filepath.Join(base, "rename-probe")
	if e := os.Rename(app, probe); e == nil {
		os.Rename(probe, app)
		t.Fatal("Directory lock did not reproduce the reported condition")
	}
	return source, base
}
func TestWindowsPinnedDirectoryUpdateSucceedsWithoutMovingApp(t *testing.T) {
	source, base := pinnedInstallation(t)
	before, _ := os.ReadFile(filepath.Join(base, "data", "config.json"))
	replaceFixtureFile(t, source, "extension/background.js", "updated")
	if e := installPackage(source, base, "amd64", Hooks{}); e != nil {
		t.Fatal(e)
	}
	requireUpdateFile(t, filepath.Join(base, "app"), "extension/background.js", "updated")
	after, _ := os.ReadFile(filepath.Join(base, "data", "config.json"))
	if string(before) != string(after) {
		t.Fatal("Credentials changed")
	}
}
func TestWindowsPinnedDirectoryRegistrationFailureRollsBack(t *testing.T) {
	source, base := pinnedInstallation(t)
	replaceFixtureFile(t, source, "extension/background.js", "updated")
	restored := false
	e := installPackage(source, base, "amd64", Hooks{Register: func(string) error { return errors.New("registry denied") }, Restore: func() error { restored = true; return nil }})
	if e == nil || !restored {
		t.Fatal("Missing rollback")
	}
	requireUpdateFile(t, filepath.Join(base, "app"), "extension/background.js", "background")
}
func TestWindowsLockedFileAbortsWithoutDamagingPreviousVersion(t *testing.T) {
	source, base := pinnedInstallation(t)
	pinWindowsPath(t, filepath.Join(base, "app", "extension", "background.js"), false)
	replaceFixtureFile(t, source, "extension/background.js", "updated")
	e := installPackage(source, base, "amd64", Hooks{})
	if e == nil || !strings.Contains(e.Error(), "Chrome, Edge и Figma") {
		t.Fatal("Locked file was not reported clearly")
	}
	requireUpdateFile(t, filepath.Join(base, "app"), "extension/background.js", "background")
	requireUpdateFile(t, filepath.Join(base, "app"), "bin/send-to-figma-bridge.exe", "x64")
}
