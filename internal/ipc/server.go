package ipc

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// Handler processes a single IPC command. quit is handled by the server
// itself and never reaches the handler.
type Handler func(command string) error

// Server listens on the platform's local IPC transport and dispatches commands.
type Server struct {
	listener net.Listener
	endpoint string
	handler  Handler
	onQuit   func()
	closed   chan struct{}
}

// NewServer creates a listener on endpoint. The caller must ensure no other
// daemon owns it (see PrepareEndpoint).
func NewServer(endpoint string) (*Server, error) {
	listener, err := listen(endpoint)
	if err != nil {
		return nil, err
	}
	return &Server{listener: listener, endpoint: endpoint, closed: make(chan struct{})}, nil
}

// SetHandler installs the command handler used once the app context is up.
func (s *Server) SetHandler(handler Handler) {
	s.handler = handler
}

// SetQuitCallback installs the hook invoked when a client sends quit; it
// must terminate the process (e.g. runtime.Quit).
func (s *Server) SetQuitCallback(onQuit func()) {
	s.onQuit = onQuit
}

// Serve accepts connections until Close. Connections received before
// SetHandler are answered with an error so early CLI calls fail loudly.
func (s *Server) Serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.closed:
				return
			default:
				continue
			}
		}
		s.handleConn(conn)
	}
}

// Close stops serving and removes the socket file.
func (s *Server) Close() {
	select {
	case <-s.closed:
		return
	default:
		close(s.closed)
	}
	_ = s.listener.Close()
	cleanup(s.endpoint)
}

func (s *Server) handleConn(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	command, err := readLine(conn)
	if err != nil || !IsValidCommand(command) {
		writeResponse(conn, fmt.Sprintf("error: invalid command %q", command))
		return
	}
	if command == "quit" {
		writeResponse(conn, "ok")
		s.Close()
		if s.onQuit != nil {
			s.onQuit()
		}
		return
	}
	if s.handler == nil {
		writeResponse(conn, "error: speech-popup is still starting")
		return
	}
	if err := s.handler(command); err != nil {
		writeResponse(conn, "error: "+err.Error())
		return
	}
	writeResponse(conn, "ok")
}

func writeResponse(conn net.Conn, response string) {
	_, _ = conn.Write([]byte(response + "\n"))
}

func readLine(conn net.Conn) (string, error) {
	buf := make([]byte, 0, 64)
	one := make([]byte, 1)
	for {
		n, err := conn.Read(one)
		if n > 0 {
			if one[0] == '\n' {
				return strings.TrimRight(string(buf), "\r"), nil
			}
			buf = append(buf, one[0])
			if len(buf) > 4096 {
				return "", fmt.Errorf("command too long")
			}
		}
		if err != nil {
			if len(buf) > 0 {
				return strings.TrimRight(string(buf), "\r"), nil
			}
			return "", err
		}
	}
}
