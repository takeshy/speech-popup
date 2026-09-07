# Privacy policy — speech-popup

[日本語](PRIVACY_ja.md) · Last updated: September 7, 2026

speech-popup is a desktop voice-input utility developed by takeshy. This policy describes the application's behavior; the speech service you choose has its own terms and privacy policy.

## Microphone and speech services

The app uses your microphone when recording or browser speech recognition is started. By default, opening the popup starts recording; you can disable this in Settings. Hiding the popup stops microphone capture.

For recorded transcription, audio is converted to WAV and sent directly from your computer to your selected OpenAI, OpenAI-compatible, whisper.cpp, Gemini or Vertex AI endpoint. A local endpoint keeps this request local to that server; a cloud or remote endpoint receives the audio. Browser speech recognition is provided by the WebView/browser vendor and may send audio to its service.

The developer does not operate a transcription server or receive your audio through an app-operated relay. Providers may retain or process data according to their own policies. Cloud services may require a separate account and incur charges.

The app retains failed recordings in memory for retry. It does not write recordings to its own audio files. Audio is discarded on successful transcription, explicit discard, certain session/provider changes, or app exit. WebView, operating-system and provider behavior is outside this local retention mechanism.

## Clipboard and history

Copying places text on the system clipboard. Automatic paste can send it to the previously focused application; you can disable automatic paste.

Each time the popup opens, it reads the current clipboard text and adds it to local history. This can include sensitive text copied in other applications. The app stores up to 30 unique history entries in `history.json`. It does not upload this history. On reopening the popup, the previous draft is also saved to this history and the input is cleared, even if it was never copied. A draft that has not yet been copied or archived remains only in memory and is not restored after exit.

## Settings, credentials and logs

Settings and API keys are stored in `config.toml`. Google OAuth client information, refresh/access tokens and expiry are stored in `credentials/vertex-oauth.json`. These files are not encrypted. Files are written with restrictive Unix modes where supported; Windows access depends on the containing profile and its permissions.

The app uses Google OAuth to authenticate Vertex AI requests. Disconnecting attempts to revoke the refresh token and deletes local credentials. If revocation fails, you can remove the application's access in your Google account separately.

A local diagnostic log records startup, hotkey and operational errors. The app does not deliberately log audio, transcripts or API keys, but external error messages may contain additional details. Review logs before sharing them.

## Analytics and control

The app contains no advertising or analytics SDK and does not sell user data. Optional provider services are contacted only as part of the functionality you use.

To remove local data, quit the app and delete its history, configuration, credentials and logs. The Settings information panel and README describe the paths; Windows package virtualization may place Store-app data under the package's profile directories. Deleting local data does not delete copies held by a speech provider, the clipboard manager or applications where you pasted text.

You can turn off automatic recording/paste in Settings, deny microphone access through the OS, and disable automatic startup in Windows Settings → Apps → Startup.

## Contact and changes

For questions or requests, use [the project issue tracker](https://github.com/takeshy/speech-popup/issues). Do not post API keys, tokens or sensitive transcripts publicly. This policy will be updated when relevant application behavior changes.
