//go:build darwin

// Focus restoration uses AppKit without Automation permissions. Automatic
// paste uses System Events and requires Accessibility/Automation permission.
package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static int speechFrontmostPID(void) {
    __block int pid = 0;
    void (^capture)(void) = ^{
        NSRunningApplication *app = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (app && app.processIdentifier != [[NSProcessInfo processInfo] processIdentifier]) {
            pid = app.processIdentifier;
        }
    };
    if ([NSThread isMainThread]) capture();
    else dispatch_sync(dispatch_get_main_queue(), capture);
    return pid;
}

static void speechRestoreFocus(int pid) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (app && pid != [[NSProcessInfo processInfo] processIdentifier]) {
            [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
        }
    });
}
*/
import "C"

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Darwin struct {
	mu  sync.Mutex
	pid int
}

func newPlatform() Platform { return &Darwin{} }

func (*Darwin) Name() string { return "darwin" }

func osascript(script string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "osascript", "-e", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("osascript: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// RememberFocus snapshots the frontmost application, excluding ourselves.
func (d *Darwin) RememberFocus() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pid = int(C.speechFrontmostPID())
}

// RestoreFocus reactivates the remembered application without reopening us.
func (d *Darwin) RestoreFocus() {
	d.mu.Lock()
	pid := d.pid
	d.mu.Unlock()

	if pid != 0 {
		C.speechRestoreFocus(C.int(pid))
	}
}

// PasteKeys sends the configured paste shortcut via System Events. The
// config's "ctrl" modifier maps to Cmd, macOS's paste modifier.
func (*Darwin) PasteKeys(shortcut string) error {
	modifiers := "command down"
	if shortcut == PasteCtrlShiftV {
		// Preserve Shift only when the user explicitly selects it.
		modifiers = "{command down, shift down}"
	}
	_, err := osascript(fmt.Sprintf(`tell application "System Events" to keystroke "v" using %s`, modifiers))
	return err
}
