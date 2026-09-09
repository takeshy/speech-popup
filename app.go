package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/takeshy/speech-popup/internal/i18n"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/takeshy/speech-popup/internal/clipboard"
	"github.com/takeshy/speech-popup/internal/config"
	"github.com/takeshy/speech-popup/internal/desktop"
	"github.com/takeshy/speech-popup/internal/hotkey"
	"github.com/takeshy/speech-popup/internal/ipc"
	"github.com/takeshy/speech-popup/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// appIdentifier names the per-user directories owned by this app.
const appIdentifier = "speech-popup"

// App is the Wails application: a permanently resident popup window that is
// shown/hidden on demand. Exported methods are exposed to the frontend as
// bindings.
type App struct {
	application *application.App
	window      *application.WebviewWindow
	cfg         *config.Config
	store       *store.Store
	copier      *clipboard.Copier
	desktop     desktop.Platform
	hotkeyMgr   *hotkey.Manager
	ctx         context.Context
	// hotkeyErr explains why the in-app hotkey is not active. Another
	// application already owning the combination is the common case, and it is
	// otherwise invisible: the daemon has no console.
	hotkeyErr string
	tray      *application.SystemTray
	trayOnce  sync.Once
	// pendingOverlay asks the frontend to open Settings or Help as soon as the
	// window is shown (used by the tray menu).
	pendingOverlay string
	// pendingAppend is the marker `show --append` asked for: it is added to the
	// transcript this popup copies, so the caller can tell its own paste from
	// any other, and can tell "nothing was dictated" from "not mine".
	pendingAppend string

	actionMu       sync.Mutex
	mu             sync.Mutex
	visible        bool
	ready          bool
	pendingShow    bool
	pasteAfterHide bool
	overlayOpen    bool
	contentHeight  int
	ipcServer      *ipc.Server
}

func NewApp(wailsApp *application.App, cfg *config.Config) *App {
	return &App{application: wailsApp, cfg: cfg}
}

func (a *App) SetWindow(window *application.WebviewWindow) { a.window = window }

// ServiceStartup is called by Wails once all services are registered.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	a.copier = clipboard.New(a.cfg.Clipboard.Backend, a.application.Clipboard.SetText)
	a.desktop = desktop.New()

	a.startHotkey(a.cfg.Hotkey)

	historyStore, err := store.New()
	if err != nil {
		log.Printf("history store: %v", err)
	} else {
		a.store = historyStore
	}

	endpoint := ipc.PrepareEndpoint(ipc.Endpoint())
	server, err := ipc.NewServer(endpoint)
	if err != nil {
		// Another daemon won the race for the endpoint. Staying resident
		// without IPC would leave an orphaned process nothing could ever
		// show/hide/toggle/quit, so back out and let the winner run.
		log.Printf("ipc server: %v", err)
		a.application.Quit()
		return nil
	}
	a.ipcServer = server
	server.SetHandler(a.handleCommand)
	server.SetQuitCallback(func() {
		a.application.Quit()
	})
	go server.Serve()
	return nil
}

// ServiceShutdown flushes pending writes and closes the socket.
func (a *App) ServiceShutdown() error {
	if a.hotkeyMgr != nil {
		a.hotkeyMgr.Stop()
	}
	a.mu.Lock()
	tray := a.tray
	a.tray = nil
	a.mu.Unlock()
	if tray != nil {
		tray.Destroy()
	}
	if a.ipcServer != nil {
		a.ipcServer.Close()
	}
	if a.store != nil {
		return a.store.Flush()
	}
	return nil
}

func (a *App) handleCommand(command string, opts ipc.Options) error {
	switch command {
	case "show":
		a.showPopupWithAppend(opts.Append)
	case "hide":
		a.HidePopup()
	case "toggle":
		a.TogglePopup()
	}
	return nil
}

