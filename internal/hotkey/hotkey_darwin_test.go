package hotkey

import (
	"errors"
	"testing"
)

type testRegistry map[string]func()

func (r testRegistry) Register(key string, cb func()) error {
	if r.IsRegistered(key) {
		return errors.New("already registered")
	}
	r[key] = cb
	return nil
}

func (r testRegistry) IsRegistered(key string) bool { return r[key] != nil }

func (r testRegistry) Unregister(key string) error {
	delete(r, key)
	return nil
}

func TestMacHotkeyLifecycle(t *testing.T) {
	registry := testRegistry{}
	calls := 0
	m, err := Start(registry, "Control+8", func() { calls++ })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Start(registry, "Ctrl+8", func() {}); err == nil {
		t.Fatal("expected registration conflict")
	}
	trigger := registry["Ctrl+8"]
	if trigger == nil {
		t.Fatal("Ctrl+8 was not registered")
	}
	trigger()
	if calls != 1 || !m.Active() {
		t.Fatal("registered shortcut did not invoke its original handler")
	}
	m.Stop()
	if m.Active() || len(registry) != 0 {
		t.Fatal("shortcut remained registered after Stop")
	}
}

func TestMacAccelerator(t *testing.T) {
	for in, want := range map[string]string{
		"Alt+Win+1": "Option+Cmd+1", "Command + Space": "Cmd+SPACE",
		"option+f20": "Option+F20", "Cmd+F21": "", "K": "", "Ctrl+": "", "Hyper+X": "",
	} {
		got, err := macAccelerator(in)
		if got != want || (err != nil) != (want == "") {
			t.Errorf("macAccelerator(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}
