package main

import (
	"encoding/json"
	"testing"

	"github.com/takeshy/speech-popup/internal/config"
)

func TestLiveSpeechSetup(t *testing.T) {
	openAI, err := json.Marshal(liveSpeechSetup(config.SpeechConfig{EndpointType: config.EndpointOpenAI, Language: "ja"}))
	if err != nil {
		t.Fatal(err)
	}
	var openAIValue map[string]any
	if err := json.Unmarshal(openAI, &openAIValue); err != nil {
		t.Fatal(err)
	}
	if openAIValue["type"] != "session.update" {
		t.Fatalf("OpenAI setup = %s", openAI)
	}

	gemini, err := json.Marshal(liveSpeechSetup(config.SpeechConfig{EndpointType: config.EndpointGemini, Language: "auto"}))
	if err != nil {
		t.Fatal(err)
	}
	var geminiValue map[string]any
	if err := json.Unmarshal(gemini, &geminiValue); err != nil {
		t.Fatal(err)
	}
	if geminiValue["setup"] == nil {
		t.Fatalf("Gemini setup = %s", gemini)
	}
}

func TestNormalizeLiveSpeechMessage(t *testing.T) {
	openAI := normalizeLiveSpeechMessage("s", config.EndpointOpenAI, []byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"i","delta":"hello"}`))
	if len(openAI) != 1 || openAI[0].Kind != "delta" || openAI[0].Text != "hello" {
		t.Fatalf("OpenAI event = %#v", openAI)
	}

	gemini := normalizeLiveSpeechMessage("s", config.EndpointGemini, []byte(`{"serverContent":{"interimInputTranscription":{"text":"途中"},"inputTranscription":{"text":"確定"}}}`))
	if len(gemini) != 2 || gemini[0].Kind != "interim" || gemini[1].Kind != "final" {
		t.Fatalf("Gemini events = %#v", gemini)
	}
}
