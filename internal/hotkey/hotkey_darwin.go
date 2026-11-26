package hotkey

import (
	"fmt"
	"strconv"
	"strings"
)

type Manager struct {
	registry Registry
	key      string
}

// Wails binds the shortcut through RegisterEventHotKey and delivers key-down
// directly to the resident process, even when another app has focus.
func Start(registry Registry, accelerator string, onTrigger func()) (*Manager, error) {
	key, err := macAccelerator(accelerator)
	if err != nil {
		return nil, err
	}
	if err := registry.Register(key, onTrigger); err != nil {
		return nil, err
	}
	return &Manager{registry: registry, key: key}, nil
}

func (m *Manager) Active() bool { return m.registry.IsRegistered(m.key) }

func (m *Manager) Stop() {
	// Wails also releases its registrations on application shutdown.
	if m.Active() {
		_ = m.registry.Unregister(m.key)
	}
}

const InvalidAcceleratorMessage = "ホットキー %q を解釈できません: A-Z, 0-9, Space, F1-F20 と Ctrl/Shift/Option/Cmd を + で繋いでください"

func ValidateAccelerator(s string) error {
	_, err := macAccelerator(s)
	return err
}

func macAccelerator(s string) (string, error) {
	parts := strings.Split(s, "+")
	if len(parts) < 2 {
		return "", fmt.Errorf("修飾キーとキーを + で繋いでください")
	}
	for i, part := range parts[:len(parts)-1] {
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "ctrl", "control":
			parts[i] = "Ctrl"
		case "cmd", "command", "win", "meta", "super":
			parts[i] = "Cmd"
		case "alt", "option":
			parts[i] = "Option"
		case "shift":
			parts[i] = "Shift"
		default:
			return "", fmt.Errorf("修飾キー %q は Ctrl / Shift / Option / Cmd から選んでください", part)
		}
	}
	last := len(parts) - 1
	key := strings.ToUpper(strings.TrimSpace(parts[last]))
	switch {
	case key == "SPACE", len(key) == 1 && (key >= "A" && key <= "Z" || key >= "0" && key <= "9"):
	case strings.HasPrefix(key, "F"):
		n, err := strconv.Atoi(key[1:])
		if err != nil || n < 1 || n > 20 {
			return "", fmt.Errorf("ファンクションキーは F1-F20 から選んでください")
		}
		key = "F" + strconv.Itoa(n)
	default:
		return "", fmt.Errorf("キー %q は A-Z / 0-9 / Space / F1-F20 から選んでください", key)
	}
	parts[last] = key
	return strings.Join(parts, "+"), nil
}
