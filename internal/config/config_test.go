package config

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestLoadFromMissingFileReturnsDefaults(t *testing.T) {
	cfg := LoadFrom(filepath.Join(t.TempDir(), "nope.toml"))
	want := Default()
	if cfg.Window.Width != want.Window.Width || cfg.Speech.EndpointType != want.Speech.EndpointType {
		t.Fatalf("got %+v, want defaults %+v", cfg, want)
	}
}

func TestLoadFromParsesSpeechSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	content := `
[window]
width = 800   # inline comment
height = 300

[speech]
provider = "openai-compatible"
endpoint_type = "whisper-cpp"
base_url = "http://127.0.0.1:9000"
api_key = "sk-\"quoted\""
model = ""
language = "ja"
silence_seconds = 5
replacements = "日記書いて => /daily\n議事録 => /minutes"
send_phrase = "終わり"
auto_start = false

[clipboard]
paste_key = "ctrl+v"
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := LoadFrom(path)
	if cfg.Window.Width != 800 || cfg.Window.Height != 300 {
		t.Errorf("window = %+v", cfg.Window)
	}
	if cfg.Speech.EndpointType != EndpointWhisperCPP || cfg.Speech.BaseURL != "http://127.0.0.1:9000" {
		t.Errorf("speech = %+v", cfg.Speech)
	}
	if cfg.Speech.APIKey != `sk-"quoted"` {
		t.Errorf("api_key = %q", cfg.Speech.APIKey)
	}
	if cfg.Speech.Replacements != "日記書いて => /daily\n議事録 => /minutes" {
		t.Fatalf("replacements: %q", cfg.Speech.Replacements)
	}
	if cfg.Speech.SilenceSeconds != 5 || cfg.Speech.SendPhrase != "終わり" || cfg.Speech.AutoStart {
		t.Errorf("speech = %+v", cfg.Speech)
	}
	if cfg.Clipboard.PasteKey != "ctrl+v" {
		t.Errorf("paste_key = %q", cfg.Clipboard.PasteKey)
	}
}

func TestLoadFromIgnoresUnknownValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	content := "[speech]\nprovider = \"telepathy\"\nendpoint_type = \"nope\"\n[clipboard]\nbackend = \"xclip\"\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := LoadFrom(path)
	want := Default()
	if cfg.Speech.Provider != want.Speech.Provider || cfg.Speech.EndpointType != want.Speech.EndpointType {
		t.Errorf("speech = %+v", cfg.Speech)
	}
	if cfg.Clipboard.Backend != want.Clipboard.Backend {
		t.Errorf("backend = %q", cfg.Clipboard.Backend)
	}
}

func TestMarshalRoundTrips(t *testing.T) {
	cfg := Default()
	cfg.Speech.EndpointType = EndpointGemini
	cfg.Speech.APIKey = `a\b"c`
	cfg.Speech.Language = "ja-JP"
	cfg.UILanguage = "en"
	cfg.Speech.AutoStart = false
	cfg.Hotkey.Accelerator = "Ctrl+Alt+V"
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	// The file holds the STT API key. Windows has no POSIX mode bits.
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if perm := info.Mode().Perm(); perm != 0o600 {
			t.Errorf("permissions = %o, want 600", perm)
		}
	}
	got := LoadFrom(path)
	if !reflect.DeepEqual(got, cfg) {
		t.Errorf("round trip changed the config:\n got %+v\nwant %+v", got, cfg)
	}
}

func TestNormalizeAccelerator(t *testing.T) {
	for _, input := range []string{"Ctrl+Shift+S", "Ctrl + Shift + S", "Ctrl Shift S"} {
		if got := normalizeAccelerator(input); got != "Ctrl+Shift+S" {
			t.Errorf("normalizeAccelerator(%q) = %q", input, got)
		}
	}
}

func TestUILanguageView(t *testing.T) {
	for _, language := range []string{"", "ja", "en"} {
		view := ToView(Default())
		view.UILanguage = language
		cfg, err := FromView(view)
		if err != nil {
			t.Fatal(err)
		}
		if ToView(cfg).UILanguage != language {
			t.Fatalf("language lost: %q", language)
		}
	}
	view := ToView(Default())
	view.UILanguage = "auto"
	if _, err := FromView(view); err == nil {
		t.Fatal("accepted unsupported UI language")
	}
}
