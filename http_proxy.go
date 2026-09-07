package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

// The HTTP transport used to reach speech-to-text services from the WebView,
// ported from gemihub-desktop. Going through Go rather than fetch() avoids
// WebView CORS entirely and keeps the API key out of any preflight.

type ExternalHTTPRequest struct {
	URL        string            `json:"url"`
	Method     string            `json:"method"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body,omitempty"`
	BodyBase64 string            `json:"bodyBase64,omitempty"`
}

type ExternalHTTPResponse struct {
	Status     int               `json:"status"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	BodyBase64 string            `json:"bodyBase64"`
}

// SpeechHTTPRequest posts a recording to the configured STT service. Plain
// HTTP is permitted because whisper.cpp's server and other local engines are
// a primary target; link-local addresses stay blocked so a hostname cannot be
// pointed at a cloud metadata endpoint.
func (a *App) SpeechHTTPRequest(request ExternalHTTPRequest) (*ExternalHTTPResponse, error) {
	return a.doExternalHTTPRequest(request, true)
}

func (a *App) doExternalHTTPRequest(request ExternalHTTPRequest, allowHTTP bool) (*ExternalHTTPResponse, error) {
	parsed, err := validateExternalURL(request.URL, allowHTTP)
	if err != nil {
		return nil, err
	}
	body := []byte(request.Body)
	if request.BodyBase64 != "" {
		body, err = base64.StdEncoding.DecodeString(request.BodyBase64)
		if err != nil {
			return nil, fmt.Errorf("invalid request body: %w", err)
		}
	}
	method := strings.ToUpper(strings.TrimSpace(request.Method))
	if method == "" {
		method = http.MethodGet
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	httpRequest, err := http.NewRequestWithContext(ctx, method, parsed.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for key, value := range request.Headers {
		if !strings.EqualFold(key, "Host") {
			httpRequest.Header.Set(key, value)
		}
	}
	client := &http.Client{
		Timeout:   5 * time.Minute,
		Transport: publicNetworkTransport(),
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if next.URL.Scheme != "https" && !(allowHTTP && next.URL.Scheme == "http") {
				return fmt.Errorf("redirect to unsupported URL scheme denied")
			}
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Never forward the Authorization header to a different host.
			if len(via) > 0 && !strings.EqualFold(next.URL.Host, via[len(via)-1].URL.Host) {
				for key := range next.Header {
					lower := strings.ToLower(key)
					if lower != "accept" && lower != "content-type" && lower != "user-agent" {
						next.Header.Del(key)
					}
				}
			}
			return nil
		},
	}
	if allowHTTP {
		// Local STT servers are the point, so loopback and private ranges are
		// allowed; link-local metadata endpoints are still denied at dial time.
		client.Transport = linkLocalGuardedTransport()
	}
	response, err := client.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	const maxExternalHTTPResponseBytes = 16 * 1024 * 1024
	responseBody, err := readLimitedHTTPBody(response.Body, maxExternalHTTPResponseBytes)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{}
	for key, values := range response.Header {
		headers[strings.ToLower(key)] = strings.Join(values, ", ")
	}
	return externalHTTPResponse(response.StatusCode, headers, responseBody), nil
}

// externalHTTPResponse keeps the Wails callback payload valid. Wails
// JSON-serializes exported method results, and putting arbitrary bytes in a Go
// string is lossy for non-UTF-8 data, so bodyBase64 is the byte-preserving
// representation and body carries textual content only.
func externalHTTPResponse(status int, headers map[string]string, content []byte) *ExternalHTTPResponse {
	result := &ExternalHTTPResponse{
		Status:     status,
		Headers:    headers,
		BodyBase64: base64.StdEncoding.EncodeToString(content),
	}
	contentType := strings.TrimSpace(headers["content-type"])
	if (contentType == "" || isTextualHTTPContent(contentType)) && utf8.Valid(content) {
		result.Body = string(content)
	}
	return result
}

func isTextualHTTPContent(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(mediaType)
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/ld+json", "application/problem+json",
		"application/xml", "application/xhtml+xml", "application/javascript":
		return true
	default:
		return strings.HasSuffix(mediaType, "+json") || strings.HasSuffix(mediaType, "+xml")
	}
}

func readLimitedHTTPBody(reader io.Reader, limit int64) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > limit {
		return nil, fmt.Errorf("HTTP response exceeds %d byte limit", limit)
	}
	return content, nil
}

// linkLocalGuardedTransport denies connections to link-local addresses
// (169.254.0.0/16, fe80::/10). This closes off cloud instance metadata
// endpoints such as 169.254.169.254 while still allowing loopback and private
// hosts, which local STT servers legitimately use. The check runs at dial
// time, so it also covers redirects and any DNS name that resolves there.
func linkLocalGuardedTransport() *http.Transport {
	return guardedTransport(false)
}

// publicNetworkTransport additionally denies loopback and private ranges. It
// is used for the OAuth endpoints and the hosted Gemini/Vertex APIs.
func publicNetworkTransport() *http.Transport {
	return guardedTransport(true)
}

func guardedTransport(publicOnly bool) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil {
				return nil
			}
			blocked := ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
			if publicOnly {
				blocked = blocked || ip.IsLoopback() || ip.IsPrivate()
			}
			if blocked {
				return fmt.Errorf("connection to non-public address %s denied", ip)
			}
			return nil
		},
	}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, address)
	}
	return transport
}

func validateExternalURL(raw string, allowHTTP bool) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	validScheme := parsed != nil && (parsed.Scheme == "https" || (allowHTTP && parsed.Scheme == "http"))
	if err != nil || !validScheme || parsed.Hostname() == "" {
		return nil, fmt.Errorf("request requires a valid %s URL", map[bool]string{true: "HTTP or HTTPS", false: "HTTPS"}[allowHTTP])
	}
	return parsed, nil
}
