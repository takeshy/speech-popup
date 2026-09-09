package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/takeshy/speech-popup/internal/config"
)

const liveSpeechEvent = "speech:live"

type liveSpeechEventData struct {
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"`
	ItemID    string `json:"itemId,omitempty"`
	Text      string `json:"text,omitempty"`
	Message   string `json:"message,omitempty"`
}

type liveSpeechSession struct {
	id        string
	provider  string
	conn      *websocket.Conn
	ctx       context.Context
	cancel    context.CancelFunc
	writeMu   sync.Mutex
	done      chan struct{}
	finishing atomic.Bool
}

func (s *liveSpeechSession) write(payload any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	return wsjsonWrite(ctx, s.conn, payload)
}

// StartLiveSpeech opens the provider WebSocket on the Go side so standard API
// keys never appear in a WebSocket URL or browser developer tools.
func (a *App) StartLiveSpeech() (string, error) {
	a.StopLiveSpeech()

	a.mu.Lock()
	speech := a.cfg.Speech
	a.mu.Unlock()
	if speech.Provider != config.ProviderLive {
		return "", errors.New("live speech is not selected")
	}
	if speech.EndpointType != config.EndpointOpenAI && speech.EndpointType != config.EndpointGemini {
		return "", errors.New("live speech supports OpenAI and Gemini only")
	}
	if strings.TrimSpace(speech.APIKey) == "" {
		return "", errors.New("API key is required")
	}

	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	id := fmt.Sprintf("live-%d", time.Now().UnixNano())
	s := &liveSpeechSession{id: id, provider: speech.EndpointType, ctx: ctx, cancel: cancel, done: make(chan struct{})}
	headers := http.Header{}
	var endpoint string
	if speech.EndpointType == config.EndpointOpenAI {
		endpoint = "wss://api.openai.com/v1/realtime?intent=transcription"
		headers.Set("Authorization", "Bearer "+speech.APIKey)
	} else {
		endpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
		headers.Set("x-goog-api-key", speech.APIKey)
	}
	conn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPHeader: headers, HTTPClient: &http.Client{Transport: publicNetworkTransport()}})
	if err != nil {
		cancel()
		return "", fmt.Errorf("live speech connection failed: %w", err)
	}
	s.conn = conn
	if err := s.write(liveSpeechSetup(speech)); err != nil {
		_ = conn.Close(websocket.StatusInternalError, "setup failed")
		cancel()
		return "", fmt.Errorf("live speech setup failed: %w", err)
	}

	a.liveMu.Lock()
	a.liveSpeech = s
	a.liveMu.Unlock()
	go a.readLiveSpeech(s)
	return id, nil
}

func liveSpeechSetup(speech config.SpeechConfig) any {
	language := strings.TrimSpace(speech.Language)
	if strings.EqualFold(language, "auto") {
		language = ""
	}
	if speech.EndpointType == config.EndpointOpenAI {
		transcription := map[string]any{"model": "gpt-live-transcribe", "delay": "low"}
		if language != "" {
			transcription["languages"] = []string{language}
		}
		return map[string]any{"type": "session.update", "session": map[string]any{
			"type": "transcription",
			"audio": map[string]any{"input": map[string]any{
				"format":         map[string]any{"type": "audio/pcm", "rate": 24000},
				"transcription":  transcription,
				"turn_detection": map[string]any{"type": "server_vad", "prefix_padding_ms": 300, "silence_duration_ms": 700},
			}},
		}}
	}
	languages := []string{}
	if language != "" {
		languages = append(languages, language)
	}
	return map[string]any{"setup": map[string]any{
		"model":                   "models/gemini-3.5-transcribe-live",
		"generationConfig":        map[string]any{"responseModalities": []string{"TEXT"}},
		"inputAudioTranscription": map[string]any{"languageCodes": languages, "mode": "SMART"},
	}}
}

// SendLiveSpeechAudio forwards one base64 encoded raw PCM16 chunk.
func (a *App) SendLiveSpeechAudio(sessionID, audio string) error {
	s, err := a.currentLiveSpeech(sessionID)
	if err != nil {
		return err
	}
	if len(audio) == 0 || len(audio) > 1024*1024 {
		return errors.New("invalid live audio chunk")
	}
	if s.provider == config.EndpointOpenAI {
		return s.write(map[string]any{"type": "input_audio_buffer.append", "audio": audio})
	}
	return s.write(map[string]any{"realtimeInput": map[string]any{"audio": map[string]any{
		"data": audio, "mimeType": "audio/pcm;rate=16000",
	}}})
}

