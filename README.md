# speech-popup

[日本語](README_ja.md) · [Privacy](PRIVACY.md) · [Microsoft Store submission](docs/MICROSOFT_STORE.md)

A resident voice dictation popup built with Wails. Press a hotkey, speak, edit the transcript, and press Enter to copy it and paste into the previous window.

![speech-popup icon](build/windows/msix/Assets/Square150x150Logo.png)

The interface, help, settings and native tray menu support **English and Japanese**. Japanese is selected for a Japanese WebView/OS language; other languages use English. The speech recognition language is a separate setting.

This project adapts the resident popup and clipboard workflow from [skk-popup](https://github.com/takeshy/skk-popup) and speech input from [gemihub-desktop](https://github.com/takeshy/gemihub-desktop).

## Speech services

| Service | Configuration | Authentication |
|---|---|---|
| Browser speech recognition | `provider = "browser"` | WebView-dependent |
| OpenAI | `endpoint_type = "openai"` | Your API key |
| OpenAI compatible / self-hosted | `endpoint_type = "custom"` | As required by your server |
| whisper.cpp server | `endpoint_type = "whisper-cpp"` | Local server; no model field required |
| Gemini API | `endpoint_type = "gemini-transcribe"` | Your API key |
| Vertex AI | `endpoint_type = "vertex-transcribe"` | Google OAuth desktop client and Cloud project |

The default is browser recognition, but **WebKitGTK and many WebView2 installations do not provide a working recognition backend**. If unavailable, open Settings and choose a recording-based service. Cloud accounts, API usage charges and local models are not included with the app.

Recording-based services receive 16 kHz mono WAV audio through the Go backend, avoiding WebView CORS issues. Each recording session is limited to five minutes, with up to 20 MB of queued audio. The Vertex binding only attaches OAuth credentials to its fixed model endpoint.

## Requirements

- **Windows 10/11:** microphone and Microsoft Edge WebView2 Runtime. In-app global hotkeys are supported.
- **Linux/Wayland:** WebKit2GTK 4.1, `wl-copy`, a microphone, and optionally `wtype` for automatic paste. Hyprland is the primary supported compositor.
- **macOS:** microphone permission; focus restoration and paste use `osascript` and require the corresponding Accessibility/Automation permissions.

## Everyday use

1. Start the app. It stays in the notification area with a microphone icon.
2. Press **Ctrl+8** (Windows default), or choose Open speech input from the tray menu.
3. Speak. Recording starts on opening by default. Pauses segment speech for transcription while recording continues. Ctrl+Space stops recording.
4. Edit the resulting text, then press **Enter** to copy, close and paste into the previous window.
5. Alternatively, end with a configured send phrase (default: `over`, `オーバー`) to remove that phrase and copy/close automatically.

The header displays the current transcription service. The tray menu provides Settings, Help and Quit even if the hotkey fails.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+Space | Start recording / stop and transcribe |
| Ctrl+R | Retry the retained recording |
| Ctrl+D | Discard retained audio |
| Enter / Shift+Enter | Copy and close / insert newline |
| Ctrl+A / Ctrl+E | Start / end of line |
| Ctrl+B / Ctrl+F | Move left / right |
| Ctrl+K / Ctrl+U | Delete to end / start of line |
| Ctrl+O | Select all |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+↑ / Ctrl+↓ | Browse history / return to draft |
| Escape / Ctrl+[ | Cancel active recording/transcription, otherwise close and keep the draft |

Ctrl+K at the end of a line removes the newline and joins the next line. Editing keys match skk-popup. Ctrl+A means **start of line**; use Ctrl+O for select all.

A failed transcription retains its audio for retry, including while you open Settings or correct credentials/endpoints. Switching between browser and recorded recognition discards it. Audio is kept in memory, not across app restarts. A successful transcription consumes the retained recording; copying clears the text and remaining audio.

Text history keeps the latest 30 unique entries and survives restarts. When the popup reopens, it saves the previous text to history even if you never copied it, and clears the input for a new entry. Use Ctrl+↑ / Ctrl+↓ to retrieve it. External clipboard text is also captured on opening. A draft that has not yet been copied or archived is only kept in memory until exit.

### Windows startup

The MSIX package registers a startup task. After installing/updating and launching once, the app starts on subsequent Windows sign-ins. Enable or disable it in **Settings → Apps → Startup → speech-popup**. A previously disabled task must be re-enabled there.

For a standalone EXE, place a shortcut in `shell:startup` (Win+R). For an installed Store app, drag its entry from `shell:appsfolder` into `shell:startup` if using a version without a startup task.

### Linux / Hyprland

Register the hotkey with the compositor; the app does not register Linux hotkeys:

```ini
windowrulev2 = float, class:^(speech-popup)$
windowrulev2 = center, class:^(speech-popup)$
windowrulev2 = pin, class:^(speech-popup)$
windowrulev2 = stayfocused, class:^(speech-popup)$
windowrulev2 = noborder, class:^(speech-popup)$
windowrulev2 = noanim, class:^(speech-popup)$
bind = CTRL, 8, exec, speech-popup show
exec-once = uwsm app -- speech-popup
```

Check the actual class with `hyprctl clients`. Settings can generate a bind line for your chosen shortcut. On macOS, use an OS shortcut tool to run `speech-popup show`.

## Configuration

Open **⋮ → Settings**. Changes take effect without restarting. The config file is:

- Linux: `~/.config/speech-popup/config.toml` (or `$XDG_CONFIG_HOME`)
- Windows: `%AppData%\speech-popup\config.toml`
- macOS: `~/Library/Application Support/speech-popup/config.toml`

```toml
[window]
width = 600
height = 300
restore_focus = true

[speech]
provider = "browser" # or "openai-compatible" for recorded services
endpoint_type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "" # stored in plain text
model = "whisper-1"
language = "auto" # speech language, not the UI language
silence_seconds = 3 # 0 disables silence detection
send_phrase = "over, オーバー"
vertex_project_id = ""
auto_start = true

[clipboard]
backend = "wails" # Windows/macOS; Linux defaults to "wl-copy"
auto_paste = true
auto_paste_delay_ms = 80
paste_key = "ctrl+v" # use ctrl+shift+v for terminals

[hotkey]
enabled = true # Windows only; false by default elsewhere
accelerator = "Ctrl+8"
```

### Local whisper.cpp

```sh
./build/bin/whisper-server -m models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8080
```

Choose whisper.cpp server and set Base URL to `http://127.0.0.1:8080`. Loopback/private HTTP is allowed; direct link-local destinations are blocked by the transport.

### Vertex AI

1. Create a Google Cloud OAuth client of type **Desktop app** and download its JSON.
2. Select Vertex AI in Settings, choose **Select JSON and connect to Google**, select the JSON and authorize in the browser.
3. Enter your Cloud project ID and save.

OAuth credentials are stored under the config directory in `credentials/vertex-oauth.json`. Disconnect attempts token revocation and removes the local credentials.

## Local data and privacy

| Data | Location |
|---|---|
| Copy history | Linux: `$XDG_DATA_HOME/speech-popup/history.json` or `~/.local/share/speech-popup/history.json` |
| Copy history | Windows: `%LocalAppData%\speech-popup\history.json` |
| Copy history | macOS: `~/Library/Application Support/speech-popup/history.json` |
| Log | Config directory: `speech-popup.log` |
| Google credentials | Config directory: `credentials/vertex-oauth.json` |

History writes are debounced by two seconds and flushed when hiding/quitting. Config and credentials contain secrets in plain text; Unix file modes restrict access, but they are not encrypted. MSIX installations may virtualize per-user data paths: the Settings information panel shows the paths requested by the app.

Audio is sent to the selected service. Browser recognition may use a browser/vendor-operated remote service. There is no app analytics or developer-operated transcription server. See [Privacy](PRIVACY.md).

## CLI and troubleshooting

```text
speech-popup            start the resident app
speech-popup show       show or focus the popup
speech-popup toggle     toggle visibility
speech-popup hide       hide the popup
speech-popup quit       quit
speech-popup status     show daemon state and config/log paths
speech-popup version    print version
```

If Ctrl+8 does not work, try `speech-popup show` and inspect `speech-popup.log`. Another app may own the hotkey (Windows error 1409); choose a different key in Settings. Ctrl+8 is intercepted globally while registered, including in browsers.

The Windows GUI EXE attaches to its parent console for CLI output. PowerShell may display the output after returning its prompt.

## Build and test

Go 1.25+ and Node.js 22+ are required. Linux builds also need GTK3 and WebKit2GTK 4.1 development packages.

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
wails3 task linux:build ARCH=amd64
wails3 task windows:build ARCH=amd64
wails3 task darwin:build ARCH=arm64
npm test
go test ./... # Linux: add -tags gtk3 when using the GTK3 dependencies
```

Windows builds generate icon/version resources before compiling. For Store-ready MSIX packages (x64 and ARM64), configure the reserved identity and run `wails3 task windows:msix ARCH=amd64` on Windows with the Windows SDK. See [the submission guide](docs/MICROSOFT_STORE.md). GitHub Actions can build both architectures via the **Windows packages** workflow after identity variables are set.

The UI uses Japanese source messages with an English catalog in `frontend/src/messages.js`; `i18n.js` selects the language and interpolates data without translating it. Native messages live in `internal/i18n`. Extend both catalogs when adding languages.

### Spoken punctuation and line breaks

Set **Pause between utterances (seconds)** to at least 1 (0 disables this feature). Pauses split audio into chunks for ordered transcription and trailing command conversion. The microphone stays open and the next chunk records while the previous request runs. Stop recording with Ctrl+Space or the record button. Browser recognition converts final segments after microphone silence; it requires microphone metering. Manual stop alone does not trigger conversion. Failed recordings preserve this behavior when retried.

| Spoken name | Inserted text |
| --- | --- |
| てん / 点 / 読点 | 、 |
| まる / 丸 / 句点 | 。 |
| comma / カンマ / コンマ | , |
| period / full stop / ピリオド | . |
| question / question mark / クエスチョンマーク / クエスチョン / はてな | ? |
| exclamation / exclamation mark / エクスクラメーション / エクスクラメーションマーク / びっくりマーク | ! |
| new line / newline / Enter / 改行 / エンター | Line break |

Only the trailing name is converted, not commands in the middle of a sentence. Short Japanese names (てん / まる / 点 / 丸) must be recognized as separate words, preceded by whitespace/punctuation or at the start of a segment, to avoid changing words such as 始まる. A spoken line break inserts a newline in the editor; it does not copy or submit. The existing send phrase takes precedence. Recognition accuracy depends on the selected service.

Final recognition results omit an automatic trailing Japanese full stop (`。`). Internal sentence boundaries remain. Say `まる` after silence to insert an explicit `。`. A redundant `。` before `、` is removed, including when the comma is dictated in a later recording.

The popup grows with line breaks and wrapped text, up to 600 px tall (or your configured height if larger), within the available screen height. Beyond that, the editor scrolls. Removing text shrinks it toward the configured height; automatic sizing does not change your saved settings.
