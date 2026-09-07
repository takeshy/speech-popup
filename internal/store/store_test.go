package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadHistoryDefaultsToEmptyArray(t *testing.T) {
	s, err := NewAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got := s.LoadHistory(); got != "[]" {
		t.Errorf("LoadHistory() = %q, want []", got)
	}
}

func TestSaveHistoryRejectsInvalidJSON(t *testing.T) {
	s, err := NewAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveHistory("not json"); err == nil {
		t.Fatal("SaveHistory accepted invalid JSON")
	}
}

func TestFlushWritesAtomicallyAndReloads(t *testing.T) {
	dir := t.TempDir()
	s, err := NewAt(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveHistory(`["one","two"]`); err != nil {
		t.Fatal(err)
	}
	if err := s.Flush(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, HistoryFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `["one","two"]` {
		t.Errorf("file = %q", data)
	}
	// No temporary files may be left behind.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("directory holds %d entries, want only %s", len(entries), HistoryFile)
	}

	reopened, err := NewAt(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.LoadHistory(); got != `["one","two"]` {
		t.Errorf("LoadHistory() = %q", got)
	}
}

func TestFlushIsANoOpWhenNothingChanged(t *testing.T) {
	dir := t.TempDir()
	s, err := NewAt(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Flush(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, HistoryFile)); !os.IsNotExist(err) {
		t.Errorf("Flush created %s with no staged write", HistoryFile)
	}
}
