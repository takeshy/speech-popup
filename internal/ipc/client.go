package ipc

import (
	"fmt"
	"strings"
	"time"
)

// IsDaemonRunning reports whether another speech-popup daemon is accepting
// commands on the local IPC endpoint.
func IsDaemonRunning(endpoint string) bool {
	conn, err := dial(endpoint, 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// PrepareEndpoint removes a leftover endpoint that no daemon is serving.
// Named pipes require no cleanup. It returns endpoint for convenient chaining.
func PrepareEndpoint(endpoint string) string {
	if IsDaemonRunning(endpoint) {
		return endpoint
	}
	cleanup(endpoint)
	return endpoint
}

// RunClientCommand sends a single command to the daemon and prints the
// response. It returns an error both for transport failures and for
// "error:" responses.
func RunClientCommand(command string) error {
	if !IsValidCommand(command) {
		return fmt.Errorf("unknown command %q (expected toggle|show|hide|quit)", command)
	}
	endpoint := Endpoint()
	conn, err := dial(endpoint, time.Second)
	if err != nil {
		return fmt.Errorf("speech-popup daemon is not running (%v)", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	if _, err := conn.Write([]byte(command + "\n")); err != nil {
		return fmt.Errorf("failed to send command: %w", err)
	}
	response, err := readLine(conn)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}
	if strings.HasPrefix(response, "error:") {
		return fmt.Errorf("%s", strings.TrimSpace(strings.TrimPrefix(response, "error:")))
	}
	fmt.Println(response)
	return nil
}
