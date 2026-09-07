// Package store persists the copy history as a JSON file under the per-user
// data directory ($XDG_DATA_HOME/speech-popup on Linux; see dataDir for
// Windows/macOS).
//
// Writes are debounced (flushed 2 seconds after the last update) and are
// always flushed when the popup hides. Every write goes through a temporary
// file + rename so a crash never leaves a truncated file behind.
package store

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

const (
	// HistoryFile holds the copy history shown with the up/down arrows.
	HistoryFile   = "history.json"
	flushInterval = 2 * time.Second
)

type Store struct {
	mu          sync.Mutex
	dir         string
	historyJSON string
	dirty       bool
	timer       *time.Timer
}

// dataDir returns the per-user data directory:
// $XDG_DATA_HOME/speech-popup (or ~/.local/share/speech-popup) on Linux,
// %LocalAppData%/speech-popup on Windows, and
// ~/Library/Application Support/speech-popup on macOS.
func dataDir() string {
	if base := os.Getenv("XDG_DATA_HOME"); base != "" {
		return filepath.Join(base, "speech-popup")
	}
	switch runtime.GOOS {
	case "windows":
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, "speech-popup")
		}
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, "Library", "Application Support", "speech-popup")
		}
	default:
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".local", "share", "speech-popup")
		}
	}
	return ""
}

// DataDir returns the per-user data directory (see dataDir).
func DataDir() string { return dataDir() }

// New creates a store rooted at the per-user data directory.
func New() (*Store, error) { return NewAt(dataDir()) }

// NewAt creates a store rooted at an explicit directory (tests).
func NewAt(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

// LoadHistory returns the persisted copy history JSON ("[]" when absent).
func (s *Store) LoadHistory() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.historyJSON == "" {
		s.historyJSON = readFileOrEmpty(filepath.Join(s.dir, HistoryFile), "[]")
	}
	return s.historyJSON
}

// SaveHistory stages a history update; it is flushed after the debounce
// interval or by the next Flush.
func (s *Store) SaveHistory(data string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !json.Valid([]byte(data)) {
		return os.ErrInvalid
	}
	s.historyJSON = data
	s.dirty = true
	s.scheduleFlushLocked()
	return nil
}

// Flush writes any staged update to disk immediately. A failed write stays
// dirty and is retried after the debounce interval.
func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if !s.dirty {
		return nil
	}
	if err := writeAtomic(filepath.Join(s.dir, HistoryFile), s.historyJSON); err != nil {
		s.scheduleFlushLocked()
		return fmt.Errorf("%s: %w", HistoryFile, err)
	}
	s.dirty = false
	return nil
}

func (s *Store) scheduleFlushLocked() {
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(flushInterval, func() {
		if err := s.Flush(); err != nil {
			log.Printf("store flush: %v", err)
		}
	})
}

func readFileOrEmpty(path, emptyValue string) string {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return emptyValue
	}
	return string(data)
}

func writeAtomic(path, content string) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".speech-popup-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}
