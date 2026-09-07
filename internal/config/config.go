// Package config loads the speech-popup configuration file.
//
// Only the small TOML subset used by speech-popup is supported: [section]
// headers and `key = value` pairs where value is a string ("..."),
// integer, or boolean. Unknown keys are ignored.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type WindowConfig struct {
	Width        int
	Height       int
	RestoreFocus bool
}

type ClipboardConfig struct {
	Backend          string // "wl-copy" | "wails"
	AutoPaste        bool
	AutoPasteDelayMs int
	PasteKey         string // "ctrl+v" | "ctrl+shift+v"
}

// HotkeyConfig registers an in-app global hotkey. This exists for
// Windows, which has no compositor bind equivalent; on Linux the binding
// belongs to Hyprland and on macOS to OS-level shortcut facilities
// (Shortcuts.app etc.), so the default is disabled there.
type HotkeyConfig struct {
	Enabled     bool
	Accelerator string // "Ctrl+Shift+K" style
}

// SpeechConfig selects the speech-to-text backend and how a recording is
// turned into text. api_key is stored in plain text in config.toml, which is
// written with 0600 permissions.
type SpeechConfig struct {
	// Provider is "browser" (the WebView's own SpeechRecognition, live
	// dictation) or "openai-compatible" (record, then POST the audio).
	Provider string
	// EndpointType selects the request shape used by "openai-compatible":
	// openai / custom (POST /audio/transcriptions), whisper-cpp
	// (POST /inference), gemini-transcribe and vertex-transcribe
	// (generateContent with inline audio).
	EndpointType    string
	BaseURL         string
	APIKey          string
	Model           string
	Language        string // BCP-47 tag, or "auto"
	SilenceSeconds  int    // 0 disables the automatic stop
	SendPhrase      string // spoken words that copy & close, comma separated
	VertexProjectID string
	// AutoStart begins recording as soon as the popup is shown.
	AutoStart bool
}

type Config struct {
	Window    WindowConfig
	Clipboard ClipboardConfig
	Hotkey    HotkeyConfig
	Speech    SpeechConfig
}

// Endpoint types accepted by SpeechConfig.EndpointType.
const (
	EndpointOpenAI     = "openai"
	EndpointWhisperCPP = "whisper-cpp"
	EndpointCustom     = "custom"
	EndpointGemini     = "gemini-transcribe"
	EndpointVertex     = "vertex-transcribe"
)

// Providers accepted by SpeechConfig.Provider.
const (
	ProviderBrowser = "browser"
	ProviderHTTP    = "openai-compatible"
)

// IsGoogleEndpoint reports whether endpointType uses the Gemini
// generateContent request shape (Gemini API or Vertex AI).
func IsGoogleEndpoint(endpointType string) bool {
	return endpointType == EndpointGemini || endpointType == EndpointVertex
}

func Default() *Config {
	return &Config{
		Window: WindowConfig{
			Width: 600,
			// Room for the text area, the recording meter, and a wrapped error
			// message without the layout having to squeeze the text area.
			Height:       300,
			RestoreFocus: true,
		},
		Clipboard: ClipboardConfig{
			Backend:          defaultClipboardBackend(),
			AutoPaste:        true,
			AutoPasteDelayMs: 80,
			PasteKey:         "ctrl+shift+v",
		},
		Hotkey: HotkeyConfig{
			Enabled: runtime.GOOS == "windows",
			// "8" reads as a microphone, which makes the binding easy to
			// remember. It is also reliably free: the obvious letter choices
			// (Ctrl+Shift+S in particular) are already taken on Windows by
			// OneDrive, ShareX and the Snipping Tool, and RegisterHotKey then
			// fails.
			Accelerator: "Ctrl+8",
		},
		Speech: SpeechConfig{
			// The browser recognizer needs no key or endpoint, so a fresh
			// install can transcribe immediately. Where the WebView ships no
			// recognizer the UI says so and points at the recorded services.
			Provider:       ProviderBrowser,
			EndpointType:   EndpointOpenAI,
			BaseURL:        "https://api.openai.com/v1",
			Model:          "whisper-1",
			Language:       "auto",
			SilenceSeconds: 3,
			SendPhrase:     "over, オーバー",
			AutoStart:      true,
		},
	}
}

func defaultClipboardBackend() string {
	if runtime.GOOS == "linux" {
		return "wl-copy"
	}
	// wl-clipboard does not exist on Windows/macOS; use the Wails
	// runtime binding (Win32 clipboard / NSPasteboard).
	return "wails"
}

