package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeUpdateFixture(t *testing.T, root, rel, data string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(data), 0600); e != nil {
		t.Fatal(e)
	}
}
func requireUpdateFile(t *testing.T, root, rel, expected string) {
	t.Helper()
	b, e := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if e != nil || string(b) != expected {
		t.Fatalf("Wrong contents for %s: %v", rel, e)
	}
}
func TestInPlaceUpdatePreservesDirectoriesDataAndUnrelatedFiles(t *testing.T) {
	base := t.TempDir()
	app, stage := filepath.Join(base, "app"), filepath.Join(base, "stage")
	writeUpdateFixture(t, app, "extension/background.js", "old")
	writeUpdateFixture(t, app, "custom.txt", "keep")
	writeUpdateFixture(t, base, "data/queue.json", "queue")
	writeUpdateFixture(t, base, "data/config.json", "pairing")
	writeUpdateFixture(t, stage, "extension/background.js", "new")
	writeUpdateFixture(t, stage, "figma-plugin/code.js", "receiver")
	before, e := os.Stat(app)
	if e != nil {
		t.Fatal(e)
	}
	registered := ""
	if e = updateInPlace(stage, app, base, Hooks{Register: func(p string) error { registered = p; return nil }}); e != nil {
		t.Fatal(e)
	}
	after, _ := os.Stat(app)
	if !os.SameFile(before, after) {
		t.Fatal("App directory was replaced")
	}
	requireUpdateFile(t, app, "extension/background.js", "new")
	requireUpdateFile(t, app, "custom.txt", "keep")
	requireUpdateFile(t, app, "figma-plugin/code.js", "receiver")
	requireUpdateFile(t, base, "data/queue.json", "queue")
	requireUpdateFile(t, base, "data/config.json", "pairing")
	if registered != filepath.Join(app, "native-host.json") {
		t.Fatal("Registration path changed")
	}
	backups, _ := filepath.Glob(filepath.Join(base, ".update-backup-*"))
	if len(backups) != 0 {
		t.Fatal("Successful backup not cleaned")
	}
}
func TestInPlaceRegistrationFailureRestoresFilesAndRemovesNewFiles(t *testing.T) {
	base := t.TempDir()
	app, stage := filepath.Join(base, "app"), filepath.Join(base, "stage")
	writeUpdateFixture(t, app, "extension/background.js", "old")
	writeUpdateFixture(t, stage, "extension/background.js", "new")
	writeUpdateFixture(t, stage, "figma-plugin/code.js", "new file")
	restored := false
	e := updateInPlace(stage, app, base, Hooks{Register: func(string) error { return errors.New("registry denied") }, Restore: func() error { restored = true; return nil }})
	if e == nil || !restored {
		t.Fatal("Failed registration not rolled back")
	}
	requireUpdateFile(t, app, "extension/background.js", "old")
	if _, e = os.Stat(filepath.Join(app, "figma-plugin")); !os.IsNotExist(e) {
		t.Fatal("New files/directories remained")
	}
}
func TestInPlacePreflightFailureDoesNotChangeAnyExistingFile(t *testing.T) {
	base := t.TempDir()
	app, stage := filepath.Join(base, "app"), filepath.Join(base, "stage")
	writeUpdateFixture(t, app, "a.txt", "old")
	if e := os.MkdirAll(filepath.Join(app, "z.txt"), 0700); e != nil {
		t.Fatal(e)
	}
	writeUpdateFixture(t, stage, "a.txt", "new")
	writeUpdateFixture(t, stage, "z.txt", "new")
	e := updateInPlace(stage, app, base, Hooks{})
	if e == nil || !strings.Contains(e.Error(), "Chrome, Edge и Figma") {
		t.Fatal("Missing actionable error")
	}
	requireUpdateFile(t, app, "a.txt", "old")
}
