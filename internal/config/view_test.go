package config

import (
	"strings"
	"testing"
)

// validView is a fully specified recorded-STT configuration. The shipped
// default uses the browser recognizer, which skips the endpoint checks these
// tests exercise.
func validView() View {
	v := ToView(Default())
	v.Speech.Provider = ProviderHTTP
	return v
}

func TestFromViewAcceptsTheShippedDefaults(t *testing.T) {
	cfg, err := FromView(ToView(Default()))
	if err != nil {
		t.Fatalf("FromView: %v", err)
	}
	if *cfg != *Default() {
		t.Errorf("got %+v, want %+v", cfg, Default())
	}
	// A fresh install must transcribe without the user entering credentials.
	if cfg.Speech.Provider != ProviderBrowser {
		t.Errorf("default provider = %q, want %q", cfg.Speech.Provider, ProviderBrowser)
	}
}

func TestFromViewAcceptsARecordedConfiguration(t *testing.T) {
	cfg, err := FromView(validView())
	if err != nil {
		t.Fatalf("FromView: %v", err)
	}
	if cfg.Speech.Provider != ProviderHTTP || cfg.Speech.Model != "whisper-1" {
		t.Errorf("speech = %+v", cfg.Speech)
	}
}

func TestFromViewRejectsBadValues(t *testing.T) {
	cases := map[string]func(*View){
		"ウィンドウサイズ":  func(v *View) { v.Window.Width = 10 },
		"provider":  func(v *View) { v.Speech.Provider = "telepathy" },
		"endpoint":  func(v *View) { v.Speech.EndpointType = "nope" },
		"無音":        func(v *View) { v.Speech.SilenceSeconds = 99 },
		"言語":        func(v *View) { v.Speech.Language = "not a tag" },
		"Model":     func(v *View) { v.Speech.Model = "" },
		"Base URL":  func(v *View) { v.Speech.BaseURL = "https://user:pw@example.com/v1" },
		"ホットキー":     func(v *View) { v.Hotkey.Accelerator = "Shift" },
		"paste_key": func(v *View) { v.Clipboard.PasteKey = "ctrl+alt+v" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			v := validView()
			mutate(&v)
			if _, err := FromView(v); err == nil {
				t.Fatalf("FromView accepted an invalid %s", name)
			}
		})
	}
}

func TestFromViewGeminiRequiresKeyAndVertexRequiresProject(t *testing.T) {
	v := validView()
	v.Speech.EndpointType = EndpointGemini
	if _, err := FromView(v); err == nil || !strings.Contains(err.Error(), "API Key") {
		t.Fatalf("gemini without a key: %v", err)
	}
	v.Speech.APIKey = "gem"
	if _, err := FromView(v); err != nil {
		t.Fatalf("gemini with a key: %v", err)
	}

	v = validView()
	v.Speech.EndpointType = EndpointVertex
	if _, err := FromView(v); err == nil {
		t.Fatal("vertex without a project id was accepted")
	}
	v.Speech.VertexProjectID = "my project"
	if _, err := FromView(v); err == nil {
		t.Fatal("vertex with an invalid project id was accepted")
	}
	v.Speech.VertexProjectID = "my-project"
	if _, err := FromView(v); err != nil {
		t.Fatalf("vertex with a project id: %v", err)
	}
}

func TestFromViewWhisperCPPNeedsNoModelAndAllowsHTTP(t *testing.T) {
	v := validView()
	v.Speech.EndpointType = EndpointWhisperCPP
	v.Speech.BaseURL = "http://127.0.0.1:8080"
	v.Speech.Model = ""
	if _, err := FromView(v); err != nil {
		t.Fatalf("whisper.cpp: %v", err)
	}
}

// The browser recognizer needs no endpoint, so a half-filled STT section must
// not block saving.
func TestFromViewBrowserSkipsEndpointChecks(t *testing.T) {
	v := validView()
	v.Speech.Provider = ProviderBrowser
	v.Speech.Model = ""
	v.Speech.BaseURL = ""
	if _, err := FromView(v); err != nil {
		t.Fatalf("browser provider: %v", err)
	}
}
