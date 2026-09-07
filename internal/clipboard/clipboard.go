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
// wl-copy forks a child to serve the selection. Wait for its parent to finish
// setting the selection before reporting success; otherwise a failed copy
// would still clear the frontend's draft and trigger a paste of stale text.
func (c *Copier) Copy(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.backend == "wl-copy" {
		if _, err := exec.LookPath("wl-copy"); err == nil {
			cmd := exec.Command("wl-copy")
			cmd.Stdin = strings.NewReader(text)
			return cmd.Run()
		}
	}
	if c.setText == nil || !c.setText(text) {
		return errNoBackend{}
	}
	return nil
}

type errNoBackend struct{}

func (errNoBackend) Error() string { return "no clipboard backend available" }
