package main

import (
	"io"
	"log"
	"os"
	"path/filepath"

	"github.com/takeshy/speech-popup/internal/config"
)

// The daemon is built with -H windowsgui on Windows and is started detached on
// Linux/macOS, so nothing ever sees stderr. Every log line also goes to a file
// next to config.toml, which is the only way a user can find out why a startup
// step (hotkey registration in particular) failed.

const maxLogBytes = 1 << 20

// logPath returns the log file path, or "" when there is no config directory.
func logPath() string {
	dir := config.Dir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "speech-popup.log")
}

// setupLogging tees the standard logger into the log file. It returns a close
// function; failures are non-fatal because stderr logging still works.
func setupLogging() func() {
	log.SetFlags(log.LstdFlags)
	path := logPath()
	if path == "" {
		return func() {}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return func() {}
	}
	// Truncate rather than rotate: this log is a diagnostic tail, not history.
	if info, err := os.Stat(path); err == nil && info.Size() > maxLogBytes {
		_ = os.Remove(path)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return func() {}
	}
	log.SetOutput(io.MultiWriter(os.Stderr, file))
	return func() { _ = file.Close() }
}
