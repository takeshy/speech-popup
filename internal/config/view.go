package config

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/takeshy/speech-popup/internal/hotkey"
)

// View is the JSON shape exchanged with the Settings dialog.

// View mirrors Config with JSON names for the frontend.
type View struct {
	Window    WindowView    `json:"window"`
	Speech    SpeechView    `json:"speech"`
	Clipboard ClipboardView `json:"clipboard"`
	Hotkey    HotkeyView    `json:"hotkey"`
}

type WindowView struct {
	Width        int  `json:"width"`
	Height       int  `json:"height"`
	RestoreFocus bool `json:"restoreFocus"`
}

type ClipboardView struct {
	Backend          string `json:"backend"`
	AutoPaste        bool   `json:"autoPaste"`
	AutoPasteDelayMs int    `json:"autoPasteDelayMs"`
	PasteKey         string `json:"pasteKey"`
}

type HotkeyView struct {
	Enabled     bool   `json:"enabled"`
	Accelerator string `json:"accelerator"`
}

type SpeechView struct {
	Provider        string `json:"provider"`
	EndpointType    string `json:"endpointType"`
	BaseURL         string `json:"baseUrl"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	Language        string `json:"language"`
	SilenceSeconds  int    `json:"silenceSeconds"`
	SendPhrase      string `json:"sendPhrase"`
	VertexProjectID string `json:"vertexProjectId"`
	AutoStart       bool   `json:"autoStart"`
}

// ToView converts the effective configuration for the frontend.
func ToView(c *Config) View {
	var v View
	v.Window.Width = c.Window.Width
	v.Window.Height = c.Window.Height
	v.Window.RestoreFocus = c.Window.RestoreFocus
	v.Speech.Provider = c.Speech.Provider
	v.Speech.EndpointType = c.Speech.EndpointType
	v.Speech.BaseURL = c.Speech.BaseURL
	v.Speech.APIKey = c.Speech.APIKey
	v.Speech.Model = c.Speech.Model
	v.Speech.Language = c.Speech.Language
	v.Speech.SilenceSeconds = c.Speech.SilenceSeconds
	v.Speech.SendPhrase = c.Speech.SendPhrase
	v.Speech.VertexProjectID = c.Speech.VertexProjectID
	v.Speech.AutoStart = c.Speech.AutoStart
	v.Clipboard.Backend = c.Clipboard.Backend
	v.Clipboard.AutoPaste = c.Clipboard.AutoPaste
	v.Clipboard.AutoPasteDelayMs = c.Clipboard.AutoPasteDelayMs
	v.Clipboard.PasteKey = c.Clipboard.PasteKey
	v.Hotkey.Enabled = c.Hotkey.Enabled
	v.Hotkey.Accelerator = c.Hotkey.Accelerator
	return v
}

var (
	projectIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`)
	languagePattern  = regexp.MustCompile(`^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$`)
)

