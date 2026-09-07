//go:build windows

package ipc

import (
	"fmt"
	"os"
	"testing"
)

func testEndpoint(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf(`\\.\pipe\LOCAL\speech-popup-test-%d`, os.Getpid())
}

func TestEndpointUsesMSIXLocalNamespace(t *testing.T) {
	if Endpoint() != `\\.\pipe\LOCAL\speech-popup` {
		t.Fatalf("Endpoint() = %q", Endpoint())
	}
}
