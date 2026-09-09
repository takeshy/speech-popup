package ipc

import (
	"strings"
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
	server.SetHandler(func(command string, _ Options) error {
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

func TestServerCarriesCommandOptions(t *testing.T) {
	endpoint := testEndpoint(t)
	server, err := NewServer(PrepareEndpoint(endpoint))
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	t.Cleanup(server.Close)

	handled := make(chan Options, 1)
	server.SetHandler(func(_ string, opts Options) error {
		handled <- opts
		return nil
	})
	go server.Serve()

	line, err := EncodeCommand("show", Options{Append: "送信して"})
	if err != nil {
		t.Fatalf("EncodeCommand: %v", err)
	}
	conn, err := dial(endpoint, time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(line + "\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if response, err := readLine(conn); err != nil || response != "ok" {
		t.Fatalf("response = %q, err = %v", response, err)
	}
	select {
	case opts := <-handled:
		if opts.Append != "送信して" {
			t.Fatalf("append = %q", opts.Append)
		}
	case <-time.After(time.Second):
		t.Fatal("handler was not called")
	}
}

func TestCommandEncodingRoundTrip(t *testing.T) {
	// A command without options stays byte-identical, so a daemon that predates
	// options still understands it.
	plain, err := EncodeCommand("toggle", Options{})
	if err != nil || plain != "toggle" {
		t.Fatalf("plain = %q, err = %v", plain, err)
	}
	command, opts, err := DecodeCommand(plain)
	if err != nil || command != "toggle" || opts != (Options{}) {
		t.Fatalf("decode plain: %q %+v %v", command, opts, err)
	}

	line, err := EncodeCommand("show", Options{Append: `say "over"`})
	if err != nil {
		t.Fatalf("EncodeCommand: %v", err)
	}
	if strings.Contains(line, "\n") {
		t.Fatalf("options must stay on one line: %q", line)
	}
	command, opts, err = DecodeCommand(line)
	if err != nil || command != "show" || opts.Append != `say "over"` {
		t.Fatalf("decode: %q %+v %v", command, opts, err)
	}

	if _, _, err := DecodeCommand("show {"); err == nil {
		t.Fatal("broken options must be refused")
	}
	if _, _, err := DecodeCommand("dance"); err == nil {
		t.Fatal("unknown command must be refused")
	}
	if err := (Options{Append: strings.Repeat("あ", MaxAppendRunes+1)}).Validate(); err == nil {
		t.Fatal("an oversized marker must be refused")
	}
	if err := (Options{Append: "two\nlines"}).Validate(); err == nil {
		t.Fatal("a multi-line marker must be refused")
	}
	if _, err := EncodeCommand("hide", Options{Append: "ignored"}); err == nil {
		t.Fatal("append on a command other than show must be refused")
	}
	if _, _, err := DecodeCommand(`hide {"append":"ignored"}`); err == nil {
		t.Fatal("a crafted append on a command other than show must be refused")
	}
}
