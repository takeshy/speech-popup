package config

import (
	"errors"
	"fmt"
	"github.com/takeshy/speech-popup/internal/i18n"
	"net/url"
	"regexp"
	"strings"

	"github.com/takeshy/speech-popup/internal/hotkey"
)

// View is the JSON shape exchanged with the Settings dialog.

// View mirrors Config with JSON names for the frontend.
type View struct {
	UILanguage string        `json:"uiLanguage"`
	Window     WindowView    `json:"window"`
	Speech     SpeechView    `json:"speech"`
	Clipboard  ClipboardView `json:"clipboard"`
	Hotkey     HotkeyView    `json:"hotkey"`
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
	ExclamationPhrases map[string]string        `json:"exclamationPhrases,omitempty"`
	QuestionPhrases    map[string]string        `json:"questionPhrases,omitempty"`
	NewlinePhrases     map[string]string        `json:"newlinePhrases,omitempty"`
	SendPhraseProfiles map[string]string        `json:"sendPhraseProfiles,omitempty"`
	Profiles           map[string]SpeechProfile `json:"profiles,omitempty"`
	Provider           string                   `json:"provider"`
	EndpointType       string                   `json:"endpointType"`
	BaseURL            string                   `json:"baseUrl"`
	APIKey             string                   `json:"apiKey"`
	Model              string                   `json:"model"`
	Language           string                   `json:"language"`
	SilenceSeconds     int                      `json:"silenceSeconds"`
	SendPhrase         string                   `json:"sendPhrase"`
	Replacements       string                   `json:"replacements"`
	VertexProjectID    string                   `json:"vertexProjectId"`
	AutoStart          bool                     `json:"autoStart"`
}