// Dir returns the per-user configuration directory:
// $XDG_CONFIG_HOME/speech-popup (or ~/.config/speech-popup) on Linux,
// %AppData%/speech-popup on Windows, and
// ~/Library/Application Support/speech-popup on macOS.
func Dir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "speech-popup")
}

// Path returns the path to the configuration file.
func Path() string {
	dir := Dir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "config.toml")
}

// Load reads the configuration file, falling back to defaults for
// missing values or when the file does not exist.
func Load() *Config {
	path := Path()
	if path == "" {
		return Default()
	}
	return LoadFrom(path)
}

// LoadFrom parses the TOML subset at path on top of the defaults. A
// missing or unreadable file yields the defaults.
func LoadFrom(path string) *Config {
	cfg := Default()
	file, err := os.Open(path)
	if err != nil {
		return cfg
	}
	defer file.Close()

	section := ""
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		value := stripInlineComment(strings.TrimSpace(line[eq+1:]))
		if len(value) >= 2 && strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") {
			value = unquote(value[1 : len(value)-1])
		}
		cfg.apply(section, key, value)
	}
	return cfg
}

// quote renders a TOML basic string, escaping only the backslash and the
// double quote so Windows paths stay readable.
func quote(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	return "\"" + value + "\""
}

// unquote reverses quote; other escape sequences are kept verbatim.
func unquote(value string) string {
	if !strings.Contains(value, "\\") {
		return value
	}
	var b strings.Builder
	escaped := false
	for _, r := range value {
		switch {
		case escaped:
			b.WriteRune(r)
			escaped = false
		case r == '\\':
			escaped = true
		default:
			b.WriteRune(r)
		}
	}
	if escaped {
		b.WriteRune('\\')
	}
	return b.String()
}

func stripInlineComment(value string) string {
	inString := false
	escaped := false
	for i, r := range value {
		if inString && r == '\\' && !escaped {
			escaped = true
			continue
		}
		if r == '"' && !escaped {
			inString = !inString
		} else if r == '#' && !inString {
			return strings.TrimSpace(value[:i])
		}
		escaped = false
	}
	return strings.TrimSpace(value)
}

func (c *Config) apply(section, key, value string) {
	switch section {
	case "window":
		switch key {
		case "width":
			c.Window.Width = atoiOr(value, c.Window.Width)
		case "height":
			c.Window.Height = atoiOr(value, c.Window.Height)
		case "restore_focus":
			c.Window.RestoreFocus = value == "true"
		}
	case "clipboard":
		switch key {
		case "backend":
			if value == "wl-copy" || value == "wails" {
				c.Clipboard.Backend = value
			}
		case "auto_paste":
			c.Clipboard.AutoPaste = value == "true"
		case "auto_paste_delay_ms":
			c.Clipboard.AutoPasteDelayMs = atoiOr(value, c.Clipboard.AutoPasteDelayMs)
		case "paste_key":
			if value == "ctrl+v" || value == "ctrl+shift+v" {
				c.Clipboard.PasteKey = value
			}
		}
	case "hotkey":
		switch key {
		case "enabled":
			c.Hotkey.Enabled = value == "true"
		case "accelerator", "shortcut":
			if value != "" {
				c.Hotkey.Accelerator = normalizeAccelerator(value)
			}
		}
	case "speech":
		switch key {
		case "provider":
			if value == ProviderBrowser || value == ProviderHTTP {
				c.Speech.Provider = value
			}
		case "endpoint_type":
			if validEndpointType(value) {
				c.Speech.EndpointType = value
			}
		case "base_url":
			c.Speech.BaseURL = value
		case "api_key":
			c.Speech.APIKey = value
		case "model":
			c.Speech.Model = value
		case "language":
			c.Speech.Language = value
		case "silence_seconds":
			c.Speech.SilenceSeconds = atoiOr(value, c.Speech.SilenceSeconds)
		case "send_phrase":
			c.Speech.SendPhrase = value
		case "vertex_project_id":
			c.Speech.VertexProjectID = value
		case "auto_start":
			c.Speech.AutoStart = value == "true"
		}
	}
}

func validEndpointType(value string) bool {
	switch value {
	case EndpointOpenAI, EndpointWhisperCPP, EndpointCustom, EndpointGemini, EndpointVertex:
		return true
	default:
		return false
	}
}

