package config

import (
	"reflect"
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
	if !reflect.DeepEqual(cfg, Default()) {
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
		"置換ルール":     func(v *View) { v.Speech.Replacements = strings.Repeat("あ", 4001) },
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

func TestAzureMAISettingsSaveAndReload(t *testing.T) {
	v := validView()
	v.Speech.EndpointType = EndpointAzureMAI
	v.Speech.BaseURL = " https://resource.cognitiveservices.azure.com/ "
	v.Speech.APIKey = " azure-test-key "
	v.Speech.Model = "MAI-Transcribe-2"
	cfg, err := FromView(v)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/config.toml"
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	got := ToView(LoadFrom(path)).Speech
	if got.EndpointType != EndpointAzureMAI || got.BaseURL != "https://resource.cognitiveservices.azure.com/" || got.APIKey != "azure-test-key" || got.Model != "MAI-Transcribe-2" {
		t.Fatal("Azure settings did not survive save and reload")
	}
	for _, field := range []string{"key", "endpoint", "model"} {
		bad := v
		switch field {
		case "key":
			bad.Speech.APIKey = " "
		case "endpoint":
			bad.Speech.BaseURL = ""
		case "model":
			bad.Speech.Model = ""
		}
		if _, err := FromView(bad); err == nil {
			t.Errorf("accepted empty %s", field)
		}
	}
}

func TestServiceProfilesRoundTripAndIsolation(t *testing.T) {
	v := validView()
	v.Speech.Profiles = map[string]SpeechProfile{
		EndpointOpenAI:   {BaseURL: "https://openai.example/v1", APIKey: `key\with"quotes#`, Model: "whisper-1", Language: "en"},
		EndpointAzureMAI: {BaseURL: "https://azure.example", APIKey: "azure-key", Model: "MAI-Transcribe-2", Language: "ja"},
		EndpointVertex:   {VertexProjectID: "my-project", Language: "auto"},
	}
	cfg, err := FromView(v)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/config.toml"
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	got := ToView(LoadFrom(path))
	if !reflect.DeepEqual(got.Speech.Profiles, v.Speech.Profiles) {
		t.Fatal("service profiles changed after reload")
	}
	delete(v.Speech.Profiles, EndpointOpenAI)
	delete(got.Speech.Profiles, EndpointAzureMAI)
	if len(cfg.Speech.Profiles) != 3 {
		t.Fatal("views share mutable profile storage")
	}
}

func TestSendPhraseProfilesRoundTripAndIsolation(t *testing.T) {
	v := ToView(Default())
	v.Speech.SendPhraseProfiles = map[string]string{
		"fr": "envoyer maintenant", "de": "", "ja": "送信, オーバー", "zh-Hant": "發送",
		"ar": "إرسال", "hi": "भेजो", "en": "done\nwith\tquotes\"#",
	}
	cfg, err := FromView(v)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/config.toml"
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	got := ToView(LoadFrom(path))
	if !reflect.DeepEqual(got.Speech.SendPhraseProfiles, v.Speech.SendPhraseProfiles) {
		t.Fatalf("send phrase profiles changed: %+v", got.Speech.SendPhraseProfiles)
	}
	delete(v.Speech.SendPhraseProfiles, "fr")
	delete(got.Speech.SendPhraseProfiles, "ja")
	if len(cfg.Speech.SendPhraseProfiles) != 7 {
		t.Fatal("views share mutable send phrase storage")
	}
}

func TestSymbolPhraseMapsRoundTripAndIsolation(t *testing.T) {
	v := ToView(Default())
	v.Speech.ExclamationPhrases = map[string]string{"ja": "", "es": "así es"}
	v.Speech.QuestionPhrases = map[string]string{"en": "", "ja": "質問です", "es": "signo de pregunta"}
	v.Speech.NewlinePhrases = map[string]string{"en": "next paragraph", "es": "se acabo, se acabó", "ja": ""}
	cfg, err := FromView(v)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/config.toml"
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	got := ToView(LoadFrom(path))
	if !reflect.DeepEqual(got.Speech.ExclamationPhrases, v.Speech.ExclamationPhrases) ||
		!reflect.DeepEqual(got.Speech.QuestionPhrases, v.Speech.QuestionPhrases) ||
		!reflect.DeepEqual(got.Speech.NewlinePhrases, v.Speech.NewlinePhrases) {
		t.Fatal("symbol phrase maps changed on reload")
	}
	delete(v.Speech.QuestionPhrases, "en")
	delete(got.Speech.NewlinePhrases, "es")
	if len(cfg.Speech.QuestionPhrases) != 3 || len(cfg.Speech.NewlinePhrases) != 3 {
		t.Fatal("symbol phrase maps share mutable storage")
	}
}

func TestVertexProjectRestoredFromOAuthAcrossServices(t *testing.T) {
	v := validView()
	v.SetVertexProject("oauth-project")
	if v.Speech.Profiles[EndpointVertex].VertexProjectID != "oauth-project" {
		t.Fatal("missing Vertex profile when another service is selected")
	}
	if v.Speech.VertexProjectID != "" {
		t.Fatal("modified the selected service's project")
	}
	v.Speech.EndpointType = EndpointVertex
	v.SetVertexProject("new-json-project")
	next, err := FromView(v)
	if err != nil {
		t.Fatal(err)
	}
	if next.Speech.VertexProjectID != "new-json-project" || next.Speech.Profiles[EndpointVertex].VertexProjectID != "new-json-project" {
		t.Fatal("selected Vertex settings did not follow the OAuth project")
	}
}
