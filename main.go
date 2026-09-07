package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/takeshy/speech-popup/internal/config"
	"github.com/takeshy/speech-popup/internal/ipc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed wails.json
var wailsJSON []byte

//go:embed build/appicon.png
var appIcon []byte

//go:embed build/trayicon.png
var trayIcon []byte

//go:embed build/trayicon-dark.png
var trayIconDark []byte

// version can be overridden at link time (-ldflags "-X main.version=...");
// otherwise it is read from the embedded wails.json so the bump commit is
// the single source of truth.
var version = ""

func appVersion() string {
	if version != "" {
		return version
	}
	var manifest struct {
		Info struct {
			Version string `json:"version"`
		} `json:"info"`
	}
	if err := json.Unmarshal(wailsJSON, &manifest); err == nil && manifest.Info.Version != "" {
		return manifest.Info.Version
	}
	return "dev"
}

func main() {
	// -H windowsgui leaves the process without a console, which would discard
	// every message below. Do this before anything prints.
	attachParentConsole()

	if len(os.Args) > 1 {
		command := os.Args[1]
		switch command {
		case "-h", "--help", "help":
			usage()
			return
		case "version", "--version":
			fmt.Println("speech-popup", appVersion())
			return
		case "status":
			printStatus()
			return
		}
		if err := ipc.RunClientCommand(command); err != nil {
			fmt.Fprintln(os.Stderr, "speech-popup:", err)
			os.Exit(1)
		}
		return
	}
	runDaemon()
}

// printStatus reports what a user cannot otherwise see: whether a daemon is
// actually listening, and where its configuration and log live. It runs
// entirely in the short-lived client process, so it works even when the
// daemon is wedged.
func printStatus() {
	endpoint := ipc.Endpoint()
	running := ipc.IsDaemonRunning(endpoint)
	fmt.Println("speech-popup", appVersion())
	fmt.Printf("daemon:   %s\n", map[bool]string{true: "running", false: "not running"}[running])
	fmt.Printf("endpoint: %s\n", endpoint)
	fmt.Printf("config:   %s\n", config.Path())
	fmt.Printf("log:      %s\n", logPath())
	if !running {
		fmt.Println("\nStart it with `speech-popup` (no arguments), then `speech-popup show`.")
		return
	}
	fmt.Println("\nThe daemon is listening. `speech-popup show` should display the window;")
	fmt.Println("if it does not, the log above records why the frontend never became ready.")
}

// runDaemon starts the resident process. A second daemon exits without
// touching the running one.
func runDaemon() {
	// Logging is set up before anything can exit, so that even "already
	// running" leaves a trace. A silent early exit here is indistinguishable
	// from a broken hotkey, which is exactly the confusion to avoid.
	closeLog := setupLogging()
	defer closeLog()

	endpoint := ipc.Endpoint()
	if ipc.IsDaemonRunning(endpoint) {
		log.Printf("another speech-popup daemon already owns %s; exiting", endpoint)
		fmt.Fprintf(os.Stderr, "speech-popup: a daemon is already running (%s).\n", endpoint)
		fmt.Fprintln(os.Stderr, "Stop it with `speech-popup quit` before starting a new build.")
		os.Exit(1)
	}

	cfg := config.Load()
	log.Printf("starting speech-popup %s (config %s)", appVersion(), config.Path())
	wailsApp := application.New(application.Options{
		Name:        "speech-popup",
		Description: "Speech input popup window",
		Icon:        appIcon,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})
	app := NewApp(wailsApp, cfg)
	wailsApp.RegisterService(application.NewService(app))

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "popup",
		Title:            "speech-popup",
		Width:            cfg.Window.Width,
		Height:           cfg.Window.Height,
		Frameless:        true,
		AlwaysOnTop:      true,
		Hidden:           true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/",
		// The whole point of this app is recording, so grant the microphone
		// without a WebView prompt. On macOS the OS-level TCC prompt still
		// applies the first time.
		Permissions: map[application.PermissionType]application.Permission{
			application.PermissionMicrophone: application.PermissionAllow,
		},
		Windows: application.WindowsWindow{
			// The popup is summoned by a hotkey and lives in the notification
			// area; a taskbar button for it is just a second, confusing icon
			// (and it carries the framework's default icon, not ours).
			HiddenOnTaskbar: true,
		},
		Linux: application.LinuxWindow{Icon: appIcon},
	})
	app.SetWindow(window)
	// New queues the tray for Wails startup. Configure its icon and callbacks
	// before Run so the native tray is created exactly once, fully configured.
	app.startSystemTray(trayIcon, trayIconDark)

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}

func usage() {
	fmt.Println(`speech-popup - Speech input popup window

Usage:
  speech-popup            start the daemon (resident mode)
  speech-popup toggle     show/hide the popup window
  speech-popup show       show or focus the popup window
  speech-popup hide       hide the popup window
  speech-popup quit       stop the daemon
  speech-popup status     report whether a daemon is running, and where its files are
  speech-popup version    print the version`)
}
