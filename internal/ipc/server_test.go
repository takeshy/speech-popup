package ipc

import (
	"testing"
	"time"
)

func TestServerHandlesCommand(t *testing.T) {
	endpoint := testEndpoint(t)
	server, err := NewServer(PrepareEndpoint(endpoint))
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	t.Cleanup(server.Close)

	handled := make(chan string, 1)
	server.SetHandler(func(command string) error {
		handled <- command
		return nil
	})
	go server.Serve()

	conn, err := dial(endpoint, time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("toggle\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	response, err := readLine(conn)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if response != "ok" {
		t.Fatalf("response = %q, want ok", response)
	}

	select {
	case command := <-handled:
		if command != "toggle" {
			t.Fatalf("command = %q, want toggle", command)
		}
	case <-time.After(time.Second):
		t.Fatal("handler was not called")
	}
}

func TestIsDaemonRunning(t *testing.T) {
	endpoint := testEndpoint(t)
	if IsDaemonRunning(endpoint) {
		t.Fatal("daemon reported running before listener was created")
	}
	server, err := NewServer(PrepareEndpoint(endpoint))
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer server.Close()
	go server.Serve()
	if !IsDaemonRunning(endpoint) {
		t.Fatal("daemon was not detected")
	}
}
