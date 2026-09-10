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
	session := openAIValue["session"].(map[string]any)
	audio := session["audio"].(map[string]any)
	input := audio["input"].(map[string]any)
	if input["turn_detection"] != nil {
		t.Fatalf("OpenAI turn detection must be disabled: %s", openAI)
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
	geminiSetup := geminiValue["setup"].(map[string]any)
	if geminiSetup["model"] != "models/gemini-3.5-transcribe-live" {
		t.Fatalf("Gemini model = %v", geminiSetup["model"])
	}

	vertex, err := json.Marshal(liveSpeechSetup(config.SpeechConfig{EndpointType: config.EndpointVertex, VertexProjectID: "project-1", Language: "ja"}))
	if err != nil {
		t.Fatal(err)
	}
	if string(vertex) == string(gemini) {
		t.Fatalf("Vertex setup did not use its project: %s", vertex)
	}
	var vertexValue map[string]any
	if err := json.Unmarshal(vertex, &vertexValue); err != nil {
		t.Fatal(err)
	}
	vertexSetup := vertexValue["setup"].(map[string]any)
	if vertexSetup["model"] != "projects/project-1/locations/global/publishers/google/models/gemini-3.5-transcribe-live-preview" {
		t.Fatalf("Vertex model = %v", vertexSetup["model"])
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

	providerError := normalizeLiveSpeechMessage("s", config.EndpointOpenAI, []byte(`{"error":{"message":"model access denied","code":"model_not_found","type":"invalid_request_error","param":"audio.input.transcription.model"}}`))
	if len(providerError) != 1 || providerError[0].Message != "OpenAI: model access denied (code=model_not_found, type=invalid_request_error, param=audio.input.transcription.model)" {
		t.Fatalf("provider error = %#v", providerError)
	}
}
