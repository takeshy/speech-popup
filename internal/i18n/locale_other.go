//go:build !windows

package i18n

func systemLanguage() string { return environmentLanguage() }
