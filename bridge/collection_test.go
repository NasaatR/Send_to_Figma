package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPreviewPersistsAfterACKWithoutPayloadOrLargeStatus(t *testing.T) {
	dir := t.TempDir()
	s, _ := OpenStore(dir)
	s.Destination("collection-preview", "Preview")
	reserve(t, s, "request-preview")
	data := fixturePNG(t)
	encoded := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	job, e := s.Upload("request-preview", data, "image/png", 12, 8, UploadOptions{Preview: encoded})
	if e != nil || !job.HasPreview {
		t.Fatal("preview not saved", e)
	}
	d, e := s.Lease("collection-preview")
	if e != nil || d == nil {
		t.Fatal(e)
	}
	if e = s.Ack(d.ID, "1:2"); e != nil {
		t.Fatal(e)
	}
	recovered, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	preview, e := recovered.Preview(d.ID)
	if e != nil || preview != encoded {
		t.Fatal("preview lost on ACK/restart", e)
	}
	if _, e = os.Stat(filepath.Join(dir, "images", d.ID+".bin")); !os.IsNotExist(e) {
		t.Fatal("original retained after ACK")
	}
	b, _ := json.Marshal(recovered.Snapshot())
	if strings.Contains(string(b), base64.StdEncoding.EncodeToString(data)) {
		t.Fatal("preview leaked into status")
	}
	result, e := recovered.Batch("clear_history", nil)
	if e != nil || result.Changed != 1 {
		t.Fatal(result, e)
	}
	if _, e = os.Stat(filepath.Join(dir, "previews", d.ID+".bin")); !os.IsNotExist(e) {
		t.Fatal("history cleanup retained preview")
	}
}
func TestPreviewInvalidDataCannotBreakOriginalUpload(t *testing.T) {
	s := newStore(t)
	reserve(t, s, "request-invalid")
	j, e := s.Upload("request-invalid", fixturePNG(t), "image/png", 12, 8, UploadOptions{Preview: "data:image/svg+xml;base64," + strings.Repeat("a", 17000)})
	if e != nil || j.Status != "ready" || j.HasPreview {
		t.Fatal(j, e)
	}
	if _, e = s.Preview("../../elsewhere"); e == nil {
		t.Fatal("unknown preview path accepted")
	}
}
func TestPauseSurvivesRestartAndCompletesInflight(t *testing.T) {
	dir := t.TempDir()
	s, _ := OpenStore(dir)
	s.Destination("collection-pause", "P")
	for _, id := range []string{"request-first", "request-second"} {
		reserve(t, s, id)
		upload(t, s, id)
	}
	first, _ := s.Lease("collection-pause")
	if e := s.Pause(true); e != nil {
		t.Fatal(e)
	}
	if e := s.Ack(first.ID, "1:2"); e != nil {
		t.Fatal(e)
	}
	s, e := OpenStore(dir)
	if e != nil || !s.Snapshot().Paused {
		t.Fatal(e)
	}
	if d, e := s.Lease("collection-pause"); e != nil || d != nil {
		t.Fatal("paused queue delivered", d, e)
	}
	s.Pause(false)
	d, e := s.Lease("collection-pause")
	if e != nil || d.ID != "request-second" {
		t.Fatal(d, e)
	}
}
func TestBatchCancelDoesNotCancelInflightAndRetryRetainsDestination(t *testing.T) {
	s := newStore(t)
	s.Destination("collection-original", "Original")
	for _, id := range []string{"request-first", "request-second", "request-third"} {
		reserve(t, s, id)
		upload(t, s, id)
	}
	s.Lease("collection-original")
	s.Fail("request-second", "failed")
	s.Destination("collection-other", "Other")
	result, e := s.Batch("retry", []string{"request-second", "request-first"})
	if e != nil || result.Changed != 1 || result.Skipped != 1 {
		t.Fatal(result, e)
	}
	if j, _ := s.find("request-second"); j.TargetID != "collection-original" || j.Sequence != 2 {
		t.Fatal("retry moved destination/order")
	}
	result, e = s.Batch("cancel", []string{"request-first", "request-second", "request-third"})
	if e != nil || result.Changed != 2 || result.Skipped != 1 {
		t.Fatal(result, e)
	}
	if j, _ := s.find("request-first"); j.Status != "inflight" {
		t.Fatal("inflight canceled")
	}
	result, e = s.Batch("clear_history", nil)
	if e != nil || result.Changed != 2 || s.Snapshot().Pending != 1 {
		t.Fatal(result, e)
	}
}
func TestSourceRemovesCredentialsQueryAndFragment(t *testing.T) {
	s := newStore(t)
	s.Reserve(ReserveInput{ID: "request-source", PageURL: "https://user:secret@example.com/path?token=secret#private"})
	link, e := s.Source("request-source")
	if e != nil || link != "https://example.com/path" {
		t.Fatal(link, e)
	}
	s.Reserve(ReserveInput{ID: "request-invalid", PageURL: "javascript:alert(1)"})
	if _, e = s.Source("request-invalid"); e == nil {
		t.Fatal("unsafe source")
	}
}
func TestLegacyQueueWithoutPreviewOrPauseMigratesAdditively(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "queue.json"), []byte(`{"version":1,"next":2,"targetId":"collection-legacy","jobs":[{"id":"request-legacy","sequence":1,"status":"capturing","size":0,"createdAt":"2026-10-23T00:00:00Z","updatedAt":"2026-10-23T00:00:00Z"}]}`), 0600)
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	status := s.Snapshot()
	if status.Paused || status.Jobs[0].HasPreview || status.Jobs[0].ID != "request-legacy" {
		t.Fatal(status)
	}
	s.ExpireCaptures(time.Now())
	if s.Snapshot().Failed != 1 {
		t.Fatal("legacy expiry did not work")
	}
}
func newStore(t *testing.T) *Store {
	t.Helper()
	s, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestBatchFailureRollsBackStateAndRetainsPayload(t *testing.T) {
	s := newStore(t)
	reserve(t, s, "request-rollback")
	upload(t, s, "request-rollback")
	os.Remove(filepath.Join(s.dir, "queue.json"))
	os.Mkdir(filepath.Join(s.dir, "queue.json"), 0700)
	if _, e := s.Batch("cancel", []string{"request-rollback"}); e == nil {
		t.Fatal("expected disk failure")
	}
	j, _ := s.find("request-rollback")
	if j.Status != "ready" {
		t.Fatal("partial state committed")
	}
	if _, e := os.Stat(filepath.Join(s.dir, "images", j.ID+".bin")); e != nil {
		t.Fatal("payload deleted before commit")
	}
}
func TestDeferredCaptureKeepsOrderAndStartsExpiryAtLaneEntry(t *testing.T) {
	s := newStore(t)
	s.Destination("collection-lanes", "L")
	j, e := s.Reserve(ReserveInput{ID: "request-deferred", Deferred: true})
	if e != nil || j.Status != "queued" {
		t.Fatal(j, e)
	}
	reserve(t, s, "request-following")
	upload(t, s, "request-following")
	if d, _ := s.Lease("collection-lanes"); d != nil {
		t.Fatal("waiting capture overtaken")
	}
	s.ExpireCaptures(time.Now().Add(2 * time.Minute))
	if j, _ := s.find("request-deferred"); j.Status != "queued" {
		t.Fatal("waiting capture expired too early")
	}
	j, e = s.BeginCapture("request-deferred")
	if e != nil || j.Status != "capturing" {
		t.Fatal(j, e)
	}
	s.ExpireCaptures(time.Now().Add(2 * time.Minute))
	if j, _ := s.find("request-deferred"); j.Status != "failed" {
		t.Fatal("active capture never expired")
	}
	d, e := s.Lease("collection-lanes")
	if e != nil || d == nil || d.ID != "request-following" {
		t.Fatal(d, e)
	}
}
func TestReceiverSummaryIncludesCountsWithoutImageHistoryMetadata(t *testing.T) {
	s := newStore(t)
	reserve(t, s, "request-summary")
	upload(t, s, "request-summary")
	full, summary := s.Snapshot(), s.Summary()
	if full.Pending != summary.Pending || summary.Pending != 1 || len(summary.Jobs) != 0 {
		t.Fatal(full, summary)
	}
	b, _ := json.Marshal(summary)
	if strings.Contains(string(b), "Reference") || strings.Contains(string(b), "request-summary") {
		t.Fatal("receiver status included queue history")
	}
}
