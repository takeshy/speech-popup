package main

import (
	"strings"
	"testing"
)

func TestValidateExternalURL(t *testing.T) {
	if _, err := validateExternalURL("http://127.0.0.1:8080/inference", true); err != nil {
		t.Errorf("local whisper.cpp URL rejected: %v", err)
	}
	if _, err := validateExternalURL("http://127.0.0.1:8080/inference", false); err == nil {
		t.Error("plain HTTP accepted where only HTTPS is allowed")
	}
	for _, raw := range []string{"ftp://example.com/x", "https:///x", "not a url"} {
		if _, err := validateExternalURL(raw, true); err == nil {
			t.Errorf("validateExternalURL(%q) accepted it", raw)
		}
	}
}

func TestExternalHTTPResponseKeepsBinaryOutOfBody(t *testing.T) {
	binary := []byte{0xff, 0xfe, 0x00}
	response := externalHTTPResponse(200, map[string]string{"content-type": "audio/wav"}, binary)
	if response.Body != "" {
		t.Errorf("body = %q, want empty for binary content", response.Body)
	}
	if response.BodyBase64 == "" {
		t.Error("bodyBase64 is empty")
	}
	text := externalHTTPResponse(200, map[string]string{"content-type": "application/json"}, []byte(`{"text":"ok"}`))
	if text.Body != `{"text":"ok"}` {
		t.Errorf("body = %q", text.Body)
	}
}

func TestIsTextualHTTPContent(t *testing.T) {
	for _, contentType := range []string{"application/json", "application/json; charset=utf-8", "text/plain", "application/problem+json"} {
		if !isTextualHTTPContent(contentType) {
			t.Errorf("isTextualHTTPContent(%q) = false", contentType)
		}
	}
	for _, contentType := range []string{"audio/wav", "application/octet-stream"} {
		if isTextualHTTPContent(contentType) {
			t.Errorf("isTextualHTTPContent(%q) = true", contentType)
		}
	}
}

func TestReadLimitedHTTPBody(t *testing.T) {
	if _, err := readLimitedHTTPBody(strings.NewReader("0123456789"), 4); err == nil {
		t.Error("an oversized body was accepted")
	}
	got, err := readLimitedHTTPBody(strings.NewReader("ok"), 4)
	if err != nil || string(got) != "ok" {
		t.Errorf("got %q, %v", got, err)
	}
}
