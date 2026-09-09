// Package ipc implements the local protocol used to control the running
// speech-popup daemon from short-lived CLI invocations. Unix domain sockets are
// used on Unix and a named pipe is used on Windows.
//
// The protocol is line-based plain text: a client connects, sends one of
// "toggle" / "show" / "hide" / "quit", optionally followed by a space and a
// JSON object of options, and receives either "ok" or "error: <message>".
// JSON keeps a command on one line whatever the option text contains, and lets
// a daemon that predates an option reject it instead of misreading it.
package ipc

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// MaxAppendRunes bounds Options.Append: it is a short marker appended to what
// the user dictated, not a place to put a document.
const MaxAppendRunes = 200

// Options carries what a command needs beyond its verb.
type Options struct {
	// Append is added to the transcript when the popup opened by this command
	// copies its text. The caller uses it to mark a paste as its own; the popup
	// appends it even to an empty transcript, so "nothing was dictated" is
	// still something the caller can recognise.
	Append string `json:"append,omitempty"`
}

// IsValidCommand reports whether command is one accepted by the daemon.
func IsValidCommand(command string) bool {
	switch command {
	case "toggle", "show", "hide", "quit":
		return true
	default:
		return false
	}
}

// Validate rejects options a daemon cannot act on.
func (o Options) Validate() error {
	if utf8.RuneCountInString(o.Append) > MaxAppendRunes {
		return fmt.Errorf("append text must be %d characters or fewer", MaxAppendRunes)
	}
	if strings.ContainsAny(o.Append, "\n\r") {
		return fmt.Errorf("append text must be a single line")
	}
	return nil
}

// EncodeCommand renders one protocol line. Options are omitted when empty, so
// a plain command stays byte-identical to what older daemons expect.
func EncodeCommand(command string, opts Options) (string, error) {
	if !IsValidCommand(command) {
		return "", fmt.Errorf("invalid command %q", command)
	}
	if err := opts.Validate(); err != nil {
		return "", err
	}
	if opts.Append != "" && command != "show" {
		return "", fmt.Errorf("--append is only valid with show")
	}
	if opts == (Options{}) {
		return command, nil
	}
	encoded, err := json.Marshal(opts)
	if err != nil {
		return "", err
	}
	return command + " " + string(encoded), nil
}

// DecodeCommand splits a protocol line into its verb and options.
func DecodeCommand(line string) (string, Options, error) {
	command, rest, hasOptions := strings.Cut(strings.TrimSpace(line), " ")
	if !IsValidCommand(command) {
		return "", Options{}, fmt.Errorf("invalid command %q", line)
	}
	if !hasOptions {
		return command, Options{}, nil
	}
	var opts Options
	if err := json.Unmarshal([]byte(strings.TrimSpace(rest)), &opts); err != nil {
		return "", Options{}, fmt.Errorf("invalid options for %q", command)
	}
	if err := opts.Validate(); err != nil {
		return "", Options{}, err
	}
	if opts.Append != "" && command != "show" {
		return "", Options{}, fmt.Errorf("--append is only valid with show")
	}
	return command, opts, nil
}