// normalizeAccelerator rewrites "Ctrl Shift K" and "Ctrl + Shift + K" into
// the canonical "Ctrl+Shift+K" form.
func normalizeAccelerator(value string) string {
	return strings.Join(strings.FieldsFunc(strings.TrimSpace(value), func(r rune) bool {
		return r == '+' || r == ' '
	}), "+")
}

func atoiOr(value string, fallback int) int {
	n, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return n
}

// Marshal renders cfg as config.toml text covering every supported key,
// with the same comments as the README example so a file written by the
// Settings dialog stays readable and hand-editable.
func Marshal(c *Config) string {
	var b strings.Builder
	b.WriteString("[window]\n")
	fmt.Fprintf(&b, "width = %d\n", c.Window.Width)
	fmt.Fprintf(&b, "height = %d\n", c.Window.Height)
	b.WriteString("# 閉じたあとに直前のウィンドウへフォーカスを戻す\n")
	fmt.Fprintf(&b, "restore_focus = %t\n", c.Window.RestoreFocus)
	b.WriteString("\n[speech]\n")
	b.WriteString("# \"browser\" (WebView の音声認識) | \"openai-compatible\" (録音して STT へ POST)\n")
	fmt.Fprintf(&b, "provider = %s\n", quote(c.Speech.Provider))
	b.WriteString("# \"openai\" | \"whisper-cpp\" | \"custom\" | \"gemini-transcribe\" | \"vertex-transcribe\"\n")
	fmt.Fprintf(&b, "endpoint_type = %s\n", quote(c.Speech.EndpointType))
	fmt.Fprintf(&b, "base_url = %s\n", quote(c.Speech.BaseURL))
	b.WriteString("# 平文で保存される (config.toml は 0600 で書き込まれる)。vertex-transcribe では未使用\n")
	fmt.Fprintf(&b, "api_key = %s\n", quote(c.Speech.APIKey))
	fmt.Fprintf(&b, "model = %s\n", quote(c.Speech.Model))
	b.WriteString("# BCP-47 (ja / en / ja-JP ...) もしくは \"auto\"\n")
	fmt.Fprintf(&b, "language = %s\n", quote(c.Speech.Language))
	b.WriteString("# 無音がこの秒数続いたら録音を自動停止する (0 で無効)\n")
	fmt.Fprintf(&b, "silence_seconds = %d\n", c.Speech.SilenceSeconds)
	b.WriteString("# 認識結果の末尾がこの語なら、その語を除いてコピーして閉じる (カンマ区切り)\n")
	fmt.Fprintf(&b, "send_phrase = %s\n", quote(c.Speech.SendPhrase))
	b.WriteString("# vertex-transcribe で使う Google Cloud プロジェクト ID\n")
	fmt.Fprintf(&b, "vertex_project_id = %s\n", quote(c.Speech.VertexProjectID))
	b.WriteString("# ポップアップを開いた直後に録音を開始する\n")
	fmt.Fprintf(&b, "auto_start = %t\n", c.Speech.AutoStart)
	b.WriteString("\n[clipboard]\n")
	b.WriteString("# \"wl-copy\" | \"wails\" (既定: Linux=wl-copy, Windows/macOS=wails)\n")
	fmt.Fprintf(&b, "backend = %s\n", quote(c.Clipboard.Backend))
	b.WriteString("# コピー後に自動で貼り付けショートカットを送出\n")
	fmt.Fprintf(&b, "auto_paste = %t\n", c.Clipboard.AutoPaste)
	b.WriteString("# 自動貼り付け時、フォーカス復帰から送出までの待ち時間 (ミリ秒)\n")
	fmt.Fprintf(&b, "auto_paste_delay_ms = %d\n", c.Clipboard.AutoPasteDelayMs)
	b.WriteString("# \"ctrl+v\" | \"ctrl+shift+v\"\n")
	fmt.Fprintf(&b, "paste_key = %s\n", quote(c.Clipboard.PasteKey))
	b.WriteString("\n[hotkey]\n")
	b.WriteString("# Windows のみ有効。アプリ内でグローバルホットキーを登録する\n")
	fmt.Fprintf(&b, "enabled = %t\n", c.Hotkey.Enabled)
	fmt.Fprintf(&b, "accelerator = %s\n", quote(c.Hotkey.Accelerator))
	return b.String()
}

// Save writes cfg to path (creating the directory), replacing the file
// atomically so a crash mid-write cannot leave a truncated config. The file
// holds the STT API key, so it is created 0600 in a 0700 directory.
func Save(path string, c *Config) error {
	if path == "" {
		return errors.New("config: no configuration path for this platform")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(Marshal(c)), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
