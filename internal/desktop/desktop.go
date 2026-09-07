// Package desktop hides the per-platform differences behind two popup
// operations: synthesizing a paste keystroke into whatever window has
// keyboard focus, and restoring keyboard focus to the window that was
// active before the popup appeared.
//
// Linux/Wayland stays special: Hyprland tracks window history itself, so
// RememberFocus is a no-op and RestoreFocus just asks the compositor.
package desktop

// Shortcut names accepted by PasteKeys. They mirror config.toml's
// clipboard.paste_key values.
const (
	PasteCtrlV      = "ctrl+v"
	PasteCtrlShiftV = "ctrl+shift+v"
)

// Platform abstracts the OS-specific parts of auto-paste and focus
// restoration.
type Platform interface {
	// Name identifies the backend ("linux", "windows", ...).
	Name() string
	// RememberFocus snapshots the currently focused window so that a
	// later RestoreFocus can return to it. Called immediately before
	// the popup window is shown.
	RememberFocus()
	// RestoreFocus returns focus to the window captured by the last
	// RememberFocus call.
	RestoreFocus()
	// PasteKeys sends the configured paste shortcut to the focused
	// window. On macOS "ctrl" maps to Cmd, the platform paste modifier.
	PasteKeys(shortcut string) error
}

// New returns the Platform implementation for the current GOOS.
func New() Platform { return newPlatform() }
