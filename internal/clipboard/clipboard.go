// Package clipboard copies text to the system clipboard, preferring
// wl-clipboard over the Wails runtime binding. Paste keystroke synthesis
// and focus restoration live in internal/desktop.
package clipboard

import (
	"os/exec"
	"strings"
	"sync"
)

type Copier struct {
	mu      sync.Mutex
	backend string
	setText func(string) bool
	lastCmd *exec.Cmd
}

// New creates a copier. setText provides the native clipboard implementation;
// it may be nil when only wl-copy is used.
func New(backend string, setText func(string) bool) *Copier {
	if backend != "wails" {
		backend = "wl-copy"
	}
	return &Copier{backend: backend, setText: setText}
}

// Copy places text on the clipboard.
//
// With the wl-copy backend a previous wl-copy child is killed first so
// repeated copies do not accumulate background processes; wl-copy itself
// forks immediately and keeps serving the selection from the new process.
// The immediate child still needs to be reaped once it exits (whether it
// forked away on its own or was killed here), so each one is waited on in
// its own goroutine instead of being left as a zombie for the life of the
// daemon.
func (c *Copier) Copy(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.backend == "wl-copy" {
		if _, err := exec.LookPath("wl-copy"); err == nil {
			cmd := exec.Command("wl-copy")
			cmd.Stdin = strings.NewReader(text)
			if err := cmd.Start(); err != nil {
				return err
			}
			go cmd.Wait()
			if c.lastCmd != nil && c.lastCmd.Process != nil {
				_ = c.lastCmd.Process.Kill()
			}
			c.lastCmd = cmd
			return nil
		}
	}
	if c.setText == nil || !c.setText(text) {
		return errNoBackend{}
	}
	return nil
}

type errNoBackend struct{}

func (errNoBackend) Error() string { return "no clipboard backend available" }
