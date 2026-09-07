package main

import (
	"errors"
	"strings"
	"testing"
)

func TestVertexSpeechHTTPRequestRejectsOtherEndpoints(t *testing.T) {
	valid := "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent"
	cases := map[string]ExternalHTTPRequest{
		"another host":   {URL: "https://evil.example.com/v1beta1/projects/p/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent", Method: "POST"},
		"another model":  {URL: strings.Replace(valid, "gemini-3.5-transcribe-preview", "gemini-anything", 1), Method: "POST"},
		"another region": {URL: strings.Replace(valid, "locations/global", "locations/us-central1", 1), Method: "POST"},
		"query appended": {URL: valid + "?key=leak", Method: "POST"},
		"wrong method":   {URL: valid, Method: "GET"},
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := vertexSpeechHTTPRequest(request,
				func() (string, error) { t.Fatal("the access token must not be read"); return "", nil },
				func(ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
					t.Fatal("the request must not be sent")
					return nil, nil
				})
			if err == nil {
				t.Fatal("the request was accepted")
			}
		})
	}
}

func TestVertexSpeechHTTPRequestAttachesTheToken(t *testing.T) {
	valid := "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent"
	var sent ExternalHTTPRequest
	response, err := vertexSpeechHTTPRequest(
		ExternalHTTPRequest{URL: valid, Method: "POST", Headers: map[string]string{"x-goog-api-key": "should be dropped"}, BodyBase64: "e30="},
		func() (string, error) { return "ya29.token", nil },
		func(r ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
			sent = r
			return &ExternalHTTPResponse{Status: 200}, nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if response.Status != 200 {
		t.Errorf("status = %d", response.Status)
	}
	if sent.Headers["Authorization"] != "Bearer ya29.token" {
		t.Errorf("Authorization = %q", sent.Headers["Authorization"])
	}
	if _, ok := sent.Headers["x-goog-api-key"]; ok {
		t.Error("caller-supplied headers were forwarded")
	}
	if sent.BodyBase64 != "e30=" {
		t.Errorf("body = %q", sent.BodyBase64)
	}
}

// OAuth failures can quote remote responses, so the message the UI sees must
// be a fixed string.
func TestVertexSpeechHTTPRequestHidesOAuthErrors(t *testing.T) {
	valid := "https://aiplatform.googleapis.com/v1beta1/projects/p/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent"
	_, err := vertexSpeechHTTPRequest(ExternalHTTPRequest{URL: valid, Method: "POST"},
		func() (string, error) { return "", errors.New("refresh_token=1//secret rejected") },
		func(ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
			t.Fatal("the request must not be sent")
			return nil, nil
		})
	if err == nil {
		t.Fatal("the failure was not reported")
	}
	if strings.Contains(err.Error(), "secret") {
		t.Errorf("the OAuth error leaked into %q", err)
	}
}
