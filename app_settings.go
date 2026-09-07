package main

import (
	"fmt"
	"runtime"

	"github.com/takeshy/speech-popup/internal/clipboard"
	"github.com/takeshy/speech-popup/internal/config"
	"github.com/takeshy/speech-popup/internal/store"
)

// Bindings behind the ⋮ menu: version/help info and the Settings dialog.

// AppInfo is the read-only information shown in the menu and Settings.
type AppInfo struct {
	Version    string `json:"version"`
	OS         string `json:"os"`
	ConfigPath string `json:"configPath"`
	DataDir    string `json:"dataDir"`
	LogPath    string `json:"logPath"`
	// Hotkey* report whether the in-app global hotkey is actually live. The
	// daemon has no console, so this is the only place a registration failure
	// can surface.
	HotkeyEnabled bool   `json:"hotkeyEnabled"`
	HotkeyKey     string `json:"hotkeyKey"`
	HotkeyActive  bool   `json:"hotkeyActive"`
	HotkeyError   string `json:"hotkeyError"`
}

// SaveConfigResult reports what SaveConfig applied immediately.
type SaveConfigResult struct {
	Path    string `json:"path"`
	Warning string `json:"warning"`
}

// Minimum window size while the Settings/Help overlay is open; the popup
// itself is deliberately small.
const (
	overlayMinWidth  = 640
	overlayMinHeight = 600
)

// GetAppInfo returns version and path information for the menu.
func (a *App) GetAppInfo() AppInfo {
	a.mu.Lock()
	hotkeyErr := a.hotkeyErr
	enabled := a.cfg.Hotkey.Enabled
	key := a.cfg.Hotkey.Accelerator
	a.mu.Unlock()
	return AppInfo{
		Version:       appVersion(),
		OS:            runtime.GOOS,
		ConfigPath:    config.Path(),
		DataDir:       store.DataDir(),
		LogPath:       logPath(),
		HotkeyEnabled: enabled,
		HotkeyKey:     key,
		HotkeyActive:  enabled && hotkeyErr == "",
		HotkeyError:   hotkeyErr,
	}
}

// LoadConfig returns the configuration currently in effect.
func (a *App) LoadConfig() config.View {
	a.mu.Lock()
	defer a.mu.Unlock()
	return config.ToView(a.cfg)
}

// SaveConfig validates, writes config.toml, and applies what can change at
// runtime: window size, speech settings, clipboard behaviour, and (on Windows)
// the hotkey. Every setting takes effect without a restart.
func (a *App) SaveConfig(view config.View) (SaveConfigResult, error) {
	next, err := config.FromView(view)
	if err != nil {
		return SaveConfigResult{}, err
	}
	path := config.Path()
	if err := config.Save(path, next); err != nil {
		return SaveConfigResult{}, fmt.Errorf("設定ファイルを書き込めません: %w", err)
	}

	a.actionMu.Lock()
	defer a.actionMu.Unlock()

	result := SaveConfigResult{Path: path}
	a.mu.Lock()
	prev := *a.cfg
	*a.cfg = *next
	overlay := a.overlayOpen
	a.mu.Unlock()

	if prev.Clipboard.Backend != next.Clipboard.Backend && a.application != nil {
		a.copier = clipboard.New(next.Clipboard.Backend, a.application.Clipboard.SetText)
	}
	if prev.Hotkey != next.Hotkey {
		a.startHotkey(next.Hotkey)
		a.mu.Lock()
		result.Warning = a.hotkeyErr
		a.mu.Unlock()
	}
	if a.window != nil && !overlay && (prev.Window.Width != next.Window.Width || prev.Window.Height != next.Window.Height) {
		a.window.SetSize(next.Window.Width, next.Window.Height)
	}
	return result, nil
}

// SetOverlayOpen grows the window while a Settings/Help overlay is shown and
// restores the configured size when it closes.
func (a *App) SetOverlayOpen(open bool) {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.mu.Lock()
	a.overlayOpen = open
	width, height := a.cfg.Window.Width, a.cfg.Window.Height
	a.mu.Unlock()
	if a.window == nil {
		return
	}
	if open {
		a.window.SetSize(max(width, overlayMinWidth), max(height, overlayMinHeight))
	} else {
		a.window.SetSize(width, height)
	}
}