// FinishLiveSpeech flushes the last provider turn. The read loop remains alive
// briefly so the authoritative final transcript can arrive.
func (a *App) FinishLiveSpeech(sessionID string) error {
	s, err := a.currentLiveSpeech(sessionID)
	if err != nil {
		return err
	}
	s.finishing.Store(true)
	var payload any
	if s.provider == config.EndpointOpenAI {
		// With server VAD an explicit commit can fail when the last pause already
		// committed the buffer. A short PCM silence flushes an active turn and is
		// harmless when the buffer is already empty.
		silence := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0}, 24000*2))
		payload = map[string]any{"type": "input_audio_buffer.append", "audio": silence}
	} else {
		payload = map[string]any{"realtimeInput": map[string]any{"audioStreamEnd": true}}
	}
	if err := s.write(payload); err != nil {
		return err
	}
	go func() {
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
			a.emitLiveSpeech(liveSpeechEventData{SessionID: s.id, Kind: "done"})
			a.stopLiveSpeechSession(s)
		}
	}()
	return nil
}

func (a *App) StopLiveSpeech() {
	a.liveMu.Lock()
	s := a.liveSpeech
	a.liveSpeech = nil
	a.liveMu.Unlock()
	if s != nil {
		s.cancel()
		_ = s.conn.CloseNow()
	}
}

func (a *App) currentLiveSpeech(sessionID string) (*liveSpeechSession, error) {
	a.liveMu.Lock()
	defer a.liveMu.Unlock()
	if a.liveSpeech == nil || a.liveSpeech.id != sessionID {
		return nil, errors.New("live speech session is not active")
	}
	return a.liveSpeech, nil
}

func (a *App) stopLiveSpeechSession(s *liveSpeechSession) {
	a.liveMu.Lock()
	if a.liveSpeech == s {
		a.liveSpeech = nil
	}
	a.liveMu.Unlock()
	s.cancel()
	_ = s.conn.CloseNow()
}

func (a *App) emitLiveSpeech(event liveSpeechEventData) {
	if a.window != nil {
		a.window.EmitEvent(liveSpeechEvent, event)
	}
}

func (a *App) readLiveSpeech(s *liveSpeechSession) {
	defer close(s.done)
	defer a.stopLiveSpeechSession(s)
	for {
		_, data, err := s.conn.Read(s.ctx)
		if err != nil {
			if s.ctx.Err() == nil && s.finishing.Load() {
				a.emitLiveSpeech(liveSpeechEventData{SessionID: s.id, Kind: "done"})
			} else if s.ctx.Err() == nil {
				a.emitLiveSpeech(liveSpeechEventData{SessionID: s.id, Kind: "error", Message: "live speech connection closed"})
			}
			return
		}
		for _, event := range normalizeLiveSpeechMessage(s.id, s.provider, data) {
			a.emitLiveSpeech(event)
		}
	}
}

func normalizeLiveSpeechMessage(sessionID, provider string, data []byte) []liveSpeechEventData {
	var message map[string]any
	if json.Unmarshal(data, &message) != nil {
		return []liveSpeechEventData{{SessionID: sessionID, Kind: "error", Message: "invalid live speech response"}}
	}
	if remote, ok := message["error"].(map[string]any); ok {
		_ = remote
		return []liveSpeechEventData{{SessionID: sessionID, Kind: "error", Message: "live speech provider returned an error"}}
	}
	if provider == config.EndpointOpenAI {
		kind, _ := message["type"].(string)
		item, _ := message["item_id"].(string)
		switch kind {
		case "conversation.item.input_audio_transcription.delta":
			text, _ := message["delta"].(string)
			if text != "" {
				return []liveSpeechEventData{{SessionID: sessionID, Kind: "delta", ItemID: item, Text: text}}
			}
		case "conversation.item.input_audio_transcription.completed":
			text, _ := message["transcript"].(string)
			return []liveSpeechEventData{{SessionID: sessionID, Kind: "final", ItemID: item, Text: text}}
		case "error":
			return []liveSpeechEventData{{SessionID: sessionID, Kind: "error", Message: "OpenAI live transcription failed"}}
		}
		return nil
	}
	content, _ := message["serverContent"].(map[string]any)
	if content == nil {
		content, _ = message["server_content"].(map[string]any)
	}
	if content == nil {
		return nil
	}
	result := []liveSpeechEventData{}
	for _, field := range []struct{ key, alt, kind string }{
		{"interimInputTranscription", "interim_input_transcription", "interim"},
		{"inputTranscription", "input_transcription", "final"},
	} {
		part, _ := content[field.key].(map[string]any)
		if part == nil {
			part, _ = content[field.alt].(map[string]any)
		}
		text, _ := part["text"].(string)
		if text != "" {
			result = append(result, liveSpeechEventData{SessionID: sessionID, Kind: field.kind, Text: text})
		}
	}
	return result
}

// Kept as a seam for protocol-focused tests without a live service.
var wsjsonWrite = func(ctx context.Context, conn *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}
