# Store listing draft

Review this text against the final Windows build before entering it in Partner Center. Do not claim Store availability until certification/publication is complete.

## English

**Name:** speech-popup

**Short description:** Speak, edit and paste text with a keyboard-friendly dictation popup.

**Description:**

Turn spoken words into text without leaving your workflow. Open speech-popup with a hotkey, record your voice, edit the transcript, then copy and paste it into the previous application.

Choose OpenAI, an OpenAI-compatible endpoint, a local whisper.cpp server, Gemini or Vertex AI. Browser speech recognition is also available where the embedded browser supports it. Cloud accounts, API keys, usage charges and local speech models are not included.

Features:
- A resident popup with a notification-area menu and configurable Windows hotkey.
- Current transcription service shown in the header.
- Microphone level, elapsed time, silence detection and retry of failed recordings.
- Editable transcripts with Emacs-style shortcuts and undo/redo.
- Optional automatic paste and spoken send phrases.
- Up to 30 locally stored clipboard history entries.
- English and Japanese UI, selected from the system/WebView language.
- Optional Windows sign-in startup, manageable in Windows Settings.

Requires a microphone and WebView2 Runtime. Browser speech recognition may be unavailable in WebView2; choose a recorded service in Settings. Remote services receive the audio you send and have their own privacy policies. The app reads existing clipboard text into local history when opened. See the privacy policy for local storage and credentials.

## 日本語

**名前:** speech-popup

**短い説明:** 話して、直して、貼り付ける。キーボードで使える音声入力ポップアップ。

**説明:**

ホットキーで呼び出して話すだけで、音声をテキストに変換。認識結果をその場で編集し、直前のアプリへコピー・貼り付けできます。

OpenAI、OpenAI 互換サーバー、ローカルの whisper.cpp、Gemini、Vertex AI に対応。埋め込みブラウザが対応している環境ではブラウザ音声認識も選べます。クラウドアカウント・API Key・利用料金・ローカル音声モデルは付属しません。

主な機能:
- 通知領域に常駐し、Windows のホットキーを設定可能
- 現在の書き起こしサービスをヘッダーに表示
- マイクレベル・経過時間・無音停止・失敗した録音の再送
- 認識結果の編集、Emacs 風キー操作、元に戻す・やり直し
- 任意の自動貼り付けと「合図の言葉」による送信
- クリップボード履歴をローカルに最大30件保存
- システム/WebView の言語に応じた英語・日本語 UI
- Windows の設定から切り替えられるサインイン時の自動起動

マイクと WebView2 Runtime が必要です。WebView2 ではブラウザ音声認識を利用できない場合があるため、設定から録音方式を選択してください。外部サービスを選ぶと音声がその接続先に送信されます。ポップアップを開く際に既存のクリップボードのテキストをローカル履歴へ取り込みます。詳しくはプライバシーポリシーをご確認ください。

## Reviewer notes (English)

This is a Wails/Go full-trust desktop application. `runFullTrust` is needed for Win32 global hotkey registration, native clipboard access, restoring focus and synthesizing the paste shortcut into the previous application, and notification-area integration. Microphone access is used for voice dictation; network access reaches the user's selected speech endpoint or Google OAuth.

On first launch the app resides in the notification area. Right-click its microphone icon and open Settings. Browser speech recognition is the default but may not work in WebView2; use a recording-based service to test audio input. Configure your supported API account, or run a local whisper.cpp server and set its Base URL to `http://127.0.0.1:8080` (no API key required). The app does not bundle a local model or a free cloud subscription.

Open the popup with Ctrl+8, or the tray menu if the key is occupied. Record speech, stop with Ctrl+Space, and press Enter to copy/paste. Escape cancels or hides. Settings can disable automatic recording and paste. The startup task is enabled after the first app launch and can be disabled in Windows Settings → Apps → Startup. Use the tray menu to quit.

Add any private reviewer credentials through Partner Center's private notes only; never commit them here. Include concrete screenshots and test details from the exact submitted package.
