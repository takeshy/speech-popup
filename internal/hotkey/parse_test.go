package hotkey

import "testing"

func TestParseAccelerator(t *testing.T) {
	tests := []struct {
		in      string
		wantMod uint32
		wantVK  uint16
		wantErr bool
	}{
		{"Ctrl+Shift+K", modControl | modShift, 'K', false},
		{"Control+Alt+F5", modControl | modAlt, 0x74, false},
		{"ctrl+shift+k", modControl | modShift, 'K', false},
		{"Win+1", modWin, '1', false},
		{"Ctrl + Shift + L", modControl | modShift, 'L', false},
		{"K", 0, 0, true},          // no modifier
		{"Ctrl+", 0, 0, true},      // empty key
		{"Hyper+K", 0, 0, true},    // unknown modifier
		{"Ctrl+Space", 0, 0, true}, // unsupported key
		{"Ctrl+F25", 0, 0, true},   // out of range
	}
	for _, tt := range tests {
		mods, vk, err := ParseAccelerator(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Errorf("ParseAccelerator(%q) expected error", tt.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseAccelerator(%q): %v", tt.in, err)
			continue
		}
		if mods != tt.wantMod || vk != tt.wantVK {
			t.Errorf("ParseAccelerator(%q) = (%d, %d), want (%d, %d)", tt.in, mods, vk, tt.wantMod, tt.wantVK)
		}
	}
}
