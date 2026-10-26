package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

const maxImageBytes = 20 * 1024 * 1024
const maxQueueBytes = 256 * 1024 * 1024
const maxPending = 200

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,100}$`)

type ReserveInput struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	PageURL     string `json:"pageUrl"`
	SourceURL   string `json:"sourceUrl"`
	CaptureMode string `json:"captureMode"`
	Deferred    bool   `json:"deferred,omitempty"`
}
type Job struct {
	ID          string    `json:"id"`
	Sequence    int64     `json:"sequence"`
	TargetID    string    `json:"targetId"`
	TargetLabel string    `json:"targetLabel"`
	Title       string    `json:"title"`
	PageURL     string    `json:"pageUrl"`
	SourceURL   string    `json:"sourceUrl"`
	CaptureMode string    `json:"captureMode"`
	HasPreview  bool      `json:"hasPreview,omitempty"`
	HasSource   bool      `json:"hasSource,omitempty"`
	Mime        string    `json:"mime,omitempty"`
	Width       int       `json:"width,omitempty"`
	Height      int       `json:"height,omitempty"`
	Size        int       `json:"size,omitempty"`
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	NodeID      string    `json:"nodeId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type Delivery struct {
	Job
	Data string `json:"data"`
}
type queueState struct {
	Version     int    `json:"version"`
	Paused      bool   `json:"paused,omitempty"`
	Next        int64  `json:"next"`
	TargetID    string `json:"targetId"`
	TargetLabel string `json:"targetLabel"`
	Jobs        []*Job `json:"jobs"`
}
type Status struct {
	Version      string         `json:"version"`
	Paused       bool           `json:"paused"`
	History      int            `json:"history"`
	TargetID     string         `json:"targetId"`
	TargetLabel  string         `json:"targetLabel"`
	Pending      int            `json:"pending"`
	Unassigned   int            `json:"unassigned"`
	Failed       int            `json:"failed"`
	Done         int            `json:"done"`
	QueueBytes   int            `json:"queueBytes"`
	Jobs         []*Job         `json:"jobs"`
	Receivers    []ReceiverInfo `json:"receivers"`
	PairingToken string         `json:"pairingToken,omitempty"`
}
type ReceiverInfo struct {
	TargetID  string `json:"targetId"`
	Label     string `json:"label"`
	Connected bool   `json:"connected"`
}
type Store struct {
	mu    sync.Mutex
	dir   string
	state queueState
}

