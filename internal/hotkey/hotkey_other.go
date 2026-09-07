//go:build !windows

package hotkey

// Manager is a no-op placeholder outside Windows.
type Manager struct{}

// Start always fails outside Windows; callers should fall back to the
// platform's own shortcut facilities.
func Start(string, func()) (*Manager, error) { return nil, ErrUnsupported }

// Stop is a no-op outside Windows.
func (*Manager) Stop() {}
