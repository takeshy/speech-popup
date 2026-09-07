//go:build darwin

// macOS implements paste and focus restoration through osascript (System
// Events). Sending keystrokes to other applications and setting their
// frontmost state require the Accessibility permission (and Automation
// permission for System Events) for the speech-popup binary; grant them in
// System Settings > Privacy & Security.
package desktop

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

type Darwin struct {
	mu       sync.Mutex
	bundleID string
	pid      int
}

func newPlatform() Platform { return &Darwin{} }

func (*Darwin) Name() string { return "darwin" }

func osascript(script string) (string, error) {
	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// RememberFocus snapshots the frontmost application. One script returns
// both identifiers so the snapshot is atomic with respect to focus
// changes; processes without a bundle id report "missing value".
func (d *Darwin) RememberFocus() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.bundleID = ""
	d.pid = 0

	out, err := osascript(
		`tell application "System Events" to get {bundle identifier, unix id} of first application process whose frontmost is true`,
	)
	if err != nil {
		return
	}
	parts := strings.Split(out, ", ")
	if len(parts) != 2 {
		return
	}
	if parts[0] != "" && parts[0] != "missing value" {
		d.bundleID = parts[0]
	}
	if n, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil {
		d.pid = n
	}
}

// RestoreFocus reactivates the remembered application: by bundle
// identifier when available (NSRunningApplication.activate() equivalent),
// otherwise by process id.
func (d *Darwin) RestoreFocus() {
	d.mu.Lock()
	bundleID, pid := d.bundleID, d.pid
	d.mu.Unlock()

	switch {
	case bundleID != "":
		_, _ = osascript(fmt.Sprintf("tell application id %q to activate", bundleID))
	case pid != 0:
		_, _ = osascript(fmt.Sprintf(
			`tell application "System Events" to set frontmost of (first application process whose unix id is %d) to true`,
			pid,
		))
	}
}

// PasteKeys sends the configured paste shortcut via System Events. The
// config's "ctrl" modifier maps to Cmd, macOS's paste modifier.
func (*Darwin) PasteKeys(shortcut string) error {
	modifiers := "command down"
	if shortcut == PasteCtrlShiftV {
		// Some terminals (iTerm2 default profile) paste on Cmd+Shift+V.
		modifiers = "{command down, shift down}"
	}
	_, err := osascript(fmt.Sprintf(`tell application "System Events" to keystroke "v" using %s`, modifiers))
	return err
}
