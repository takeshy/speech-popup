package main

import (
	"testing"

	"github.com/takeshy/speech-popup/internal/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type popupTestWindow struct {
	*application.WebviewWindow
	visible bool
	hides   int
}

func (w *popupTestWindow) IsVisible() bool { return w.visible }

func (w *popupTestWindow) Hide() application.Window {
	w.hides++
	w.visible = false
	return w
}

func TestHidePopupClosesNativeWindowWithoutCachedVisibilityOrCopy(t *testing.T) {
	window := &popupTestWindow{visible: true}
	app := NewApp(nil, config.Default())
	app.window = window
	app.pendingShow = true
	app.pendingAppend = "marker"
	// macOS may bring a native window forward without going through ShowPopup.
	// Closing an empty editor must work even though app.visible is still false.
	app.HidePopup()
	if window.visible || window.hides != 1 {
		t.Fatalf("native window did not hide: visible=%t hides=%d", window.visible, window.hides)
	}
	if app.visible || app.pendingShow || app.pendingAppend != "" {
		t.Fatal("popup session state was not cleared")
	}
	app.HidePopup()
	if window.hides != 1 {
		t.Fatal("a duplicate hide should not repeat the native hide")
	}
}