func cleanText(s string, limit int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s))
	r := []rune(s)
	if len(r) > limit {
		s = string(r[:limit])
	}
	return s
}
func atomicWrite(path string, data []byte) error {
	tmp, e := os.CreateTemp(filepath.Dir(path), ".write-*")
	if e != nil {
		return e
	}
	name := tmp.Name()
	defer os.Remove(name)
	if e = tmp.Chmod(0600); e != nil {
		tmp.Close()
		return e
	}
	if _, e = tmp.Write(data); e != nil {
		tmp.Close()
		return e
	}
	if e = tmp.Sync(); e != nil {
		tmp.Close()
		return e
	}
	if e = tmp.Close(); e != nil {
		return e
	}
	return os.Rename(name, path)
}
func OpenStore(dir string) (*Store, error) {
	if e := os.MkdirAll(filepath.Join(dir, "previews"), 0700); e != nil {
		return nil, e
	}
	if e := os.MkdirAll(filepath.Join(dir, "images"), 0700); e != nil {
		return nil, e
	}
	s := &Store{dir: dir, state: queueState{Version: 1, Next: 1, Jobs: []*Job{}}}
	b, e := os.ReadFile(filepath.Join(dir, "queue.json"))
	if e != nil && !os.IsNotExist(e) {
		return nil, e
	}
	if e == nil {
		if len(b) > 16*1024*1024 || json.Unmarshal(b, &s.state) != nil || s.state.Version != 1 || s.state.Next < 1 {
			return nil, errors.New("Файл очереди повреждён. Сохраните папку данных и восстановите queue.json из резервной копии")
		}
		seen := map[string]bool{}
		changed := false
		for _, j := range s.state.Jobs {
			if j == nil || !validID.MatchString(j.ID) || seen[j.ID] || j.Size < 0 || j.Size > maxImageBytes {
				return nil, errors.New("Некорректные данные очереди")
			}
			seen[j.ID] = true
			if j.Status == "inflight" {
				j.Status = "ready"
				changed = true
			}
			switch j.Status {
			case "queued", "capturing", "ready", "done", "failed", "cancelled":
			default:
				return nil, errors.New("Неизвестное состояние очереди")
			}
		}
		if changed {
			if e = s.persist(); e != nil {
				return nil, e
			}
		}
	}
	// Remove only orphaned payloads from our own images directory.
	keep := map[string]bool{}
	for _, j := range s.state.Jobs {
		if j.Size > 0 && j.Status != "done" && j.Status != "cancelled" {
			keep[j.ID+".bin"] = true
		}
	}
	if entries, e := os.ReadDir(filepath.Join(dir, "images")); e == nil {
		for _, f := range entries {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".bin") && !keep[f.Name()] {
				os.Remove(filepath.Join(dir, "images", f.Name()))
			}
		}
	}
	s.cleanupPreviews()
	return s, nil
}
func (s *Store) persist() error {
	b, e := json.Marshal(s.state)
	if e != nil {
		return e
	}
	return atomicWrite(filepath.Join(s.dir, "queue.json"), b)
}
func (s *Store) transaction(fn func() error) error {
	before, _ := json.Marshal(s.state)
	if e := fn(); e != nil {
		json.Unmarshal(before, &s.state)
		return e
	}
	if e := s.persist(); e != nil {
		json.Unmarshal(before, &s.state)
		return fmt.Errorf("Не удалось сохранить очередь: %w", e)
	}
	return nil
}
func (s *Store) find(id string) (*Job, error) {
	for _, j := range s.state.Jobs {
		if j.ID == id {
			return j, nil
		}
	}
	return nil, errors.New("Изображение не найдено в очереди")
}
func cloneJob(j *Job) *Job { v := *j; return &v }
func compactJob(j *Job) *Job {
	v := *j
	v.HasSource = strings.HasPrefix(j.PageURL, "https://") || strings.HasPrefix(j.PageURL, "http://")
	v.PageURL = ""
	v.SourceURL = ""
	v.Title = cleanText(v.Title, 120)
	v.TargetLabel = cleanText(v.TargetLabel, 160)
	v.Error = cleanText(v.Error, 200)
	return &v
}
func (s *Store) Reserve(in ReserveInput) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validID.MatchString(in.ID) {
		return nil, errors.New("Некорректный идентификатор отправления")
	}
	if j, e := s.find(in.ID); e == nil {
		return cloneJob(j), nil
	}
	pending := 0
	for _, j := range s.state.Jobs {
		if j.Status == "queued" || j.Status == "capturing" || j.Status == "ready" || j.Status == "inflight" || j.Status == "failed" {
			pending++
		}
	}
	if pending >= maxPending {
		return nil, errors.New("В очереди уже 200 изображений. Дождитесь приёма или отмените лишние")
	}
	now := time.Now().UTC()
	j := &Job{ID: in.ID, Sequence: s.state.Next, TargetID: s.state.TargetID, TargetLabel: s.state.TargetLabel, Title: cleanText(in.Title, 160), PageURL: cleanText(in.PageURL, 2048), SourceURL: cleanText(in.SourceURL, 2048), CaptureMode: cleanText(in.CaptureMode, 40), Status: "capturing", CreatedAt: now, UpdatedAt: now}
	if in.Deferred {
		j.Status = "queued"
	}
	willPrune := len(s.state.Jobs) >= 500
	e := s.transaction(func() error {
		s.state.Next++
		s.state.Jobs = append(s.state.Jobs, j)
		if len(s.state.Jobs) > 500 {
			remaining := make([]*Job, 0, len(s.state.Jobs))
			drop := len(s.state.Jobs) - 500
			for _, old := range s.state.Jobs {
				if drop > 0 && (old.Status == "done" || old.Status == "cancelled") {
					drop--
					continue
				}
				remaining = append(remaining, old)
			}
			s.state.Jobs = remaining
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	if willPrune {
		s.cleanupPreviews()
	}
	return cloneJob(j), nil
}

type UploadOptions struct {
	CaptureMode string
	Preview     string
}

func (s *Store) Upload(id string, data []byte, mime string, w, h int, options ...UploadOptions) (*Job, error) {
	if len(data) == 0 || len(data) > maxImageBytes {
		return nil, errors.New("Изображение должно быть не больше 20 МБ")
	}
	cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil {
		return nil, errors.New("Не удалось прочитать изображение")
	}
	expected := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif"}[format]
	if expected == "" || expected != mime {
		return nil, errors.New("Формат изображения не соответствует данным")
	}
	if cfg.Width != w || cfg.Height != h || w < 1 || h < 1 || w > 4096 || h > 4096 {
		return nil, errors.New("Некорректный размер изображения; максимум 4096 пикселей по каждой стороне")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return nil, e
	}
	if j.Status == "done" || j.Status == "ready" || j.Status == "inflight" {
		return cloneJob(j), nil
	}
	if j.Status != "capturing" && j.Status != "failed" {
		return nil, errors.New("Отправление уже отменено")
	}
	total := 0
	for _, old := range s.state.Jobs {
		if old.Status != "done" && old.Status != "cancelled" {
			total += old.Size
		}
	}
	if total-j.Size+len(data) > maxQueueBytes {
		return nil, errors.New("Очередь занимает больше 256 МБ. Сначала передайте часть изображений в Figma")
	}
	path := filepath.Join(s.dir, "images", id+".bin")
	previousSize := j.Size
	if e = atomicWrite(path, data); e != nil {
		return nil, fmt.Errorf("Не удалось сохранить изображение: %w", e)
	}
	var previewSaved bool
	if len(options) > 0 {
		if b := validPreview(options[0].Preview); b != nil {
			previewSaved = atomicWrite(filepath.Join(s.dir, "previews", id+".bin"), b) == nil
		}
	}
	e = s.transaction(func() error {
		j.HasPreview = j.HasPreview || previewSaved
		j.Status = "ready"
		j.Error = ""
		j.Mime = mime
		j.Width = w
		j.Height = h
		j.Size = len(data)
		if len(options) > 0 {
			switch options[0].CaptureMode {
			case "screen", "resized", "converted", "original":
				j.CaptureMode = options[0].CaptureMode
			}
		}
		j.UpdatedAt = time.Now().UTC()
		return nil
	})
	if e != nil {
		if previousSize == 0 {
			os.Remove(path)
			if previewSaved {
				os.Remove(filepath.Join(s.dir, "previews", id+".bin"))
			}
		}
		return nil, e
	}
	return cloneJob(j), nil
}
func (s *Store) Destination(target, label string) error {
	if target != "" && !validID.MatchString(target) {
		return errors.New("Некорректный получатель")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.transaction(func() error { s.state.TargetID = target; s.state.TargetLabel = cleanText(label, 240); return nil })
}
func (s *Store) Claim(target, label string) error {
	if !validID.MatchString(target) {
		return errors.New("Некорректный получатель")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.transaction(func() error {
		for _, j := range s.state.Jobs {
			if j.TargetID == "" && (j.Status == "queued" || j.Status == "ready" || j.Status == "capturing" || j.Status == "failed") {
				j.TargetID = target
				j.TargetLabel = cleanText(label, 240)
			}
		}
		s.state.TargetID = target
		s.state.TargetLabel = cleanText(label, 240)
		return nil
	})
}
func (s *Store) Lease(target string) (*Delivery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Paused {
		return nil, nil
	}
	for _, j := range s.state.Jobs {
		if j.TargetID != target {
			continue
		}
		switch j.Status {
		case "queued", "capturing", "inflight":
			return nil, nil
		case "ready":
			b, e := os.ReadFile(filepath.Join(s.dir, "images", j.ID+".bin"))
			if e != nil || len(b) != j.Size {
				problem := fmt.Sprintf("Данные изображения №%d отсутствуют или повреждены. Отправьте его с сайта заново", j.Sequence)
				if e = s.transaction(func() error { j.Status = "failed"; j.Error = problem; j.UpdatedAt = time.Now().UTC(); return nil }); e != nil {
					return nil, e
				}
				return nil, errors.New(problem)
			}
			if e = s.transaction(func() error { j.Status = "inflight"; j.UpdatedAt = time.Now().UTC(); return nil }); e != nil {
				return nil, e
			}
			return &Delivery{Job: *cloneJob(j), Data: base64.StdEncoding.EncodeToString(b)}, nil
		}
	}
	return nil, nil
}
func (s *Store) Ack(id, node string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status == "done" {
		return nil
	}
	if j.Status != "inflight" {
		return errors.New("Нет ожидаемой вставки для этого изображения")
	}
	e = s.transaction(func() error {
		j.Status = "done"
		j.NodeID = cleanText(node, 100)
		j.Error = ""
		j.UpdatedAt = time.Now().UTC()
		return nil
	})
	if e == nil {
		os.Remove(filepath.Join(s.dir, "images", id+".bin"))
	}
	return e
}
func (s *Store) Release(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status != "inflight" {
		return nil
	}
	return s.transaction(func() error { j.Status = "ready"; j.UpdatedAt = time.Now().UTC(); return nil })
}
func (s *Store) Fail(id, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status == "done" || j.Status == "cancelled" {
		return nil
	}
	return s.transaction(func() error {
		j.Status = "failed"
		j.Error = cleanText(message, 300)
		j.UpdatedAt = time.Now().UTC()
		return nil
	})
}
func (s *Store) CaptureFailed(id, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status != "capturing" && j.Status != "queued" {
		return nil
	}
	return s.transaction(func() error {
		j.Status = "failed"
		j.Error = cleanText(message, 300)
		j.UpdatedAt = time.Now().UTC()
		return nil
	})
}
func (s *Store) Cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status == "inflight" {
		return errors.New("Изображение уже вставляется. Дождитесь результата")
	}
	if j.Status == "done" {
		return errors.New("Изображение уже в Figma; удалить его можно в самом файле")
	}
	if j.Status == "cancelled" {
		return nil
	}
	e = s.transaction(func() error { j.Status = "cancelled"; j.UpdatedAt = time.Now().UTC(); return nil })
	if e == nil {
		os.Remove(filepath.Join(s.dir, "images", id+".bin"))
	}
	return e
}
func (s *Store) Retry(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return e
	}
	if j.Status != "failed" {
		return errors.New("Повтор доступен только для неудачной вставки")
	}
	if j.Size == 0 {
		return errors.New("Исходник не сохранён. Отправьте изображение с сайта ещё раз")
	}
	if _, e = os.Stat(filepath.Join(s.dir, "images", id+".bin")); e != nil {
		return errors.New("Данные изображения недоступны; отправьте его заново")
	}
	return s.transaction(func() error { j.Status = "ready"; j.Error = ""; j.UpdatedAt = time.Now().UTC(); return nil })
}
func (s *Store) ExpireCaptures(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for _, j := range s.state.Jobs {
		if (j.Status == "capturing" && now.Sub(j.UpdatedAt) > 90*time.Second) || (j.Status == "queued" && now.Sub(j.UpdatedAt) > 30*time.Minute) {
			changed = true
			break
		}
	}
	if !changed {
		return nil
	}
	return s.transaction(func() error {
		for _, j := range s.state.Jobs {
			if (j.Status == "capturing" && now.Sub(j.UpdatedAt) > 90*time.Second) || (j.Status == "queued" && now.Sub(j.UpdatedAt) > 30*time.Minute) {
				j.Status = "failed"
				j.Error = "Захват прервался. Отправьте изображение с сайта ещё раз"
				j.UpdatedAt = now
			}
		}
		return nil
	})
}
func (s *Store) Snapshot() Status { return s.snapshot(true) }
func (s *Store) Summary() Status  { return s.snapshot(false) }
func (s *Store) snapshot(includeJobs bool) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Status{Version: version, Paused: s.state.Paused, TargetID: s.state.TargetID, TargetLabel: s.state.TargetLabel, Jobs: []*Job{}, Receivers: []ReceiverInfo{}}
	for _, j := range s.state.Jobs {
		switch j.Status {
		case "queued", "capturing", "ready", "inflight":
			out.Pending++
			if j.TargetID == "" {
				out.Unassigned++
			}
		case "failed":
			out.Failed++
		case "done":
			out.Done++
			out.History++
		case "cancelled":
			out.History++
		}
		if j.Status != "done" && j.Status != "cancelled" {
			out.QueueBytes += j.Size
		}
	}
	if !includeJobs {
		return out
	}
	// Pending/failed jobs stay actionable even when many newer items succeeded.
	for i := len(s.state.Jobs) - 1; i >= 0; i-- {
		j := s.state.Jobs[i]
		if j.Status != "done" && j.Status != "cancelled" {
			out.Jobs = append(out.Jobs, compactJob(j))
		}
	}
	count := 0
	for i := len(s.state.Jobs) - 1; i >= 0 && count < 20; i-- {
		j := s.state.Jobs[i]
		if j.Status == "done" || j.Status == "cancelled" {
			out.Jobs = append(out.Jobs, compactJob(j))
			count++
		}
	}
	return out
}
