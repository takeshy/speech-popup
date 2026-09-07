//go:build windows

// Package hotkey registers an OS-level global hotkey that toggles the
// popup. Only Windows needs an in-app registration: on Linux the key
// binding belongs to Hyprland, and on macOS users assign one via the OS
// (Shortcuts.app / launcher tools) because there is no portable
// RegisterHotKey equivalent without accessibility permissions.
package hotkey

import (
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                 = windows.NewLazySystemDLL("user32.dll")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procRegisterHotKey     = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey   = user32.NewProc("UnregisterHotKey")
	procGetMessage         = user32.NewProc("GetMessageW")
	procPostThreadMessage  = user32.NewProc("PostThreadMessageW")
	procGetCurrentThreadId = kernel32.NewProc("GetCurrentThreadId")
)

const (
	wmQuit        = 0x0012
	wmHotkey      = 0x0312
	modNoRepeat   = 0x4000
	hotkeyID      = 1
	msgBufferSize = 48 // sizeof(MSG) on 64-bit Windows
)

// Manager owns the thread that receives WM_HOTKEY messages.
type Manager struct {
	stopOnce sync.Once
	threadID uint32
	done     chan struct{}
}

// Start registers accelerator (e.g. "Ctrl+Shift+K") as a global hotkey
// and invokes onTrigger whenever it is pressed. The returned stop
// function unregisters it and ends the message loop.
func Start(accelerator string, onTrigger func()) (*Manager, error) {
	mods, vk, err := ParseAccelerator(accelerator)
	if err != nil {
		return nil, err
	}
	if onTrigger == nil {
		return nil, fmt.Errorf("hotkey: onTrigger is nil")
	}
	mods |= modNoRepeat

	m := &Manager{done: make(chan struct{})}
	startErr := make(chan error, 1)

	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		tid, _, _ := procGetCurrentThreadId.Call()
		m.threadID = uint32(tid)

		ret, _, callErr := procRegisterHotKey.Call(0, hotkeyID, uintptr(mods), uintptr(vk))
		if ret == 0 {
			startErr <- fmt.Errorf("RegisterHotKey(%s): %v", accelerator, callErr)
			return
		}
		close(startErr)

		var msg [msgBufferSize]byte
		for {
			r, _, _ := procGetMessage.Call(
				uintptr(unsafe.Pointer(&msg[0])),
				0, 0, 0,
			)
			if int32(r) <= 0 { // 0 = WM_QUIT, -1 = error
				break
			}
			message := *(*uint32)(unsafe.Pointer(&msg[8]))
			wParam := *(*uintptr)(unsafe.Pointer(&msg[16]))
			if message == wmHotkey && wParam == hotkeyID {
				go onTrigger()
			}
		}
		close(m.done)
	}()

	if err := <-startErr; err != nil {
		return nil, err
	}
	return m, nil
}

// Stop unregisters the hotkey and terminates the message loop.
func (m *Manager) Stop() {
	m.stopOnce.Do(func() {
		procUnregisterHotKey.Call(0, hotkeyID)
		if m.threadID != 0 {
			procPostThreadMessage.Call(uintptr(m.threadID), wmQuit, 0, 0)
		}
	})
}

// Done reports when the message loop has exited.
func (m *Manager) Done() <-chan struct{} { return m.done }
