//go:build !windows && !darwin

package hotkey

type Manager struct{}

func Start(Registry, string, func()) (*Manager, error) { return nil, ErrUnsupported }

func (*Manager) Stop() {}

func (*Manager) Active() bool { return false }
