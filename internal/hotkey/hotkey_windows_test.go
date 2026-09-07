//go:build windows

package hotkey

import "testing"

func TestStopReleasesHotkeyBeforeReregistering(t *testing.T) {
	const accelerator = "Ctrl+Alt+Shift+F24"
	m, err := Start(accelerator, func() {})
	if err != nil {
		t.Skipf("test hotkey unavailable: %v", err)
	}
	defer func() { m.Stop() }()
	for i := 0; i < 10; i++ {
		m.Stop()
		m.Stop() // stopping twice must remain safe
		select {
		case <-m.Done():
		default:
			t.Fatal("Stop returned before the message loop exited")
		}
		next, err := Start(accelerator, func() {})
		if err != nil {
			t.Fatalf("re-register after Stop: %v", err)
		}
		m = next
	}
}