// ToView converts the effective configuration for the frontend.
func ToView(c *Config) View {
	var v View
	v.UILanguage = c.UILanguage
	v.Window.Width = c.Window.Width
	v.Window.Height = c.Window.Height
	v.Window.RestoreFocus = c.Window.RestoreFocus
	v.Speech.Profiles = cloneProfiles(c.Speech.Profiles)
	v.Speech.Provider = c.Speech.Provider
	v.Speech.EndpointType = c.Speech.EndpointType
	v.Speech.BaseURL = c.Speech.BaseURL
	v.Speech.APIKey = c.Speech.APIKey
	v.Speech.Model = c.Speech.Model
	v.Speech.Language = c.Speech.Language
	v.Speech.SilenceSeconds = c.Speech.SilenceSeconds
	v.Speech.ExclamationPhrases = cloneSendPhrases(c.Speech.ExclamationPhrases)
	v.Speech.SendPhrase = c.Speech.SendPhrase
	v.Speech.SendPhraseProfiles = cloneSendPhrases(c.Speech.SendPhraseProfiles)
	v.Speech.Replacements = c.Speech.Replacements
	v.Speech.QuestionPhrases = cloneSendPhrases(c.Speech.QuestionPhrases)
	v.Speech.NewlinePhrases = cloneSendPhrases(c.Speech.NewlinePhrases)
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

// A rule list lives on one line of config.toml, so it is bounded rather than
// allowed to grow until the file is unreadable.
const maxReplacementChars = 4000

var (
	projectIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`)
	languagePattern  = regexp.MustCompile(`^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$`)
)

// FromView validates a submitted view and returns the config it
// describes. Values outside the accepted set are rejected rather than
// silently replaced so the user sees what was wrong.
func FromView(v View) (*Config, error) {
	c := Default()
	switch v.UILanguage {
	case "", "ja", "en":
		c.UILanguage = v.UILanguage
	default:
		return nil, errors.New(i18n.T("表示言語は ja または en を指定してください"))
	}
	if v.Window.Width < 200 || v.Window.Width > 4000 || v.Window.Height < 120 || v.Window.Height > 4000 {
		return nil, errors.New(i18n.T("ウィンドウサイズは 幅 200〜4000 / 高さ 120〜4000 の範囲で指定してください"))
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
		return nil, fmt.Errorf(i18n.T("clipboard backend %q は wl-copy または wails を指定してください"), v.Clipboard.Backend)
	}
	c.Clipboard.AutoPaste = v.Clipboard.AutoPaste
	if v.Clipboard.AutoPasteDelayMs < 0 || v.Clipboard.AutoPasteDelayMs > 10000 {
		return nil, errors.New(i18n.T("auto_paste_delay_ms は 0〜10000 の範囲で指定してください"))
	}
	c.Clipboard.AutoPasteDelayMs = v.Clipboard.AutoPasteDelayMs
	switch v.Clipboard.PasteKey {
	case "ctrl+v", "ctrl+shift+v":
		c.Clipboard.PasteKey = v.Clipboard.PasteKey
	default:
		return nil, fmt.Errorf(i18n.T("paste_key %q は ctrl+v または ctrl+shift+v を指定してください"), v.Clipboard.PasteKey)
	}

	c.Hotkey.Enabled = v.Hotkey.Enabled
	accelerator := normalizeAccelerator(v.Hotkey.Accelerator)
	if accelerator == "" {
		return nil, errors.New(i18n.T("ホットキーを入力してください (例: Ctrl+8)"))
	}
	if _, _, err := hotkey.ParseAccelerator(accelerator); err != nil {
		return nil, fmt.Errorf(i18n.T("ホットキー %q を解釈できません: A-Z, 0-9, F1-F24 と Ctrl/Shift/Alt/Win を + で繋いでください"), v.Hotkey.Accelerator)
	}
	c.Hotkey.Accelerator = accelerator
	return c, nil
}

func speechFromView(v SpeechView) (*SpeechConfig, error) {
	s := Default().Speech
	switch v.Provider {
	case ProviderBrowser, ProviderHTTP, ProviderLive:
		s.Provider = v.Provider
	default:
		return nil, fmt.Errorf(i18n.T("provider %q は browser / live / openai-compatible のいずれかを指定してください"), v.Provider)
	}
	if !validEndpointType(v.EndpointType) {
		return nil, fmt.Errorf(i18n.T("endpoint_type %q は openai / whisper-cpp / custom / gemini-transcribe / vertex-transcribe / azure-mai-transcribe のいずれかを指定してください"), v.EndpointType)
	}
	s.Profiles = cloneProfiles(v.Profiles)
	s.EndpointType = v.EndpointType
	s.BaseURL = strings.TrimSpace(v.BaseURL)
	s.APIKey = strings.TrimSpace(v.APIKey)
	s.Model = strings.TrimSpace(v.Model)
	s.Language = strings.TrimSpace(v.Language)
	s.ExclamationPhrases = cloneSendPhrases(v.ExclamationPhrases)
	s.SendPhrase = v.SendPhrase
	s.SendPhraseProfiles = cloneSendPhrases(v.SendPhraseProfiles)
	s.QuestionPhrases = cloneSendPhrases(v.QuestionPhrases)
	s.NewlinePhrases = cloneSendPhrases(v.NewlinePhrases)
	s.VertexProjectID = strings.TrimSpace(v.VertexProjectID)
	s.AutoStart = v.AutoStart
	s.Replacements = strings.TrimSpace(v.Replacements)
	if len([]rune(s.Replacements)) > maxReplacementChars {
		return nil, fmt.Errorf(i18n.T("置換ルールは全体で %d 文字までにしてください"), maxReplacementChars)
	}

	if v.SilenceSeconds < 0 || v.SilenceSeconds > 10 {
		return nil, errors.New(i18n.T("発話を区切る無音は 0〜10 秒の範囲で指定してください"))
	}
	s.SilenceSeconds = v.SilenceSeconds
	if s.Language != "" && !strings.EqualFold(s.Language, "auto") && !languagePattern.MatchString(s.Language) {
		return nil, fmt.Errorf(i18n.T("言語 %q は auto か BCP-47 (ja / en-US など) で指定してください"), v.Language)
	}
	// The remaining fields only matter when audio is actually POSTed; the
	// browser provider uses the WebView's own recognizer.
	if s.Provider == ProviderBrowser {
		return &s, nil
	}
	if s.Provider == ProviderLive && s.EndpointType != EndpointOpenAI && s.EndpointType != EndpointGemini {
		return nil, errors.New(i18n.T("ライブ書き起こしは OpenAI または Gemini API を指定してください"))
	}
	if s.Provider == ProviderLive && s.APIKey == "" {
		return nil, errors.New(i18n.T("ライブ書き起こしの API Key を指定してください"))
	}
	switch {
	case s.EndpointType == EndpointVertex:
		if !projectIDPattern.MatchString(s.VertexProjectID) {
			return nil, errors.New(i18n.T("Vertex AI の OAuth クライアント JSON を選択して Google に接続してください"))
		}
	case s.EndpointType == EndpointGemini:
		if s.APIKey == "" {
			return nil, errors.New(i18n.T("Gemini API の API Key を指定してください"))
		}
	default:
		if err := validateSTTBaseURL(s.BaseURL); err != nil {
			return nil, err
		}
		if s.EndpointType == EndpointAzureMAI && s.APIKey == "" {
			return nil, errors.New(i18n.T("Azure MAI Transcribe の API Key を指定してください"))
		}
		if s.EndpointType != EndpointWhisperCPP && s.Model == "" {
			return nil, errors.New(i18n.T("STT の Model を指定してください"))
		}
	}
	return &s, nil
}

// validateSTTBaseURL mirrors the frontend check so a bad value is rejected at
// save time rather than at the first recording. Plain HTTP stays allowed for
// local services such as whisper.cpp's server.
func validateSTTBaseURL(raw string) error {
	if raw == "" {
		return errors.New(i18n.T("Base URL を指定してください"))
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf(i18n.T("Base URL %q には認証情報・クエリ・フラグメントを含まない HTTP(S) URL を指定してください"), raw)
	}
	return nil
}

// SetVertexProject restores the project paired with the saved OAuth connection,
// even when another transcription service is currently selected.
func (v *View) SetVertexProject(projectID string) {
	if v.Speech.Profiles == nil {
		v.Speech.Profiles = make(map[string]SpeechProfile)
	}
	profile := v.Speech.Profiles[EndpointVertex]
	profile.VertexProjectID = projectID
	v.Speech.Profiles[EndpointVertex] = profile
	if v.Speech.EndpointType == EndpointVertex {
		v.Speech.VertexProjectID = projectID
	}
}
