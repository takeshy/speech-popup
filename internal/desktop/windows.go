//go:build windows

// Windows implements paste via SendInput and focus restoration by
// remembering the foreground window handle captured right before the
// popup window is shown.
package desktop

import (
	"fmt"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procIsIconic            = user32.NewProc("IsIconic")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSendInput           = user32.NewProc("SendInput")
)

const (
	inputKeyboard  = 1
	keyeventfKeyup = 0x0002
	vkShift        = 0x10
	vkControl      = 0x11
	vkV            = 0x56
	swRestore      = 9
)

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

// winInput mirrors C INPUT: DWORD type; union { MOUSEINPUT mi;
// KEYBDINPUT ki; ... }. The union starts at offset 8 (pointer alignment)
// and MOUSEINPUT, the largest member, is 32 bytes on 64-bit Windows.
type winInput struct {
	msgType uint32
	_       uint32
	ki      keybdInput
	_       [8]byte
}

// Windows implements Platform for Microsoft Windows.
type Windows struct {
	mu       sync.Mutex
	prevHwnd uintptr
}

func newPlatform() Platform { return &Windows{} }

func (*Windows) Name() string { return "windows" }

// RememberFocus snapshots the currently focused window. Called just
// before the popup takes focus.
func (d *Windows) RememberFocus() {
	hwnd, _, _ := procGetForegroundWindow.Call()
	d.mu.Lock()
	d.prevHwnd = hwnd
	d.mu.Unlock()
}

// RestoreFocus returns focus to the remembered window. Because our own
// window held focus immediately before this call, Windows permits the
// switch in practice; if it is denied the popup simply stays hidden with
// focus on whatever the compositor picked.
func (d *Windows) RestoreFocus() {
	d.mu.Lock()
	hwnd := d.prevHwnd
	d.mu.Unlock()
	d.activate(hwnd)
}

// activate brings the window that was active before the popup back to the
// foreground. WindowHide is asynchronous on WebView2, so PasteKeys calls this
// again immediately before injecting the shortcut.
func (d *Windows) activate(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procSetForegroundWindow.Call(hwnd)
}

// PasteKeys sends the configured paste shortcut to whatever window has
// keyboard focus.
func (d *Windows) PasteKeys(shortcut string) error {
	d.mu.Lock()
	hwnd := d.prevHwnd
	d.prevHwnd = 0
	d.mu.Unlock()
	if hwnd != 0 {
		d.activate(hwnd)
		// Give Windows a short opportunity to complete the foreground switch.
		// This is separate from auto_paste_delay_ms, which starts before this
		// final focus correction.
		for i := 0; i < 10; i++ {
			foreground, _, _ := procGetForegroundWindow.Call()
			if foreground == hwnd {
				break
			}
			time.Sleep(10 * time.Millisecond)
			d.activate(hwnd)
		}
	}

	modifiers := []uint16{vkControl}
	if shortcut == PasteCtrlShiftV {
		// Windows terminals paste on Ctrl+Shift+V.
		modifiers = append(modifiers, vkShift)
	}

	inputs := make([]winInput, 0, len(modifiers)*2+2)
	addKey := func(vk uint16, flags uint32) {
		var input winInput
		input.msgType = inputKeyboard
		input.ki.wVk = vk
		input.ki.dwFlags = flags
		inputs = append(inputs, input)
	}
	for _, vk := range modifiers {
		addKey(vk, 0)
	}
	addKey(vkV, 0)
	addKey(vkV, keyeventfKeyup)
	for i := len(modifiers) - 1; i >= 0; i-- {
		addKey(modifiers[i], keyeventfKeyup)
	}

	ret, _, callErr := procSendInput.Call(
		uintptr(len(inputs)),
		uintptr(unsafe.Pointer(&inputs[0])),
		unsafe.Sizeof(inputs[0]),
	)
	if ret != uintptr(len(inputs)) {
		return fmt.Errorf("SendInput sent %d of %d events: %v", ret, len(inputs), callErr)
	}
	return nil
}
