package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixturePackage(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"extension/manifest.json": `{"version":"development","key":"fixture"}`, "extension/background.js": "background", "extension/setup.html": "setup", "figma-plugin/manifest.json": "{}", "figma-plugin/code.js": `const token="__STF_INSTALL_TOKEN__";`, "figma-plugin/ui.html": "ui", "windows/amd64/send-to-figma-bridge.exe": "x64", "windows/arm64/send-to-figma-bridge.exe": "arm64",
	}
	hashes := map[string]string{}
	for p, text := range files {
		dest := filepath.Join(dir, filepath.FromSlash(p))
		os.MkdirAll(filepath.Dir(dest), 0700)
		if e := os.WriteFile(dest, []byte(text), 0600); e != nil {
			t.Fatal(e)
		}
		h := sha256.Sum256([]byte(text))
		hashes[p] = hex.EncodeToString(h[:])
	}
	b, _ := json.Marshal(hashes)
	os.WriteFile(filepath.Join(dir, "payload-sha256.json"), b, 0600)
	return dir
}
func TestInstallAndUpdatePreserveData(t *testing.T) {
	source := fixturePackage(t)
	base := filepath.Join(t.TempDir(), "Пользователь & reference", "SendToFigma")
	os.MkdirAll(filepath.Join(base, "data"), 0700)
	os.WriteFile(filepath.Join(base, "data", "queue.json"), []byte("keep queue"), 0600)
	registered := ""
	hooks := Hooks{Register: func(p string) error { registered = p; return nil }}
	for i := 0; i < 2; i++ {
		if e := installPackage(source, base, "amd64", hooks); e != nil {
			t.Fatal(e)
		}
	}
	b, _ := os.ReadFile(filepath.Join(base, "app", "bin", "send-to-figma-bridge.exe"))
	if string(b) != "x64" {
		t.Fatal("Wrong binary")
	}
	b, _ = os.ReadFile(filepath.Join(base, "data", "queue.json"))
	if string(b) != "keep queue" {
		t.Fatal("Data changed")
	}
	if registered != filepath.Join(base, "app", "native-host.json") {
		t.Fatal("Wrong registry target")
	}
	b, _ = os.ReadFile(registered)
	var host map[string]any
	if json.Unmarshal(b, &host) != nil {
		t.Fatal("Bad manifest")
	}
	if host["path"] != filepath.Join(base, "app", "bin", "send-to-figma-bridge.exe") {
		t.Fatal("Staged path leaked")
	}
	b, _ = os.ReadFile(filepath.Join(base, "app", "START-HERE.html"))
	if !strings.Contains(string(b), "&amp;") {
		t.Fatal("Guide paths must be HTML escaped")
	}
}
func TestCorruptPackageDoesNotStopOrChangeInstalledApp(t *testing.T) {
	source := fixturePackage(t)
	base := t.TempDir()
	os.MkdirAll(filepath.Join(base, "app"), 0700)
	os.WriteFile(filepath.Join(base, "app", "old"), []byte("previous"), 0600)
	os.WriteFile(filepath.Join(source, "extension", "setup.html"), []byte("changed"), 0600)
	stopped := false
	e := installPackage(source, base, "amd64", Hooks{Stop: func() error { stopped = true; return nil }})
	if e == nil || stopped {
		t.Fatal("Corrupt source reached mutation phase")
	}
	if _, e = os.Stat(filepath.Join(base, "app", "old")); e != nil {
		t.Fatal(e)
	}
}
func TestRegistrationFailureRollsBackApplication(t *testing.T) {
	source := fixturePackage(t)
	base := t.TempDir()
	os.MkdirAll(filepath.Join(base, "app"), 0700)
	os.WriteFile(filepath.Join(base, "app", "old"), []byte("previous"), 0600)
	restored := false
	e := installPackage(source, base, "amd64", Hooks{Register: func(string) error { return errors.New("registry denied") }, Restore: func() error { restored = true; return nil }})
	if e == nil || !restored {
		t.Fatal("Missing rollback")
	}
	b, _ := os.ReadFile(filepath.Join(base, "app", "old"))
	if string(b) != "previous" {
		t.Fatal("Previous app lost")
	}
	if _, e = os.Stat(filepath.Join(base, "app", "extension")); !os.IsNotExist(e) {
		t.Fatal("Failed version remained")
	}
}
func TestPackageRejectsTraversalAndWrongArchitecture(t *testing.T) {
	source := fixturePackage(t)
	raw, _ := os.ReadFile(filepath.Join(source, "payload-sha256.json"))
	var hashes map[string]string
	json.Unmarshal(raw, &hashes)
	hashes["../outside"] = "abc"
	raw, _ = json.Marshal(hashes)
	os.WriteFile(filepath.Join(source, "payload-sha256.json"), raw, 0600)
	if e := installPackage(source, t.TempDir(), "amd64", Hooks{}); e == nil {
		t.Fatal("Traversal accepted")
	}
	if e := installPackage(fixturePackage(t), t.TempDir(), "386", Hooks{}); e == nil {
		t.Fatal("Unsupported architecture accepted")
	}
}
func TestARM64ChoosesNativeHelper(t *testing.T) {
	base := t.TempDir()
	if e := installPackage(fixturePackage(t), base, "arm64", Hooks{}); e != nil {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(filepath.Join(base, "app", "bin", "send-to-figma-bridge.exe"))
	if string(b) != "arm64" {
		t.Fatal("Wrong helper")
	}
}

func TestPairingProvisionedOnlyInInstalledBundleAndPreserved(t *testing.T) {
	source, base := fixturePackage(t), t.TempDir()
	if e := installPackage(source, base, "amd64", Hooks{}); e != nil {
		t.Fatal(e)
	}
	token, e := installationPairing(base)
	if e != nil {
		t.Fatal(e)
	}
	if !tokenPattern.MatchString(token) {
		t.Fatal("Missing random pairing token")
	}
	original, _ := os.ReadFile(filepath.Join(source, "figma-plugin", "code.js"))
	installed, _ := os.ReadFile(filepath.Join(base, "app", "figma-plugin", "code.js"))
	if !strings.Contains(string(original), installTokenMarker) || strings.Contains(string(original), token) {
		t.Fatal("Shared package contains machine credentials")
	}
	if !strings.Contains(string(installed), token) || strings.Contains(string(installed), installTokenMarker) {
		t.Fatal("Installed receiver not provisioned")
	}
	before, _ := os.ReadFile(filepath.Join(base, "data", "config.json"))
	if e = installPackage(source, base, "amd64", Hooks{}); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(filepath.Join(base, "data", "config.json"))
	if string(before) != string(after) {
		t.Fatal("Update rotated existing credentials")
	}
	other, e := installationPairing(t.TempDir())
	if e != nil || other == token {
		t.Fatal("Machines share credentials")
	}
}
func TestPairingRejectsCorruptConfigWithoutReplacingAppOrData(t *testing.T) {
	source, base := fixturePackage(t), t.TempDir()
	os.MkdirAll(filepath.Join(base, "data"), 0700)
	os.WriteFile(filepath.Join(base, "data", "config.json"), []byte("damaged"), 0600)
	stopped := false
	e := installPackage(source, base, "amd64", Hooks{Stop: func() error { stopped = true; return nil }})
	if e == nil || stopped {
		t.Fatal("Corrupt credentials reached mutation phase")
	}
	b, _ := os.ReadFile(filepath.Join(base, "data", "config.json"))
	if string(b) != "damaged" {
		t.Fatal("Credentials overwritten")
	}
}
