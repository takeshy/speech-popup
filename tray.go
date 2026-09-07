package main

import (
	"github.com/takeshy/speech-popup/internal/i18n"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Overlay identifiers passed to the frontend with popup:shown, so the tray can
// open the window straight into Settings or Help.
const (
	overlayNone     = ""
	overlaySettings = "settings"
	overlayHelp     = "help"
)

// startSystemTray adds the tray icon and its right-click menu. The daemon is
// otherwise invisible once it is resident: without this the only way to reach
// Settings is to get the popup open first, which is exactly what fails when
// the hotkey did not register.
//
// Call before application.Run: SystemTray.New queues its own Run for startup,
// allowing the icon, menu and handlers to be configured before native creation.
func (a *App) startSystemTray(icon, darkIcon []byte) {
	if a.application == nil {
		return
	}
	// Keep registration idempotent if another startup path requests the tray.
	a.trayOnce.Do(func() { a.createSystemTray(icon, darkIcon) })
}

func (a *App) createSystemTray(icon, darkIcon []byte) {
	tray := a.application.SystemTray.New()
	tray.SetTooltip("speech-popup")
	if len(icon) > 0 {
		tray.SetIcon(icon)
	}
	if len(darkIcon) > 0 {
		tray.SetDarkModeIcon(darkIcon)
	}

	tray.SetMenu(a.trayMenu())

	// The window is deliberately not attached to the tray: AttachWindow
	// repositions the popup next to the tray icon, and this popup is meant to
	// stay wherever the compositor centres it. Right-click is left to Run's
	// smart default, which opens the menu the native way on each platform.
	tray.OnClick(a.TogglePopup)
	// Do not call tray.Run here: New already scheduled it. Run is not
	// idempotent and a second call leaks the first native notification icon.

	a.mu.Lock()
	a.tray = tray
	a.mu.Unlock()
	log.Print("system tray: configured for startup")
}

func (a *App) trayMenu() *application.Menu {
	menu := application.NewMenu()
	menu.Add(i18n.T("音声入力を開く")).OnClick(func(*application.Context) { a.ShowPopup() })
	menu.Add(i18n.T("設定…")).OnClick(func(*application.Context) { a.ShowPopupWithOverlay(overlaySettings) })
	menu.Add(i18n.T("ヘルプ (キー操作)")).OnClick(func(*application.Context) { a.ShowPopupWithOverlay(overlayHelp) })
	menu.AddSeparator()
	menu.Add(i18n.T("終了")).OnClick(func(*application.Context) { a.application.Quit() })
	return menu
}

// SetUILanguage aligns native menus/errors with the WebView's preferred language.
// This is independent of the language used for speech recognition.
func (a *App) SetUILanguage(language string) {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	i18n.SetLanguage(language)
	a.mu.Lock()
	tray := a.tray
	a.mu.Unlock()
	if tray != nil {
		tray.SetMenu(a.trayMenu())
	}
}
