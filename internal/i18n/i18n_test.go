package i18n

import (
	"fmt"
	"testing"
)

func TestNativeMessagesFollowUILanguage(t *testing.T) {
	before := japanese.Load()
	t.Cleanup(func() { japanese.Store(before) })
	for _, locale := range []string{"ja", "ja-JP", "JA_jp"} {
		SetLanguage(locale)
		if got := T("設定…"); got != "設定…" {
			t.Fatalf("%s: %s", locale, got)
		}
	}
	for _, locale := range []string{"en-US", "fr-FR", ""} {
		SetLanguage(locale)
		if got := T("設定…"); got != "Settings…" {
			t.Fatalf("%s: %s", locale, got)
		}
	}
	if got := fmt.Sprintf(T("ホットキー %s を登録できません: %v"), "Ctrl+8", "occupied"); got != "Cannot register hotkey Ctrl+8: occupied" {
		t.Fatal(got)
	}
	if T("OS error") != "OS error" {
		t.Fatal("unknown system error changed")
	}
}
