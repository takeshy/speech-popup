// Package i18n localizes native menus and application-owned backend errors.
package i18n

import (
	"os"
	"strings"
	"sync/atomic"
)

var japanese atomic.Bool

func init() { SetLanguage(systemLanguage()) }

func SetLanguage(locale string) {
	locale = strings.ToLower(locale)
	japanese.Store(locale == "ja" || strings.HasPrefix(locale, "ja-") || strings.HasPrefix(locale, "ja_"))
}

func environmentLanguage() string {
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return "en"
}

func T(source string) string {
	if !japanese.Load() {
		if translated, ok := messages[source]; ok {
			return translated
		}
	}
	return source
}
