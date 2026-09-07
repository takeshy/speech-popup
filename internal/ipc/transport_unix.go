//go:build !windows

package ipc

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Endpoint returns the Unix domain socket used by this user's daemon.
func Endpoint() string {
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		return filepath.Join(dir, "speech-popup.sock")
	}
	return fmt.Sprintf("/tmp/speech-popup-%s.sock", strconv.Itoa(os.Getuid()))
}

func listen(endpoint string) (net.Listener, error) {
	return net.Listen("unix", endpoint)
}

func dial(endpoint string, timeout time.Duration) (net.Conn, error) {
	return net.DialTimeout("unix", endpoint, timeout)
}

func cleanup(endpoint string) {
	_ = os.Remove(endpoint)
}
