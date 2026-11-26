//go:build !darwin

package hotkey

const InvalidAcceleratorMessage = "ホットキー %q を解釈できません: A-Z, 0-9, F1-F24 と Ctrl/Shift/Alt/Win を + で繋いでください"

func ValidateAccelerator(s string) error {
	_, _, err := ParseAccelerator(s)
	return err
}