// FromView validates a submitted view and returns the config it
// describes. Values outside the accepted set are rejected rather than
// silently replaced so the user sees what was wrong.
func FromView(v View) (*Config, error) {
	c := Default()
	if v.Window.Width < 200 || v.Window.Width > 4000 || v.Window.Height < 120 || v.Window.Height > 4000 {
		return nil, errors.New("ウィンドウサイズは 幅 200〜4000 / 高さ 120〜4000 の範囲で指定してください")
	}
	c.Window.Width = v.Window.Width
	c.Window.Height = v.Window.Height
	c.Window.RestoreFocus = v.Window.RestoreFocus

	speech, err := speechFromView(v.Speech)
	if err != nil {
		return nil, err
	}
	c.Speech = *speech

	switch v.Clipboard.Backend {
	case "wl-copy", "wails":
		c.Clipboard.Backend = v.Clipboard.Backend
	default:
		return nil, fmt.Errorf("clipboard backend %q は wl-copy または wails を指定してください", v.Clipboard.Backend)
	}
	c.Clipboard.AutoPaste = v.Clipboard.AutoPaste
	if v.Clipboard.AutoPasteDelayMs < 0 || v.Clipboard.AutoPasteDelayMs > 10000 {
		return nil, errors.New("auto_paste_delay_ms は 0〜10000 の範囲で指定してください")
	}
	c.Clipboard.AutoPasteDelayMs = v.Clipboard.AutoPasteDelayMs
	switch v.Clipboard.PasteKey {
	case "ctrl+v", "ctrl+shift+v":
		c.Clipboard.PasteKey = v.Clipboard.PasteKey
	default:
		return nil, fmt.Errorf("paste_key %q は ctrl+v または ctrl+shift+v を指定してください", v.Clipboard.PasteKey)
	}

	c.Hotkey.Enabled = v.Hotkey.Enabled
	accelerator := normalizeAccelerator(v.Hotkey.Accelerator)
	if accelerator == "" {
		return nil, errors.New("ホットキーを入力してください (例: Ctrl+8)")
	}
	if _, _, err := hotkey.ParseAccelerator(accelerator); err != nil {
		return nil, fmt.Errorf("ホットキー %q を解釈できません: A-Z, 0-9, F1-F24 と Ctrl/Shift/Alt/Win を + で繋いでください", v.Hotkey.Accelerator)
	}
	c.Hotkey.Accelerator = accelerator
	return c, nil
}

func speechFromView(v SpeechView) (*SpeechConfig, error) {
	s := Default().Speech
	switch v.Provider {
	case ProviderBrowser, ProviderHTTP:
		s.Provider = v.Provider
	default:
		return nil, fmt.Errorf("provider %q は browser または openai-compatible を指定してください", v.Provider)
	}
	if !validEndpointType(v.EndpointType) {
		return nil, fmt.Errorf("endpoint_type %q は openai / whisper-cpp / custom / gemini-transcribe / vertex-transcribe のいずれかを指定してください", v.EndpointType)
	}
	s.EndpointType = v.EndpointType
	s.BaseURL = strings.TrimSpace(v.BaseURL)
	s.APIKey = strings.TrimSpace(v.APIKey)
	s.Model = strings.TrimSpace(v.Model)
	s.Language = strings.TrimSpace(v.Language)
	s.SendPhrase = v.SendPhrase
	s.VertexProjectID = strings.TrimSpace(v.VertexProjectID)
	s.AutoStart = v.AutoStart

	if v.SilenceSeconds < 0 || v.SilenceSeconds > 10 {
		return nil, errors.New("無音での自動停止は 0〜10 秒の範囲で指定してください")
	}
	s.SilenceSeconds = v.SilenceSeconds
	if s.Language != "" && !strings.EqualFold(s.Language, "auto") && !languagePattern.MatchString(s.Language) {
		return nil, fmt.Errorf("言語 %q は auto か BCP-47 (ja / en-US など) で指定してください", v.Language)
	}
	// The remaining fields only matter when audio is actually POSTed; the
	// browser provider uses the WebView's own recognizer.
	if s.Provider == ProviderBrowser {
		return &s, nil
	}
	switch {
	case s.EndpointType == EndpointVertex:
		if !projectIDPattern.MatchString(s.VertexProjectID) {
			return nil, errors.New("Vertex AI の場合は Google Cloud プロジェクト ID を指定してください")
		}
	case s.EndpointType == EndpointGemini:
		if s.APIKey == "" {
			return nil, errors.New("Gemini API の API Key を指定してください")
		}
	default:
		if err := validateSTTBaseURL(s.BaseURL); err != nil {
			return nil, err
		}
		if s.EndpointType != EndpointWhisperCPP && s.Model == "" {
			return nil, errors.New("STT の Model を指定してください")
		}
	}
	return &s, nil
}

// validateSTTBaseURL mirrors the frontend check so a bad value is rejected at
// save time rather than at the first recording. Plain HTTP stays allowed for
// local services such as whisper.cpp's server.
func validateSTTBaseURL(raw string) error {
	if raw == "" {
		return errors.New("Base URL を指定してください")
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("Base URL %q には認証情報・クエリ・フラグメントを含まない HTTP(S) URL を指定してください", raw)
	}
	return nil
}
