//go:build darwin

package desktop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPasteKeysSendsMacModifiers(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "osascript"), []byte("#!/bin/sh\nprintf '%s' \"$2\" > \"$SPEECH_TEST_SCRIPT\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "script")
	t.Setenv("PATH", dir)
	t.Setenv("SPEECH_TEST_SCRIPT", path)
	for _, tc := range []struct{ shortcut, modifiers string }{
		{PasteCtrlV, "command down"},
		{PasteCtrlShiftV, "{command down, shift down}"},
	} {
		if err := (&Darwin{}).PasteKeys(tc.shortcut); err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		want := `tell application "System Events" to keystroke "v" using ` + tc.modifiers
		if string(got) != want {
			t.Fatalf("%s: got %q, want %q", tc.shortcut, got, want)
		}
	}
}

func TestPasteKeysReportsSystemEventsError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "osascript"), []byte("#!/bin/sh\nprintf '%s' 'not allowed assistive access (-1719)' >&2\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	err := (&Darwin{}).PasteKeys(PasteCtrlV)
	if err == nil || !strings.Contains(err.Error(), "not allowed assistive access (-1719)") {
		t.Fatalf("missing System Events error details: %v", err)
	}
}
