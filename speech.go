package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Vertex AI speech support, ported from gemihub-desktop. OAuth credentials are
// only ever attached to this fixed model and endpoint, so a tampered Base URL
// in config.toml cannot send the access token anywhere else.
var vertexSpeechURLPattern = regexp.MustCompile(`^https://aiplatform\.googleapis\.com/v1beta1/projects/[a-zA-Z0-9][a-zA-Z0-9_-]*/locations/global/publishers/google/models/gemini-3\.5-transcribe-preview:generateContent$`)

// VertexSpeechHTTPRequest posts a recording to Vertex AI, attaching the stored
// Google OAuth access token. The frontend routes aiplatform.googleapis.com here
// instead of through SpeechHTTPRequest.
func (a *App) VertexSpeechHTTPRequest(request ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
	return vertexSpeechHTTPRequest(request, a.vertexOAuthAccessToken, func(r ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
		return a.doExternalHTTPRequest(r, false)
	})
}

func vertexSpeechHTTPRequest(request ExternalHTTPRequest, accessToken func() (string, error), send func(ExternalHTTPRequest) (*ExternalHTTPResponse, error)) (*ExternalHTTPResponse, error) {
	if !vertexSpeechURLPattern.MatchString(request.URL) || request.Method != "POST" {
		return nil, fmt.Errorf("invalid Vertex AI speech endpoint or method")
	}
	token, err := accessToken()
	if err != nil {
		// OAuth errors can quote remote responses; do not surface those.
		return nil, fmt.Errorf("Vertex AI の認証を取得できません。設定で Google に接続し直してください。")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("Vertex AI を使うには Google へのログインが必要です。")
	}
	request.Headers = map[string]string{"Content-Type": "application/json", "Authorization": "Bearer " + token}
	return send(request)
}
