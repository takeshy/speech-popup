// Package ipc implements the local protocol used to control the running
// speech-popup daemon from short-lived CLI invocations. Unix domain sockets are
// used on Unix and a named pipe is used on Windows.
//
// The protocol is line-based plain text: a client connects, sends one of
// "toggle" / "show" / "hide" / "quit", and receives either "ok" or
// "error: <message>".
package ipc

// IsValidCommand reports whether command is one accepted by the daemon.
func IsValidCommand(command string) bool {
	switch command {
	case "toggle", "show", "hide", "quit":
		return true
	default:
		return false
	}
}