// startHotkey (re)registers the in-app global hotkey and records any failure
// so the UI can report it. It is not fatal: the popup stays reachable through
// `speech-popup show` and the platform's own shortcut facilities.
func (a *App) startHotkey(cfg config.HotkeyConfig) {
	if a.hotkeyMgr != nil {
		a.hotkeyMgr.Stop()
		a.hotkeyMgr = nil
	}
	a.mu.Lock()
	a.hotkeyErr = ""
	a.mu.Unlock()
	if !cfg.Enabled {
		return
	}
	mgr, err := hotkey.Start(cfg.Accelerator, a.ShowPopup)
	if err != nil {
		message := describeHotkeyError(cfg.Accelerator, err)
		a.mu.Lock()
		a.hotkeyErr = message
		a.mu.Unlock()
		log.Printf("hotkey: %s (%v)", message, err)
		return
	}
	a.hotkeyMgr = mgr
	log.Printf("hotkey: registered %s", cfg.Accelerator)
}

// describeHotkeyError turns the Win32 failure into something actionable. The
// overwhelmingly common cause is another application holding the combination.
func describeHotkeyError(accelerator string, err error) string {
	if errors.Is(err, hotkey.ErrUnsupported) {
		return i18n.T("アプリ内ホットキーは Windows 専用です。この OS ではコンポジタ/OS 側で `speech-popup show` に割り当ててください。")
	}
	if runtime.GOOS == "windows" && strings.Contains(err.Error(), "1409") {
		return fmt.Sprintf(i18n.T("%s は他のアプリが既に登録しているため使えません。設定で別のキーにしてください。"), accelerator)
	}
	return fmt.Sprintf(i18n.T("ホットキー %s を登録できません: %v"), accelerator, err)
}

func (a *App) openFileDialog(title string, filters []application.FileFilter) (string, error) {
	if a.application == nil {
		return "", fmt.Errorf("application is not running")
	}
	return a.application.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: title, Filters: filters,
	}).PromptForSingleSelection()
}

func (a *App) openURL(url string) error {
	if a.application == nil {
		return fmt.Errorf("application is not running")
	}
	return a.application.Browser.OpenURL(url)
}

// TogglePopup flips window visibility.
func (a *App) TogglePopup() {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()

	a.mu.Lock()
	if !a.ready {
		a.pendingShow = !a.pendingShow
		a.mu.Unlock()
		return
	}
	visible := a.visible
	a.mu.Unlock()

	if visible {
		a.hidePopupLocked()
	} else {
		a.showPopupLocked()
	}
}

// IsVisible reports whether the popup window is currently shown.
func (a *App) IsVisible() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.visible
}

// ShowPopup shows the window and tells the frontend to restore its session.
// If it is already visible, the window and text area are focused instead.
// Requests received before NotifyReady are queued.
func (a *App) ShowPopup() {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.showPopupLocked()
}

// ShowPopupWithOverlay shows the window and asks the frontend to open one of
// the overlays straight away. The tray menu uses it so Settings is reachable
// even when the popup has never been opened.
func (a *App) ShowPopupWithOverlay(overlay string) {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.mu.Lock()
	a.pendingOverlay = overlay
	a.mu.Unlock()
	a.showPopupLocked()
}

// showPopupWithAppend shows the popup and records the marker for the copy that
// closes it. A show without one clears any marker left over, so a popup opened
// by the hotkey never carries the previous caller's text.
func (a *App) showPopupWithAppend(append string) {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.mu.Lock()
	a.pendingAppend = append
	a.mu.Unlock()
	a.showPopupLocked()
}

func (a *App) showPopupLocked() {
	a.mu.Lock()
	if !a.ready {
		a.pendingShow = true
		a.mu.Unlock()
		return
	}
	overlay := a.pendingOverlay
	a.pendingOverlay = overlayNone
	if a.visible {
		a.mu.Unlock()
		if a.window != nil {
			a.window.Show().Focus()
		}
		if a.application != nil {
			a.application.Event.Emit("popup:focus-input", overlay)
		}
		return
	}
	a.visible = true
	a.mu.Unlock()

	// Capture who had focus before our window takes it (no-op on Linux,
	// where the compositor tracks this for us).
	if a.desktop != nil {
		a.desktop.RememberFocus()
	}
	a.window.Show()
	a.application.Event.Emit("popup:shown", overlay)
}

