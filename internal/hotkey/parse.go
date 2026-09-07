package hotkey

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Win32 modifier flags shared with hotkey_windows.go.
const (
	modAlt     = 0x0001
	modControl = 0x0002
	modShift   = 0x0004
	modWin     = 0x0008
)

// ParseAccelerator converts "Ctrl+Shift+K" style strings into Win32
// modifier flags and a virtual-key code.
func ParseAccelerator(s string) (mods uint32, vk uint16, err error) {
	parts := strings.Split(strings.TrimSpace(s), "+")
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("hotkey: %q needs at least one modifier and a key", s)
	}
	for _, part := range parts[:len(parts)-1] {
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "ctrl", "control":
			mods |= modControl
		case "shift":
			mods |= modShift
		case "alt":
			mods |= modAlt
		case "win", "meta", "super":
			mods |= modWin
		default:
			return 0, 0, fmt.Errorf("hotkey: unknown modifier %q", part)
		}
	}
	vk, err = virtualKeyCode(strings.TrimSpace(parts[len(parts)-1]))
	if err != nil {
		return 0, 0, err
	}
	return mods, vk, nil
}

func virtualKeyCode(token string) (uint16, error) {
	token = strings.ToUpper(strings.TrimSpace(token))
	switch {
	case len(token) == 1:
		c := token[0]
		if c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' {
			return uint16(c), nil
		}
	case len(token) >= 2 && token[0] == 'F':
		if n, err := strconv.Atoi(token[1:]); err == nil && n >= 1 && n <= 24 {
			return uint16(0x6F + n), nil
		}
	}
	return 0, fmt.Errorf("hotkey: unsupported key %q (use A-Z, 0-9 or F1-F24)", token)
}

// ErrUnsupported is returned on platforms where speech-popup does not register
// its own global hotkey.
var ErrUnsupported = errors.New("hotkey: not supported on this platform")
