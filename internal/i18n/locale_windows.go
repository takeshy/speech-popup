//go:build windows

package i18n

import "golang.org/x/sys/windows"

func systemLanguage() string {
	// LANGID's low 10 bits identify the primary language (0x11 = Japanese).
	id, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage").Call()
	if id&0x3ff == 0x11 {
		return "ja"
	}
	return "en"
}
