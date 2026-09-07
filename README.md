# speech-popup

Wails 製の常駐型 **音声入力ポップアップ**。ホットキーで呼び出して話すと、認識結果がクリップボードへ入り、直前のウィンドウへ貼り付けられます。Linux/Wayland (Hyprland)・Windows・macOS 対応。

[skk-popup](https://github.com/takeshy/skk-popup) の常駐ポップアップ／クリップボード連携の仕組みはそのまま、入力方式を SKK から音声認識に置き換えたものです。音声認識の実装は [gemihub-desktop](https://github.com/takeshy/gemihub-desktop) の音声入力機能を移植しています。

## 使える音声認識サービス

既定は **ブラウザ音声認識 (`provider = "browser"`)** です。API Key もサーバーも要らないので、インストール直後にそのまま話せます。ただし音声認識のバックエンドを持つかは WebView 次第で、**WebKitGTK には無く、WebView2 でも動かない場合があります**。その場合はポップアップに理由と `設定を開く` ボタンが出るので、下表の録音方式へ切り替えてください。

| 方式 | 設定 | 備考 |
|---|---|---|
| OpenAI | `endpoint_type = "openai"` | `POST {base_url}/audio/transcriptions`。`whisper-1` / `gpt-4o-transcribe` など |
| OpenAI 互換 (自前ホスト) | `endpoint_type = "custom"` | 同上。Groq・LM Studio・vLLM など |
| whisper.cpp server | `endpoint_type = "whisper-cpp"` | `POST {base_url}/inference`。ローカルの平文 HTTP を許可。Model 不要 |
| Gemini API | `endpoint_type = "gemini-transcribe"` | `gemini-3.5-transcribe` に音声を inline で渡す。API Key |
| Vertex AI | `endpoint_type = "vertex-transcribe"` | `gemini-3.5-transcribe-preview`。Google OAuth (デスクトップクライアント JSON) |
| ブラウザ音声認識 | `provider = "browser"` | WebView の `SpeechRecognition`。逐次認識だが **WebKitGTK / WebView2 は非対応**。対応環境でのみ選択してください |

音声は 16kHz モノラル WAV に変換してから送ります (WebM/Opus をデコードできないサーバーでも動くため)。録音は最長 5 分・20MB まで。

HTTP リクエストは WebView からではなく Go 側のプロキシ (`SpeechHTTPRequest`) を通ります。CORS を回避でき、API Key がプリフライトに乗ることもありません。Vertex AI だけは専用の `VertexSpeechHTTPRequest` を通り、OAuth アクセストークンは**固定のモデル・エンドポイント以外には決して付きません**。

## 動作要件

| OS | 必要なもの |
|---|---|
| Linux + Wayland (Hyprland 推奨) | `wl-clipboard` (`wl-copy`)、WebKit2GTK 4.1、任意で `wtype` (自動貼り付け時)、マイク (PipeWire/PulseAudio) |
| Windows 10 以降 | 追加要件なし (ホットキーはアプリ内登録) |
| macOS | **マイク**権限と、`osascript` が使う **Accessibility / Automation** 権限 |

## 使い方

常駐すると**通知領域 (システムトレイ) にマイクのアイコン**が出ます。左クリックで表示/非表示、右クリックで `音声入力を開く` / `設定…` / `ヘルプ` / `終了`。ホットキーが登録できなかった場合でも、ここから設定に到達できます。

```text
speech-popup            デーモンを起動 (常駐)
speech-popup toggle     表示/非表示をトグル
speech-popup show       表示、または表示済みの入力欄へフォーカス
speech-popup hide       非表示
speech-popup quit       デーモン終了
speech-popup version    バージョン表示
```

1. ホットキー (既定 **`Ctrl+8`**) で入力窓を出す。`auto_start = true` (既定) なら**その瞬間から録音が始まります**
2. 話す。無音が `silence_seconds` 続くと自動で停止し、認識が走ります (`Ctrl+Space` / ● ボタンでも停止)
3. 認識結果がテキストエリアに入る。そのまま手で直せます
4. `Enter` (または Copy) → クリップボードにコピーして窓が閉じ、直前のウィンドウへ貼り付けられます
5. 最後に合図の言葉 (既定 `over` / `オーバー`) を話すと、その語を除いて 3〜4 を自動で行います

デーモンは常駐するので 2 回目以降の表示は即時です。

### ホットキー (既定 `Ctrl+8`)

窓を呼び出すキーの既定は **`Ctrl+8`** です。**`8` の形がマイクに見える**ので覚えやすい、というのが選定理由です。

実用上の理由もあります。`Ctrl+Shift+S` のような「音声 = Speech」から連想しやすい英字の組み合わせは、Windows では OneDrive・ShareX・Snipping Tool などが先に `RegisterHotKey` で握っていることが多く、後から登録しようとすると**黙って失敗します** (エラーコード 1409)。数字キーはその競合を踏みにくい、という実利があります。

なお `RegisterHotKey` はシステム全体でそのキーを横取りするので、`Ctrl+8` を内部で使うアプリ (ブラウザの「8 番目のタブへ移動」など) は、常駐中そのキーを受け取れなくなります。困る場合は設定で変更してください。

- Linux/Hyprland: アプリは登録しません。`bind = CTRL, 8, exec, speech-popup show` を `hyprland.conf` に書きます (下記)
- Windows: アプリが `RegisterHotKey` で自動登録します
- macOS: OS 側のショートカット機能から `speech-popup show` を呼びます

### 窓の中のキー操作

- `Ctrl+Space` / ● 録音 — 録音の開始・停止 (停止で認識開始)
- `Ctrl+R` / 再認識 — 保持している録音をもう一度サーバーへ送る (通信エラーからの復帰用。録り直し不要)
- `Ctrl+D` — 保持している録音を破棄
- `Enter` — コピーして閉じる / `Shift+Enter` — 改行
- `Ctrl+↑` / `Ctrl+↓` — コピー履歴を移動 (最大 30 件。`Ctrl+↓` で下書きに戻る)
- `Escape` / `Ctrl+[` — 録音中なら中止 / それ以外は閉じる (コピーせず入力内容は次回まで保持)
- ⋮ メニュー — 設定 / ヘルプ

認識に失敗しても録音は保持されるので、`Ctrl+R` で同じ音声を再送できます。コピーに成功した時点で破棄されます。

### Hyprland への登録

```ini
# ~/.config/hypr/hyprland.conf

windowrulev2 = float, class:^(speech-popup)$
windowrulev2 = center, class:^(speech-popup)$
windowrulev2 = pin, class:^(speech-popup)$
windowrulev2 = stayfocused, class:^(speech-popup)$
windowrulev2 = noborder, class:^(speech-popup)$
windowrulev2 = noanim, class:^(speech-popup)$

bind = CTRL, 8, exec, speech-popup show

exec-once = uwsm app -- speech-popup
```

- `stayfocused` が最重要です。これがないと窓が表示されてもキーボードフォーカスが移りません。
- 実際の `class` 名は `hyprctl clients` で確認してください。
- 設定画面の「ショートカット」でキーを入力すると、この `bind =` 行を生成してコピーできます。

### Windows

ホットキーはアプリ自身が `RegisterHotKey` で登録します (既定 `Ctrl+8`、`[hotkey]` で変更・無効化可能)。自動起動はスタートアップフォルダ (`Win+R` → `shell:startup`) にショートカットを置いてください。

**ホットキーが効かないとき**は、`RegisterHotKey` が他アプリに先を越されている可能性が高いです。切り分けは次の順で:

```powershell
speech-popup.exe status        # デーモンの生死と config/log の実パス
speech-popup.exe show          # 窓が出る → ホットキー登録だけが失敗している
type "$env:AppData\speech-popup\speech-popup.log"   # 理由が残っている
```

Windows 版は `-H windowsgui` でビルドしているため OS はコンソールを与えません。CLI サブコマンドの出力が消えないよう、起動時に `AttachConsole(ATTACH_PARENT_PROCESS)` で呼び出し元のコンソールへ繋ぎ直しています (`console_windows.go`)。PowerShell は GUI サブシステムの exe を待たないので、**プロンプトが戻ったあとに出力が表示される**ことがあります。

ログには `hotkey: registered Ctrl+8` か、失敗理由 (`...1409` = 既に登録済み) が出ます。登録に失敗している場合は窓の下部にも赤字で表示され、**⋮ → 設定 → 情報**の「ホットキー」欄で現在の状態を確認できます。別のキー (`Ctrl+Alt+S` など) に変えて保存すれば、その場で再登録されます。

### macOS

キーボードショートカットは OS 側に委譲します: [Shortcuts.app](https://support.apple.com/guide/shortcuts-mac/intro-to-shortcuts-apdfebc4f80a/mac) で「シェルスクリプトを実行」→ `speech-popup show` を作り、キーを割り当ててください (skhd / Raycast / Hammerspoon でも可)。

初回実行時に**マイク**、および自動貼り付け・フォーカス復帰のための **Accessibility / Automation** 権限を求められます。設定の `paste_key` の `ctrl` は **Cmd** として扱われます。

## 設定

Linux: `~/.config/speech-popup/config.toml` / Windows: `%AppData%\speech-popup\config.toml` / macOS: `~/Library/Application Support/speech-popup/config.toml`

**⋮ → 設定** で同じ内容を GUI から編集できます。保存すると `config.toml` が書き換わり、**すべての設定が再起動なしで反映されます**。

```toml
[window]
width = 600
height = 300
# 閉じたあとに直前のウィンドウへフォーカスを戻す
restore_focus = true

[speech]
# "browser" (WebView の音声認識、既定) | "openai-compatible" (録音して STT へ POST)
provider = "browser"
# "openai" | "whisper-cpp" | "custom" | "gemini-transcribe" | "vertex-transcribe"
endpoint_type = "openai"
base_url = "https://api.openai.com/v1"
# 平文で保存される (config.toml は 0600 で書き込まれる)。vertex-transcribe では未使用
api_key = ""
model = "whisper-1"
# BCP-47 (ja / en / ja-JP ...) もしくは "auto"
language = "auto"
# 無音がこの秒数続いたら録音を自動停止する (0 で無効)
silence_seconds = 3
# 認識結果の末尾がこの語なら、その語を除いてコピーして閉じる (カンマ区切り)
send_phrase = "over, オーバー"
# vertex-transcribe で使う Google Cloud プロジェクト ID
vertex_project_id = ""
# ポップアップを開いた直後に録音を開始する
auto_start = true

[clipboard]
# "wl-copy" | "wails" (既定: Linux=wl-copy, Windows/macOS=wails)
backend = "wl-copy"
# コピー後に自動で貼り付けショートカットを送出 (Linux: wtype, Windows: SendInput, macOS: osascript)
auto_paste = true
# 自動貼り付け時、フォーカス復帰から送出までの待ち時間 (ミリ秒)
auto_paste_delay_ms = 80
# "ctrl+v" | "ctrl+shift+v"
# foot/alacritty/kitty などの多くのターミナルは Ctrl+V を readline の「次の文字を
# リテラル入力」に使うため、貼り付けには ctrl+shift+v が必要。
paste_key = "ctrl+shift+v"

[hotkey]
# Windows のみ有効。アプリ内でグローバルホットキーを登録する (RegisterHotKey)。
# 既定は Windows のみ true (Linux は Hyprland bind、macOS は OS のショートカット
# 機能に委譲するため、他 OS では設定しても無視される)
enabled = true
accelerator = "Ctrl+8"   # A-Z, 0-9, F1-F24 + Ctrl/Shift/Alt/Win   # A-Z, 0-9, F1-F24 + Ctrl/Shift/Alt/Win
```

### whisper.cpp をローカルで使う

```sh
# whisper.cpp 付属のサーバーを起動
./build/bin/whisper-server -m models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8080
```

設定で サービス = `whisper.cpp server` / Base URL = `http://127.0.0.1:8080` にします (Model は不要)。ローカル宛の平文 HTTP は許可されますが、リンクローカルアドレス (169.254.0.0/16, fe80::/10) はメタデータエンドポイント対策で常に拒否されます。

### Vertex AI を使う

1. Google Cloud で「デスクトップアプリ」タイプの OAuth クライアントを作り、JSON をダウンロード
2. 設定 → サービス = `Vertex AI` → **Google に接続** → JSON を選択 → ブラウザで認可
3. プロジェクト ID を入力して保存

リフレッシュトークンは `<config>/speech-popup/credentials/vertex-oauth.json` に 0600 で保存されます。**接続を解除**すると Google 側でも失効させたうえで削除します。

## データファイル

| ファイル | Linux | Windows | macOS |
|---|---|---|---|
| コピー履歴 (`history.json`) | `$XDG_DATA_HOME/speech-popup/` | `%LocalAppData%\speech-popup\` | `~/Library/Application Support/speech-popup/` |
| Vertex OAuth 認証情報 | `~/.config/speech-popup/credentials/` | `%AppData%\speech-popup\credentials\` | `~/Library/Application Support/speech-popup/credentials/` |
| ログ (`speech-popup.log`) | `~/.config/speech-popup/` | `%AppData%\speech-popup\` | `~/Library/Application Support/speech-popup/` |

デーモンは Windows では `-H windowsgui`、他 OS でも切り離して起動されるため標準エラー出力が誰にも見えません。起動時のログ (ホットキー登録の成否など) は上記ファイルにも書かれます (1MB を超えたら切り詰め)。

書き込みは最終更新 2 秒後にデバウンスフラッシュされ、窓を閉じるタイミングでも必ずフラッシュされます。

## 自前でビルドする

前提:

- Go 1.25 以降 (`.mise.toml` を同梱)
- Node.js 22 以降 (フロントエンドのコピーとテストのみ。バンドラは使いません)
- Linux のみ: `libgtk-3-dev` と `libwebkit2gtk-4.1-dev` 相当 (Arch なら `webkit2gtk-4.1`)

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
wails3 task linux:build ARCH=amd64       # Linux
# wails3 task windows:build ARCH=amd64   # Windows
# wails3 task darwin:build ARCH=arm64    # macOS
install -Dm755 bin/speech-popup ~/.local/bin/speech-popup
```

Linux ビルドは Wails v3 の `gtk3` タグを使い、WebKit2GTK 4.1 環境との互換性を維持します。

## テスト

```sh
go test ./...              # 設定・履歴ストア・HTTP プロキシ・Vertex ガード
node --test tests/*.test.js  # 認識リクエストの組み立て・WAV 生成・無音検出
```
