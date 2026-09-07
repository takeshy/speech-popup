//go:build !windows

package main

// attachParentConsole is Windows-only: every other platform links a normal
// console executable and already has working standard streams.
func attachParentConsole() {}
