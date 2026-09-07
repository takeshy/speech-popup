//go:build linux

// Linux delegates paste and focus restoration to Wayland tools: wtype for
// key synthesis and hyprctl for returning to the previously focused
// window (compositor-side state we cannot see ourselves).
package desktop

import (
	"os/exec"
)

type Linux struct{}

func newPlatform() Platform { return Linux{} }

func (Linux) Name() string { return "linux" }

func (Linux) RememberFocus() {}

func (Linux) RestoreFocus() {
	// Failures are ignored: speech-popup must keep working outside Hyprland.
	_ = exec.Command("hyprctl", "dispatch", "focuscurrentorlast").Run()
}

func (Linux) PasteKeys(shortcut string) error {
	switch shortcut {
	case PasteCtrlShiftV:
		// Most terminal emulators reserve Ctrl+V for readline's "insert
		// next character literally" and paste on Ctrl+Shift+V instead.
		return exec.Command("wtype", "-M", "ctrl", "-M", "shift", "-k", "v",
			"-m", "shift", "-m", "ctrl").Run()
	default:
		return exec.Command("wtype", "-M", "ctrl", "-k", "v", "-m", "ctrl").Run()
	}
}
