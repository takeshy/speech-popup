//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

var (
	kernel32DLL       = windows.NewLazySystemDLL("kernel32.dll")
	procAttachConsole = kernel32DLL.NewProc("AttachConsole")
)

// attachParentProcess is ATTACH_PARENT_PROCESS ((DWORD)-1).
const attachParentProcess = ^uintptr(0)

// attachParentConsole reconnects the standard streams to the console that
// launched us.
//
// The daemon is linked with -H windowsgui so that starting it never flashes a
// console window. That subsystem also means Windows attaches no console at
// all, so every fmt.Print in the CLI paths (status, version, "a daemon is
// already running", command errors) is written to an invalid handle and
// silently discarded. Attaching to the parent gives those back when the
// program was started from a terminal, and is a harmless no-op when it was
// not (double-click, autostart, a compositor exec).
func attachParentConsole() {
	if ret, _, _ := procAttachConsole.Call(attachParentProcess); ret == 0 {
		return
	}
	// The Go runtime captured the (invalid) handles at startup, so the files
	// have to be reopened for fmt to reach the console.
	if out, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
		os.Stdout = out
		os.Stderr = out
	}
	if in, err := os.OpenFile("CONIN$", os.O_RDWR, 0); err == nil {
		os.Stdin = in
	}
}
