package main

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fixturePNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 12, 8))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func reserve(t *testing.T, s *Store, id string) *Job {
	t.Helper()
	j, e := s.Reserve(ReserveInput{ID: id, Title: "Reference", PageURL: "https://example.com/page", SourceURL: "https://example.com/img.png"})
	if e != nil {
		t.Fatal(e)
	}
	return j
}
func upload(t *testing.T, s *Store, id string) {
	t.Helper()
	if _, e := s.Upload(id, fixturePNG(t), "image/png", 12, 8); e != nil {
		t.Fatal(e)
	}
}

func TestReservationsPreserveClickOrderAcrossDownloadOrder(t *testing.T) {
	s, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Destination("collection-a", "A"); e != nil {
		t.Fatal(e)
	}
	reserve(t, s, "request-first")
	reserve(t, s, "request-second")
	upload(t, s, "request-second")
	if d, e := s.Lease("collection-a"); e != nil || d != nil {
		t.Fatalf("second download overtook first: %v %v", d, e)
	}
	upload(t, s, "request-first")
	d, e := s.Lease("collection-a")
	if e != nil || d == nil || d.ID != "request-first" || d.Sequence != 1 {
		t.Fatalf("first delivery: %+v %v", d, e)
	}
	if e = s.Ack(d.ID, "node-1"); e != nil {
		t.Fatal(e)
	}
	d, e = s.Lease("collection-a")
	if e != nil || d == nil || d.ID != "request-second" || d.Sequence != 2 {
		t.Fatalf("second delivery: %+v %v", d, e)
	}
}
func TestRestartRecoversInFlightAndRepeatingAckIsHarmless(t *testing.T) {
	dir := t.TempDir()
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	s.Destination("collection-a", "A")
	reserve(t, s, "request-first")
	upload(t, s, "request-first")
	s.Lease("collection-a")
	recovered, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	d, e := recovered.Lease("collection-a")
	if e != nil || d == nil || d.ID != "request-first" {
		t.Fatalf("lost in-flight job: %+v %v", d, e)
	}
	if e = recovered.Ack(d.ID, "node-1"); e != nil {
		t.Fatal(e)
	}
	if e = recovered.Ack(d.ID, "node-1"); e != nil {
		t.Fatal(e)
	}
	if next, e := recovered.Lease("collection-a"); e != nil || next != nil {
		t.Fatalf("redelivered acknowledged image: %v %v", next, e)
	}
	if _, e = os.Stat(filepath.Join(dir, "images", d.ID+".bin")); !os.IsNotExist(e) {
		t.Fatalf("acknowledged bytes retained: %v", e)
	}
}
func TestDestinationChangeDoesNotRedirectQueuedJobs(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	s.Destination("collection-a", "A")
	j := reserve(t, s, "request-first")
	upload(t, s, j.ID)
	s.Destination("collection-b", "B")
	if d, e := s.Lease("collection-b"); e != nil || d != nil {
		t.Fatalf("redirected job: %+v %v", d, e)
	}
	if d, e := s.Lease("collection-a"); e != nil || d == nil || d.TargetID != "collection-a" {
		t.Fatalf("original target missing: %+v %v", d, e)
	}
}
func TestUnassignedImagesRequireExplicitClaim(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	reserve(t, s, "request-first")
	upload(t, s, "request-first")
	s.Destination("collection-a", "A")
	if d, _ := s.Lease("collection-a"); d != nil {
		t.Fatal("unassigned job attached silently")
	}
	if e := s.Claim("collection-a", "A"); e != nil {
		t.Fatal(e)
	}
	if d, e := s.Lease("collection-a"); e != nil || d == nil {
		t.Fatalf("explicit claim did not deliver: %v %v", d, e)
	}
}
func TestIdempotentUploadAndInputValidation(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	a := reserve(t, s, "request-first")
	b := reserve(t, s, "request-first")
	if a.Sequence != b.Sequence {
		t.Fatal("retry reserved a new slot")
	}
	upload(t, s, a.ID)
	upload(t, s, a.ID)
	if _, e := s.Reserve(ReserveInput{ID: "../../escape"}); e == nil {
		t.Fatal("path traversal accepted")
	}
	reserve(t, s, "request-badimg")
	if _, e := s.Upload("request-badimg", []byte("not an image"), "image/png", 12, 8); e == nil {
		t.Fatal("invalid image accepted")
	}
	if _, e := s.Upload("request-badimg", fixturePNG(t), "image/jpeg", 12, 8); e == nil {
		t.Fatal("lying MIME accepted")
	}
	if _, e := s.Upload("request-badimg", fixturePNG(t), "image/png", 100, 100); e == nil {
		t.Fatal("lying dimensions accepted")
	}
	if _, e := s.Upload("request-badimg", make([]byte, 20*1024*1024+1), "image/png", 12, 8); e == nil {
		t.Fatal("oversized payload accepted")
	}
}
func TestInterruptedCaptureExpiresWithoutBlockingLaterImages(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	s.Destination("collection-a", "A")
	reserve(t, s, "request-first")
	reserve(t, s, "request-second")
	upload(t, s, "request-second")
	if e := s.ExpireCaptures(time.Now().Add(91 * time.Second)); e != nil {
		t.Fatal(e)
	}
	d, e := s.Lease("collection-a")
	if e != nil || d == nil || d.ID != "request-second" {
		t.Fatalf("stale capture blocked queue: %+v %v", d, e)
	}
	if e = s.Cancel(d.ID); e == nil {
		t.Fatal("in-flight cancellation accepted despite unknown insertion outcome")
	}
}
func TestCorruptQueueIsReportedAndFailedWritesRollback(t *testing.T) {
	dir := t.TempDir()
	if e := os.WriteFile(filepath.Join(dir, "queue.json"), []byte("broken"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := OpenStore(dir); e == nil {
		t.Fatal("corrupt queue silently discarded")
	}
	dir = t.TempDir()
	s, _ := OpenStore(dir)
	if e := os.Mkdir(filepath.Join(dir, "queue.json"), 0700); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Reserve(ReserveInput{ID: "request-first"}); e == nil {
		t.Fatal("failed write reported success")
	}
	os.Remove(filepath.Join(dir, "queue.json"))
	j := reserve(t, s, "request-second")
	if j.Sequence != 1 {
		t.Fatalf("failed transaction consumed sequence: %d", j.Sequence)
	}
}

func TestMissingPayloadDoesNotBlockLaterImages(t *testing.T) {
	dir := t.TempDir()
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Destination("collection-test", "Test"); e != nil {
		t.Fatal(e)
	}
	data, e := os.ReadFile("../tests/fixtures/transparent.png")
	if e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{"request-missing", "request-following"} {
		if _, e = s.Reserve(ReserveInput{ID: id}); e != nil {
			t.Fatal(e)
		}
		if _, e = s.Upload(id, data, "image/png", 12, 8); e != nil {
			t.Fatal(e)
		}
	}
	if e = os.Remove(filepath.Join(dir, "images", "request-missing.bin")); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Lease("collection-test"); e == nil {
		t.Fatal("Missing data was accepted")
	}
	d, e := s.Lease("collection-test")
	if e != nil || d == nil || d.ID != "request-following" {
		t.Fatalf("Queue blocked after damaged payload: %v %v", d, e)
	}
	if s.Snapshot().Failed != 1 {
		t.Fatal("Missing image not actionable")
	}
}
