package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	store, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	s := NewServer(store, Config{NativeToken: strings.Repeat("a", 64), PairingToken: strings.Repeat("b", 64)})
	h := httptest.NewServer(s.Handler())
	t.Cleanup(h.Close)
	t.Cleanup(s.Close)
	return s, h
}
func connectReceiver(t *testing.T, h *httptest.Server, token, target string) *websocket.Conn {
	t.Helper()
	headers := http.Header{"Origin": []string{"null"}}
	c, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/receiver", headers)
	if e != nil {
		t.Fatal(e)
	}
	e = c.WriteJSON(map[string]any{"type": "hello", "token": token, "targetId": target, "label": "Test / References"})
	if e != nil {
		t.Fatal(e)
	}
	return c
}
func readMessage(t *testing.T, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var m map[string]any
		if e := c.ReadJSON(&m); e != nil {
			t.Fatal(e)
		}
		if m["type"] == kind {
			return m
		}
	}
}
func TestAuthenticatedReceiverGetsImageAndAckFinishesJob(t *testing.T) {
	s, h := testServer(t)
	s.store.Destination("collection-a", "A")
	reserve(t, s.store, "request-first")
	upload(t, s.store, "request-first")
	c := connectReceiver(t, h, strings.Repeat("b", 64), "collection-a")
	defer c.Close()
	readMessage(t, c, "connected")
	m := readMessage(t, c, "image")
	job := m["job"].(map[string]any)
	if job["id"] != "request-first" || job["data"] == "" {
		t.Fatalf("bad delivery: %v", m)
	}
	c.WriteJSON(map[string]any{"type": "ack", "id": "request-first", "ok": true, "nodeId": "1:2"})
	readMessage(t, c, "status")
	deadline := time.Now().Add(time.Second)
	for s.store.Snapshot().Done != 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s.store.Snapshot().Done != 1 {
		t.Fatal("ack did not finish queue job")
	}
}
func TestWrongPairingTokenAndWebOriginCannotReadImages(t *testing.T) {
	_, h := testServer(t)
	c := connectReceiver(t, h, "wrong-token", "collection-a")
	defer c.Close()
	m := readMessage(t, c, "error")
	if m["error"] == "" {
		t.Fatal("authentication error missing")
	}
	bad := http.Header{"Origin": []string{"https://untrusted.example"}}
	c2, r, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/receiver", bad)
	if c2 != nil {
		c2.Close()
	}
	if e == nil || r.StatusCode != 403 {
		t.Fatal("untrusted origin accepted")
	}
}
func TestLostAcknowledgementReleasesSameJobForReplay(t *testing.T) {
	s, h := testServer(t)
	s.store.Destination("collection-a", "A")
	reserve(t, s.store, "request-first")
	upload(t, s.store, "request-first")
	c := connectReceiver(t, h, strings.Repeat("b", 64), "collection-a")
	readMessage(t, c, "connected")
	readMessage(t, c, "image")
	c.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if s.store.Snapshot().Jobs[0].Status == "ready" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	c = connectReceiver(t, h, strings.Repeat("b", 64), "collection-a")
	defer c.Close()
	readMessage(t, c, "connected")
	m := readMessage(t, c, "image")
	if m["job"].(map[string]any)["id"] != "request-first" {
		t.Fatal("lost ack created different operation")
	}
}
func TestNativeRPCRejectsUnauthenticatedAndMalformedRequests(t *testing.T) {
	_, h := testServer(t)
	body := []byte(`{"requestId":"r1","type":"status","data":{}}`)
	req, _ := http.NewRequest("POST", h.URL+"/rpc", bytes.NewReader(body))
	r, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatal("unauthenticated RPC accepted")
	}
	req, _ = http.NewRequest("POST", h.URL+"/rpc", strings.NewReader("broken"))
	req.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 64))
	r, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Body.Close()
	if r.StatusCode != 400 {
		t.Fatal("invalid JSON accepted")
	}
}
func TestNativeFramingRoundTripAndOversizedHeader(t *testing.T) {
	var b bytes.Buffer
	if e := WriteNative(&b, Reply{RequestID: "r1", OK: true, Data: map[string]string{"text": "изображение"}}); e != nil {
		t.Fatal(e)
	}
	payload, e := ReadNative(&b)
	if e != nil {
		t.Fatal(e)
	}
	var got map[string]any
	json.Unmarshal(payload, &got)
	if got["requestId"] != "r1" || got["ok"] != true {
		t.Fatalf("bad frame %s", payload)
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], 64*1024*1024+1)
	if _, e = ReadNative(bytes.NewReader(header[:])); e == nil {
		t.Fatal("oversized header accepted")
	}
	if _, e = ReadNative(bytes.NewReader([]byte{1, 2})); e != io.ErrUnexpectedEOF {
		t.Fatalf("truncated header: %v", e)
	}
}
func TestValidFullQueueStatusFitsNativeResponseLimit(t *testing.T) {
	s, _ := testServer(t)
	s.store.Destination("collection-limit", strings.Repeat("&", 240))
	url := "https://example.com/?q=" + strings.Repeat("&", 2020)
	for i := 0; i < 200; i++ {
		id := fmt.Sprintf("request-size-%03d", i)
		_, e := s.store.Reserve(ReserveInput{ID: id, Title: strings.Repeat("&", 160), PageURL: url, SourceURL: url})
		if e != nil {
			t.Fatal(e)
		}
	}
	var b bytes.Buffer
	if e := WriteNative(&b, s.Handle(Request{RequestID: "status-full", Type: "status", Data: json.RawMessage(`{}`)})); e != nil {
		t.Fatalf("valid queue broke native framing: %v", e)
	}
	if b.Len() > 1024*1024+4 {
		t.Fatalf("native status too large: %d", b.Len())
	}
}

func TestDuplicateCollectionCannotTakeOverActiveReceiver(t *testing.T) {
	_, h := testServer(t)
	token := strings.Repeat("b", 64)
	first := connectReceiver(t, h, token, "collection-duplicate")
	defer first.Close()
	readMessage(t, first, "connected")
	other := connectReceiver(t, h, token, "collection-duplicate")
	defer other.Close()
	m := readMessage(t, other, "error")
	if m["code"] != "target-in-use" {
		t.Fatal("Duplicate receiver was not rejected")
	}
	if e := first.WriteJSON(map[string]string{"type": "status"}); e != nil {
		t.Fatal(e)
	}
	readMessage(t, first, "status")
}
