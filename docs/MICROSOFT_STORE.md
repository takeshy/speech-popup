# Microsoft Store submission — speech-popup

This repository can build **unsigned MSIX packages for Store upload**, for x64 and ARM64. It does not submit or publish an app automatically. A standalone EXE build does not install the startup task.

## 1. Reserve the identity

Reserve the app name in Partner Center. Under Product identity, copy the exact values of:

- **Package/Identity/Name**
- **Package/Identity/Publisher** (the complete `CN=...` value)

Do not reuse skk-popup's package name. Even with the same developer account, speech-popup is a separate product. Verify the publisher rather than assuming it matches another app.

For local builds, copy `build/windows/msix/store.example.json` to `build/windows/msix/store.json` and replace both placeholders. This local file is ignored by Git. Alternatively set `MSIX_PACKAGE_NAME` and `MSIX_PUBLISHER` in the environment; these take precedence over the file. For GitHub Actions, create repository **variables** with those two names.

The packaging command refuses missing/placeholder identities. `wails.json` is the application version; `build/windows/info.json` supplies Windows EXE version resources. Keep those versions equal. MSIX uses `major.minor.patch.0`.

## 2. Build on Windows

Install Go 1.25+, Node.js 22+, the Windows SDK (MakeAppx.exe) and Wails CLI:

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
wails3 task windows:msix ARCH=amd64
wails3 task windows:msix ARCH=arm64
```

Outputs are `bin/speech-popup-windows-amd64.msix` and `bin/speech-popup-windows-arm64.msix`. The EXE is rebuilt for each architecture and includes the app icon/version resources. The `Windows packages` GitHub Actions workflow builds EXEs for both architectures when manually dispatched. It also builds MSIX packages when both identity variables are set; otherwise it emits a notice and skips only MSIX packaging. Invalid configured identities still fail packaging.

The MSIX contains the full-trust desktop EXE, microphone/network declarations, startup task and app/Store/tile logos. The UI ships English and Japanese resources inside the frontend. Supported package languages are en-US and ja-JP.

Microsoft signs the package distributed through the Store. For local installation tests, sign a copy with a trusted test certificate whose subject matches the package Publisher; do not change the Store identity to match an unrelated certificate. [Package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements).

## 3. Verify on Windows before submission

- Install the signed test package on x64; also test ARM64 if submitting that architecture.
- Launch once, then sign out/in: the app should start in the notification area. Toggle it in Settings → Apps → Startup.
- Verify there is one microphone tray icon, with localized Settings/Help/Quit entries.
- Test Japanese and English OS/WebView language environments.
- Test microphone permission denial and normal recording.
- Browser recognition may be unavailable in WebView2. The UI must direct the user to a supported recorded service.
- Test whisper.cpp locally or use your own supported API account; confirm transcription, retry, editing keys and paste into another application.
- Confirm external clipboard history persists, settings apply, and uninstall/reinstall behavior is understood.

The Linux development environment cannot validate installation, Windows SDK packaging or Store certification. A successful cross-compile is not a replacement for these checks.

## 4. Prepare the listing

Use `STORE_LISTING.md` for English/Japanese copy and reviewer notes. Prepare real screenshots of the running **Windows app** (popup, settings, provider selection) in each listing language. Do not present mockups or generated screenshots as the application's actual UI.

Publish the privacy policy to a public HTTPS page and enter that URL in Partner Center. `docs/privacy/index.html` contains both language versions and `docs/index.html` is a minimal landing page. You can publish the `docs/` directory with GitHub Pages; **enable/configure Pages and verify the URL yourself before submitting**. The expected project URL, if Pages is enabled for this repository, is `https://takeshy.github.io/speech-popup/privacy/`. It is not assumed to be live merely because these files exist.

Set the support URL to the repository's issue tracker. Complete the required age-rating/content declarations and describe all external account, API-charge, WebView2 and local-model requirements accurately. Review the current Partner Center requirements when submitting.

For the `runFullTrust` capability, explain that this is a Wails/Go desktop utility using Win32 global hotkeys, clipboard access, focus restoration/paste and a notification icon. It is not a background data collection service. Microphone access is used for the requested dictation. See [Microsoft's capability documentation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations).

Upload the MSIX packages and submit for certification in Partner Center. Account setup, identity reservation, hosted policy verification, real screenshots and the final submission remain developer actions.

## 日本語の要点

1. Partner Center で **speech-popup 用の名前を予約**し、製品 ID の `Package/Identity/Name` と `Package/Identity/Publisher` を取得します。skk-popup のパッケージ名は使い回しません。
2. `store.example.json` を `store.json` にコピーして設定します。GitHub Actions では同名のリポジトリ変数 `MSIX_PACKAGE_NAME` / `MSIX_PUBLISHER` を設定します。未設定でも EXE のビルドは実行され、MSIX の生成だけがスキップされます。
3. Windows SDK を入れた Windows で `wails3 task windows:msix ARCH=amd64` / `ARCH=arm64` を実行します。Store 提出用の未署名 MSIX が生成されます。
4. 実機でマイク・書き起こし・貼り付け・英日 UI・自動起動を確認します。ローカルインストール検証には適切なテスト署名が必要です。
5. 実際の Windows 画面のスクリーンショットと公開済みのプライバシーポリシー URL を用意し、英日ストア説明を入力します。
6. `runFullTrust` は Win32 のホットキー・クリップボード・貼り付け・トレイを使うデスクトップアプリとして説明します。
7. MSIX をアップロードして審査へ提出します。このリポジトリから申請・公開を自動実行することはありません。

The **Release** workflow handles version tags and uploads all platform binaries and configured Windows MSIX packages to a draft GitHub Release. It can also be dispatched from `main` with an existing version tag. Publishing a GitHub Release does not submit the app to Microsoft Store.
