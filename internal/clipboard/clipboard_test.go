//go:build !windows

package clipboard

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopyWaitsForSelectionAndReportsFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			dir := t.TempDir()
			output := filepath.Join(dir, "selection")
			t.Setenv("COPY_OUTPUT", output)
			script := "#!/bin/sh\nIFS= read -r text\nprintf '%s' \"$text\" > \"$COPY_OUTPUT\"\n"
			if fail {
				script += "exit 1\n"
			}
			if err := os.WriteFile(filepath.Join(dir, "wl-copy"), []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", dir)
			copier := New("wl-copy", func(string) bool {
				t.Error("must not mask a wl-copy error with a fallback")
				return true
			})
			err := copier.Copy("recognized text")
			if (err != nil) != fail {
				t.Fatalf("Copy error = %v, want failure = %t", err, fail)
			}
			data, err := os.ReadFile(output)
			if err != nil || string(data) != "recognized text" {
				t.Fatalf("Copy returned before selection was written: %q, %v", data, err)
			}
		})
	}
}