// HidePopup hides the window (the daemon keeps running), flushing any staged
// history writes first. When auto-paste is enabled and text was just copied,
// focus is restored to the previous window and the configured paste shortcut
// (clipboard.paste_key) is sent after the configured delay.
func (a *App) HidePopup() {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.hidePopupLocked()
}

func (a *App) hidePopupLocked() {
	a.mu.Lock()
	wasVisible := a.visible
	a.visible = false
	a.pendingShow = false
	a.pendingAppend = ""
	doPaste := a.pasteAfterHide
	a.pasteAfterHide = false
	a.mu.Unlock()

	if !wasVisible && !doPaste {
		return
	}
	if a.application != nil {
		// Release the microphone even if the frontend is mid-recording.
		a.application.Event.Emit("popup:hidden")
	}
	if a.store != nil {
		if err := a.store.Flush(); err != nil {
			log.Printf("history flush: %v", err)
		}
	}
	a.window.Hide()
	if a.desktop == nil {
		return
	}
	if a.cfg.Window.RestoreFocus || doPaste {
		a.desktop.RestoreFocus()
	}
	if doPaste {
		time.Sleep(time.Duration(a.cfg.Clipboard.AutoPasteDelayMs) * time.Millisecond)
		if err := a.desktop.PasteKeys(a.cfg.Clipboard.PasteKey); err != nil {
			log.Printf("paste: %v", err)
		}
	}
}

// NotifyReady is called by the frontend once its settings and history have
// loaded; a queued show request is served now.
func (a *App) NotifyReady() {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()

	a.mu.Lock()
	a.ready = true
	pending := a.pendingShow
	a.pendingShow = false
	a.mu.Unlock()

	if pending {
		a.showPopupLocked()
	}
}

// LoadHistory returns the persisted copy history JSON.
func (a *App) LoadHistory() string {
	if a.store == nil {
		return "[]"
	}
	return a.store.LoadHistory()
}

// SaveHistory persists the copy history JSON (debounced).
func (a *App) SaveHistory(data string) error {
	if a.store == nil {
		return nil
	}
	return a.store.SaveHistory(data)
}

// ReadClipboard returns the current plain-text clipboard content.
func (a *App) ReadClipboard() string {
	if a.application == nil {
		return ""
	}
	text, ok := a.application.Clipboard.Text()
	if !ok {
		return ""
	}
	return text
}

// CopyTranscript copies what the popup holds, with the marker from
// `show --append` added. The marker is appended even when nothing was
// dictated, so pressing Enter on an empty popup is a message the caller can
// act on (typically: the user is done talking) rather than silence.
// It reports false when there was nothing to copy at all, which the frontend
// tells apart from a clipboard failure.
func (a *App) CopyTranscript(text string) (bool, error) {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	a.mu.Lock()
	marker := a.pendingAppend
	a.mu.Unlock()
	if marker != "" {
		if text != "" && !strings.HasSuffix(text, " ") {
			text += " "
		}
		text += marker
	}
	if text == "" {
		return false, nil
	}
	if err := a.copyToClipboard(text); err != nil {
		return false, err
	}
	a.mu.Lock()
	a.pendingAppend = ""
	a.mu.Unlock()
	return true, nil
}

// CopyToClipboard places text on the clipboard. It arms the auto-paste step
// performed by HidePopup when enabled.
func (a *App) CopyToClipboard(text string) error {
	a.actionMu.Lock()
	defer a.actionMu.Unlock()
	return a.copyToClipboard(text)
}

func (a *App) copyToClipboard(text string) error {
	a.mu.Lock()
	a.pasteAfterHide = false
	a.mu.Unlock()
	if text == "" {
		return nil
	}
	if a.copier == nil {
		return errClipboardUnavailable{}
	}
	if err := a.copier.Copy(text); err != nil {
		return err
	}
	a.mu.Lock()
	a.pasteAfterHide = a.cfg.Clipboard.AutoPaste
	a.mu.Unlock()
	return nil
}

type errClipboardUnavailable struct{}

func (errClipboardUnavailable) Error() string { return "clipboard is not ready" }
