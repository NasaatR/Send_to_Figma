package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Previews are separate bounded files, never embedded in the status response.
// They remain local, survive browser restarts and expire with their queue history.
const maxPreviewBytes = 12 * 1024

func validPreview(dataURL string) []byte {
	if len(dataURL) > maxPreviewBytes*4/3+64 {
		return nil
	}
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 || (parts[0] != "data:image/jpeg;base64" && parts[0] != "data:image/png;base64") {
		return nil
	}
	b, e := base64.StdEncoding.DecodeString(parts[1])
	if e != nil || len(b) == 0 || len(b) > maxPreviewBytes {
		return nil
	}
	cfg, format, e := image.DecodeConfig(bytes.NewReader(b))
	if e != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 160 || cfg.Height > 160 {
		return nil
	}
	if (format == "png" && parts[0] == "data:image/png;base64") || (format == "jpeg" && parts[0] == "data:image/jpeg;base64") {
		return b
	}
	return nil
}
func (s *Store) cleanupPreviews() {
	keep := map[string]bool{}
	for _, j := range s.state.Jobs {
		if j.HasPreview {
			keep[j.ID+".bin"] = true
		}
	}
	entries, e := os.ReadDir(filepath.Join(s.dir, "previews"))
	if e != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".bin") && !keep[entry.Name()] {
			os.Remove(filepath.Join(s.dir, "previews", entry.Name()))
		}
	}
}
func (s *Store) Preview(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return "", e
	}
	if !j.HasPreview {
		return "", nil
	}
	b, e := os.ReadFile(filepath.Join(s.dir, "previews", id+".bin"))
	if e != nil {
		return "", nil
	}
	if len(b) > maxPreviewBytes {
		return "", nil
	}
	mime := "image/jpeg"
	if len(b) > 4 && b[0] == 137 && b[1] == 80 {
		mime = "image/png"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}
func (s *Store) Source(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return "", e
	}
	u, e := url.Parse(j.PageURL)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("Ссылка на источник недоступна")
	}
	u.User = nil
	u.RawQuery = ""
	u.ForceQuery = false
	u.Fragment = ""
	return u.String(), nil
}
func (s *Store) Pause(paused bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Paused == paused {
		return nil
	}
	return s.transaction(func() error { s.state.Paused = paused; return nil })
}

type BatchResult struct {
	Changed int `json:"changed"`
	Skipped int `json:"skipped"`
}

func (s *Store) Batch(operation string, ids []string) (BatchResult, error) {
	out := BatchResult{}
	if operation != "retry" && operation != "cancel" && operation != "clear_history" {
		return out, errors.New("Неизвестное групповое действие")
	}
	if len(ids) > maxPending {
		return out, errors.New("Слишком много отправлений")
	}
	selected := map[string]bool{}
	for _, id := range ids {
		if !validID.MatchString(id) {
			return out, errors.New("Некорректное отправление")
		}
		selected[id] = true
	}
	if operation != "clear_history" && len(selected) == 0 {
		return out, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	remove := []string{}
	now := time.Now().UTC()
	e := s.transaction(func() error {
		remaining := make([]*Job, 0, len(s.state.Jobs))
		found := map[string]bool{}
		for _, j := range s.state.Jobs {
			if operation == "clear_history" && (j.Status == "done" || j.Status == "cancelled") {
				out.Changed++
				remove = append(remove, j.ID)
				continue
			}
			remaining = append(remaining, j)
			if !selected[j.ID] {
				continue
			}
			found[j.ID] = true
			switch operation {
			case "retry":
				if j.Status != "failed" || j.Size == 0 {
					out.Skipped++
					continue
				}
				info, e := os.Stat(filepath.Join(s.dir, "images", j.ID+".bin"))
				if e != nil || info.Size() != int64(j.Size) {
					out.Skipped++
					continue
				}
				j.Status = "ready"
				j.Error = ""
				j.UpdatedAt = now
				out.Changed++
			case "cancel":
				if j.Status != "queued" && j.Status != "capturing" && j.Status != "ready" && j.Status != "failed" {
					out.Skipped++
					continue
				}
				j.Status = "cancelled"
				j.Error = ""
				j.UpdatedAt = now
				out.Changed++
				remove = append(remove, j.ID)
			}
		}
		if operation != "clear_history" {
			for id := range selected {
				if !found[id] {
					out.Skipped++
				}
			}
		}
		s.state.Jobs = remaining
		return nil
	})
	if e != nil {
		return BatchResult{}, e
	}
	for _, id := range remove {
		os.Remove(filepath.Join(s.dir, "images", id+".bin"))
	}
	if operation == "clear_history" {
		s.cleanupPreviews()
	}
	return out, nil
}

// Deferred reservations retain click order without expiring while waiting for a
// bounded capture lane. Active capture gets its own 90-second clock.
func (s *Store) BeginCapture(id string) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, e := s.find(id)
	if e != nil {
		return nil, e
	}
	if j.Status == "capturing" {
		return cloneJob(j), nil
	}
	if j.Status != "queued" {
		return nil, errors.New("Подготовка уже завершилась или отправление отменено")
	}
	e = s.transaction(func() error { j.Status = "capturing"; j.UpdatedAt = time.Now().UTC(); return nil })
	if e != nil {
		return nil, e
	}
	return cloneJob(j), nil
}
