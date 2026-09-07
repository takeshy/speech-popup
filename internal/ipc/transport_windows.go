//go:build windows

package ipc

import (
	"context"
	"net"
	"time"

	winio "github.com/Microsoft/go-winio"
)

const windowsPipe = `\\.\pipe\LOCAL\speech-popup`

// Endpoint returns a session-local named pipe. The LOCAL namespace is required
// for MSIX-packaged applications and also works for the unpackaged executable.
func Endpoint() string {
	return windowsPipe
}

func listen(endpoint string) (net.Listener, error) {
	return winio.ListenPipe(endpoint, nil)
}

func dial(endpoint string, timeout time.Duration) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return winio.DialPipeContext(ctx, endpoint)
}

func cleanup(string) {}
