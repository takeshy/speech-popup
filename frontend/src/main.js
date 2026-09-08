import { t, getLanguage, setLanguage, localizeDOM } from "./i18n.js";
// speech-popup UI: a resident popup that records speech, transcribes it, and
// puts the result on the clipboard for the window that had focus before.

import { defaultSpeechCommands, speechCommandsFor, splitCommandPhrases } from "./speech_commands.js";
import { defaultSendPhrase, initialSendPhrase, sendPhraseLanguage } from "./send_phrases.js";
import { speechLanguageOptions } from "./speech_languages.js";
import { createRecorder, speechSupported } from "./recorder.js";
import { browserSpeechSupported, createBrowserRecognizer } from "./browser_speech.js";
import { createAudioMeter } from "./meter.js";
import { createTextEditor } from "./editor.js";
import { createAutoSizer } from "./autosize.js";
import { endpointPreset, isGoogleEndpoint, validateSpeechSettings } from "./speech.js";

(() => {
  "use strict";

  const inputEl = document.getElementById("input");
  const modeEl = document.getElementById("mode");
  const speechProviderEl = document.getElementById("speech-provider");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const errorSettingsButton = document.getElementById("error-settings");
  const activityEl = document.getElementById("activity");
  const activityTitleEl = document.getElementById("activity-title");
  const activityHintEl = document.getElementById("activity-hint");
  const activityElapsedEl = document.getElementById("activity-elapsed");
  const meterEl = document.getElementById("meter");
  const recordButton = document.getElementById("record");
  const retryButton = document.getElementById("retry");
  const copyButton = document.getElementById("copy");
  const closeButton = document.getElementById("close");
  const menuButton = document.getElementById("menu-button");
  const menuEl = document.getElementById("menu");
  const menuVersionEl = document.getElementById("menu-version");
  const menuSettingsButton = document.getElementById("menu-settings");
  const menuHelpButton = document.getElementById("menu-help");
  const helpOverlay = document.getElementById("help-overlay");
  const helpBodyEl = document.getElementById("help-body");
  const helpCloseButton = document.getElementById("help-close");
  const settingsOverlay = document.getElementById("settings-overlay");
  const settingsForm = document.getElementById("settings-form");
  const settingsCloseButton = document.getElementById("settings-close");
  const settingsStatusEl = document.getElementById("settings-status");
  const settingsInfoEl = document.getElementById("settings-info");
  const hotkeyNoteEl = document.getElementById("hotkey-note");
  const hotkeyBindRow = document.getElementById("hotkey-bind-row");
  const hotkeyBindLineEl = document.getElementById("hotkey-bind-line");
  const hotkeyCopyBindButton = document.getElementById("hotkey-copy-bind");
  const vertexStatusEl = document.getElementById("vertex-status");
  const vertexConnectButton = document.getElementById("vertex-connect");
  const vertexDisconnectButton = document.getElementById("vertex-disconnect");
  const rows = {
    endpoint: document.getElementById("row-endpoint"),
    baseUrl: document.getElementById("row-base-url"),
    apiKey: document.getElementById("row-api-key"),
    model: document.getElementById("row-model"),
    vertex: document.getElementById("row-vertex")
  };
  const cfgFields = {
    speechProvider: document.getElementById("cfg-speech-provider"),
    speechEndpoint: document.getElementById("cfg-speech-endpoint"),
    speechBaseUrl: document.getElementById("cfg-speech-base-url"),
    speechApiKey: document.getElementById("cfg-speech-api-key"),
    speechModel: document.getElementById("cfg-speech-model"),
    speechLanguage: document.getElementById("cfg-speech-language"),
    speechSilence: document.getElementById("cfg-speech-silence"),
    speechSendPhrase: document.getElementById("cfg-speech-send-phrase"),
    speechAutoStart: document.getElementById("cfg-speech-auto-start"),
    windowWidth: document.getElementById("cfg-window-width"),
    windowHeight: document.getElementById("cfg-window-height"),
    restoreFocus: document.getElementById("cfg-restore-focus"),
    clipboardBackend: document.getElementById("cfg-clipboard-backend"),
    autoPaste: document.getElementById("cfg-auto-paste"),
    autoPasteDelay: document.getElementById("cfg-auto-paste-delay"),
    pasteKey: document.getElementById("cfg-paste-key"),
    hotkeyEnabled: document.getElementById("cfg-hotkey-enabled"),
    hotkeyAccelerator: document.getElementById("cfg-hotkey-accelerator")
  };

  const helpText = () => [
    t("── 録音 ──"),
    t("Ctrl+Space / ● 録音   録音の開始・停止 (停止すると認識が走る)"),
    t("無音で発話を区切って変換 (録音は継続。Ctrl+Space で停止)"),
    t("録音は最長 5 分。20MB を超えると停止します"),
    t("Ctrl+R / 再認識       保持している録音をもう一度サーバーへ送る"),
    t("Ctrl+D                保持している録音を破棄する"),
    t("設定した合図の言葉を最後に話すと、その語を除いてコピーして閉じる"),
    "",
    t("── 編集 ──"),
    t("認識結果はそのまま編集できます (通常のテキストエリア)"),
    t("Enter                 コピーして閉じる"),
    t("Shift+Enter           改行"),
    t("音声コマンド: 設定したフレーズで ?・改行・!・コピーして閉じる（発話末尾、認識確定時）"),
    t("Ctrl+A / Ctrl+E       行頭 / 行末"),
    t("Ctrl+B / Ctrl+F       1文字左 / 右"),
    t("Ctrl+K / Ctrl+U       行末まで削除 / 行頭まで削除"),
    t("Ctrl+O                全選択"),
    t("Ctrl+C / X / V        コピー / 切り取り / 貼り付け"),
    t("Ctrl+Z                元に戻す (Ctrl+Shift+Z / Ctrl+Y でやり直す)"),
    t("Ctrl+↑ / Ctrl+↓       テキスト履歴を移動 (最大 30 件。Ctrl+↓ で下書きに戻る)"),
    "",
    t("── その他 ──"),
    t("Escape / Ctrl+[       録音中なら中止 / それ以外は閉じる (次回表示時に履歴へ保存)"),
    t("ヘッダーをドラッグ    ウィンドウ移動"),
    t("⋮                     設定 / ヘルプ"),
    t("通知領域のアイコン    左クリックで表示・非表示、右クリックで 設定 / ヘルプ / 終了")
  ].join("\n");

  const HISTORY_LIMIT = 30;
  const idleStatus = () => t("Ctrl+Space: 録音 / Enter: コピーして閉じる");

  let config = null;
  let history = [];
  let historyIndex = -1;
  let historyDraft = "";
  let appInfo = null;
  let engine = null;
  let engineProvider = null;
  let elapsedTimer = null;
  let elapsedStart = 0;
  let stickyStatus = "";
  let meterStream = null;
  // Shown until the user does something else: a hotkey that failed to register
  // is invisible everywhere else, because the daemon has no console.
  let startupWarning = "";
  // True while the current error is something the Settings dialog can fix.
  let configurationError = false;

  const meter = createAudioMeter(meterEl);
  const autoSizer = createAutoSizer(inputEl, {
    getMinimum: () => config?.window?.height ?? 300,
    isOverlayOpen: overlayOpen,
    resize: (height) => appBinding()?.ResizePopup?.(height),
    viewportHeight: () => document.documentElement.clientHeight
  });
  globalThis.window?.addEventListener?.("resize", autoSizer.schedule);
  const editor = createTextEditor(inputEl, () => {
    historyIndex = -1;
    stickyStatus = "";
    refreshStatus();
    autoSizer.schedule();
  });

  // ---- Wails bridge -------------------------------------------------------

  function appBinding() {
    return globalThis.window?.go?.main?.App;
  }

  function waitForWailsRuntime(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        if (appBinding()) {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error("Wails runtime did not appear"));
        } else {
          setTimeout(tick, 30);
        }
      };
      tick();
    });
  }

  // speechTransport routes each request to the Go proxy. Vertex AI goes through
  // its own binding, which is the only place the stored OAuth token is used.
  async function speechTransport(request) {
    const app = appBinding();
    if (!app) throw new Error(t("バックエンドに接続できません。"));
    if (new URL(request.url).hostname === "aiplatform.googleapis.com") {
      return await app.VertexSpeechHTTPRequest(request);
    }
    return await app.SpeechHTTPRequest(request);
  }

  // ---- history ------------------------------------------------------------

  function persistHistory() {
    void appBinding()?.SaveHistory(JSON.stringify(history));
  }

  function addHistory(text) {
    if (!text) return;
    history = history.filter((entry) => entry !== text);
    history.push(text);
    history = history.slice(-HISTORY_LIMIT);
    historyIndex = -1;
    historyDraft = "";
    persistHistory();
  }

  async function captureExternalClipboard() {
    const app = appBinding();
    if (!app) return;
    try {
      const text = await app.ReadClipboard();
      if (text && history[history.length - 1] !== text) addHistory(text);
    } catch {
      // Clipboard reads fail temporarily while another application owns it.
    }
  }

  function showHistory(direction) {
    if (!history.length) return false;
    if (historyIndex === -1) {
      if (direction > 0) return false;
      historyDraft = inputEl.value;
      historyIndex = history.length - 1;
    } else {
      historyIndex += direction;
      if (historyIndex >= history.length) {
        historyIndex = -1;
        setText(historyDraft);
        return true;
      }
      historyIndex = Math.max(0, historyIndex);
    }
    setText(history[historyIndex]);
    return true;
  }

  // ---- text ---------------------------------------------------------------

  function setText(text) {
    const index = historyIndex;
    editor.setText(text);
    historyIndex = index;
  }

  // setError shows the message; offerSettings adds the shortcut to the dialog
  // that fixes it, which is the whole remedy for an unconfigured install.
  function setError(message, offerSettings = false) {
    const text = message || startupWarning;
    errorEl.textContent = text;
    errorSettingsButton.hidden = !text || !(offerSettings || configurationError);
  }

  function setStatus(text, sticky = false) {
    stickyStatus = sticky ? text : "";
    statusEl.textContent = text;
  }

  function refreshStatus() {
    if (stickyStatus) return;
    statusEl.textContent = idleStatus();
  }

  // ---- speech engine ------------------------------------------------------

  function renderSpeechProvider() {
    const speech = config?.speech;
    const names = {
      openai: "OpenAI",
      custom: t("OpenAI 互換"),
      "whisper-cpp": "whisper.cpp",
      "azure-mai-transcribe": "Azure MAI Transcribe",
      "gemini-transcribe": "Gemini",
      "vertex-transcribe": "Vertex AI"
    };
    const name = speech?.provider === "browser"
      ? t("ブラウザ")
      : names[speech?.endpointType] ?? t("未設定");
    speechProviderEl.textContent = t("書き起こし: {0}", name);
  }

  function speechSettings() {
    const speech = config?.speech ?? {};
    return {
      provider: speech.provider ?? "openai-compatible",
      endpointType: speech.endpointType ?? "openai",
      baseUrl: speech.baseUrl ?? "",
      apiKey: speech.apiKey ?? "",
      model: speech.model ?? "",
      language: speech.language ?? "auto",
      silenceSeconds: speech.silenceSeconds ?? 0,
      sendPhrase: initialSendPhrase(speech),
      symbolCommands: speechCommandsFor(speech),
      vertexProjectId: speech.vertexProjectId ?? ""
    };
  }

  // buildEngine picks the recorded or the live-recognition implementation. Both
  // expose the same interface so the UI never branches on the provider again.
  function buildEngine() {
    const provider = speechSettings().provider;
    if (engine && engineProvider === provider) return engine;
    engine?.discard();
    const options = {
      getSettings: speechSettings,
      getBase: editor.speechBase,
      getContext: editor.speechContext,
      getText: () => inputEl.value,
      onInput: (text) => {
        editor.applySpeechPrefix(text);
        historyIndex = -1;
      },
      onSend: (text) => void copyAndClose(text),
      onState: (state) => {
        // Chromium embedders such as WebView2 usually ship no speech backend,
        // so browser recognition fails at the network step. Point at the
        // recorded services rather than repeating the raw error code.
        if (state.error && provider === "browser" && /network|service-not-allowed|not-allowed/.test(state.error)) {
          configurationError = true;
          state = {
            ...state,
            error: t("{0} この WebView にはブラウザ音声認識のバックエンドが無い可能性があります。設定で OpenAI / whisper.cpp / Gemini / Vertex AI を選んでください。", state.error)
          };
        }
        renderEngineState(state);
      },
      transport: speechTransport
    };
    engine = provider === "browser"
      ? createBrowserRecognizer(options)
      : createRecorder(options);
    engineProvider = provider;
    return engine;
  }

  const activityTitles = () => ({
    starting: t("マイクを準備しています"),
    recording: t("録音中"),
    preparing: t("音声を変換しています"),
    transcribing: t("認識しています")
  });

  let lastEngineState = null;

  function renderEngineState(state) {
    lastEngineState = state;
    const ACTIVITY_TITLES = activityTitles();
    const active = state.status !== "idle";
    activityEl.dataset.active = String(active);
    modeEl.textContent = active ? (ACTIVITY_TITLES[state.status] ?? t("処理中")) : t("待機中");
    modeEl.dataset.recording = String(state.status === "recording");
    activityTitleEl.textContent = ACTIVITY_TITLES[state.status] ?? "";
    activityHintEl.textContent = state.status === "recording"
      ? (state.silenceHint || t("Ctrl+Space または ● で停止して認識"))
      : state.status === "starting"
        ? t("Escape で中止")
        : t("Escape で中止 (録音は保持されます)");
    recordButton.textContent = state.status === "recording" ? t("■ 停止") : active ? t("■ 中止") : t("● 録音");
    retryButton.hidden = state.retainedCount === 0 || active;
    if (!state.error) configurationError = false;
    setError(state.error);
    if (active) startElapsed(); else stopElapsed();
    // Re-attaching builds a fresh AudioContext, so only do it when the stream
    // itself changed rather than on every status or hint update.
    if (state.meterStream !== meterStream) {
      meterStream = state.meterStream;
      void meter.attach(meterStream).then((available) => {
        if (!available && meterStream) {
          activityHintEl.textContent = t("レベル取得不可 (録音は継続中)");
        }
      });
    }
    refreshStatus();
  }

  function startElapsed() {
    if (elapsedTimer) return;
    elapsedStart = Date.now();
    activityElapsedEl.textContent = "0:00";
    elapsedTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - elapsedStart) / 1000);
      activityElapsedEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }, 1000);
  }

  function stopElapsed() {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function toggleRecording() {
    if (overlayOpen()) return;
    startupWarning = "";
    configurationError = false;
    setError("");
    setStatus(idleStatus());
    const settings = speechSettings();
    if (settings.provider === "browser") {
      if (!browserSpeechSupported()) {
        configurationError = true;
        setError(t("この WebView はブラウザ音声認識に対応していません。設定で OpenAI / whisper.cpp / Gemini / Vertex AI のいずれかを選んでください。"));
        return;
      }
    } else {
      if (!speechSupported()) {
        setError(t("このウィンドウでは録音を利用できません。"));
        return;
      }
      const missing = missingSetting(settings);
      if (missing) {
        configurationError = true;
        setError(missing);
        return;
      }
    }
    void buildEngine().toggle();
  }

  // missingSetting names the one field that still has to be filled in, so a
  // fresh install says what to do instead of failing at the HTTP request.
  function missingSetting(settings) {
    try {
      validateSpeechSettings(settings);
      return "";
    } catch (caught) {
      return message(caught);
    }
  }

  // ---- copy / close -------------------------------------------------------

  async function copyAndClose(explicitText) {
    const text = (explicitText ?? inputEl.value).trim();
    if (!text) {
      setStatus(t("コピーする内容がありません。"), true);
      return;
    }
    try {
      await appBinding()?.CopyToClipboard(text);
    } catch {
      setStatus(t("コピーに失敗しました。"), true);
      return;
    }
    addHistory(text);
    engine?.discard();
    editor.reset();
    setStatus(t("コピーしました。"), true);
    await hidePopupWindow();
  }

  async function hidePopupWindow() {
    const app = appBinding();
    if (app) await app.HidePopup();
    else window.close();
  }

  function closeWithoutCopy() {
    // Keep the text until the next opening archives it and starts a fresh entry.
    engine?.discard();
    void hidePopupWindow();
  }

  // ---- session ------------------------------------------------------------

  // overlay is "settings" / "help" when the tray menu asked for one; opening a
  // dialog must not also start a recording behind it.
  function onPopupShown(overlay) {
    closeMenuAndOverlays();
    stickyStatus = "";
    setError("");
    refreshStatus();
    addHistory(inputEl.value);
    editor.reset();
    historyIndex = -1;
    historyDraft = "";
    void captureExternalClipboard();
    if (openRequestedOverlay(overlay)) return;
    focusInput();
    if (config?.speech?.autoStart && !engine?.busy()) toggleRecording();
  }

  function openRequestedOverlay(overlay) {
    const mode = Array.isArray(overlay) ? overlay[0] : overlay;
    if (mode === "settings") {
      void openSettings();
      return true;
    }
    if (mode === "help") {
      openHelp();
      return true;
    }
    return false;
  }

  function focusInput() {
    inputEl.focus();
  }

  // ---- menu / overlays ----------------------------------------------------

  function setMenuOpen(open) {
    menuEl.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  }

  function overlayOpen() {
    return helpOverlay.dataset.open === "true" || settingsOverlay.dataset.open === "true";
  }

  function setOverlayOpen(open) {
    void Promise.resolve(appBinding()?.SetOverlayOpen(open)).then(() => {
      if (!open) autoSizer.schedule();
    });
  }

  function openHelp() {
    helpBodyEl.textContent = helpText();
    helpOverlay.dataset.open = "true";
    setOverlayOpen(true);
    helpOverlay.focus();
  }

  function closeHelp() {
    helpOverlay.dataset.open = "false";
    if (!overlayOpen()) setOverlayOpen(false);
    focusInput();
  }

  function closeMenuAndOverlays() {
    setMenuOpen(false);
    helpOverlay.dataset.open = "false";
    settingsOverlay.dataset.open = "false";
    setOverlayOpen(false);
  }

  async function loadAppInfo() {
    try {
      appInfo = await appBinding()?.GetAppInfo();
    } catch {
      appInfo = null;
    }
    menuVersionEl.textContent = appInfo ? `speech-popup ${appInfo.version}` : "speech-popup";
  }

  // ---- settings -----------------------------------------------------------

  let serviceProfiles = {};
  let formEndpoint = "";
  let formVertexProjectId = "";
  let sendPhraseProfiles = {};
  let exclamationPhrases = {};
  let questionPhrases = {};
  let newlinePhrases = {};
  let formPhraseLanguage = "";

  function rememberService() {
    if (!formEndpoint) return;
    serviceProfiles[formEndpoint] = {
      baseUrl: cfgFields.speechBaseUrl.value.trim(),
      apiKey: cfgFields.speechApiKey.value.trim(),
      model: cfgFields.speechModel.value.trim(),
      language: readSpeechLanguage(),
      vertexProjectId: formVertexProjectId
    };
  }

  function fillSettingsForm(view) {
    document.getElementById("cfg-ui-language").value = view.uiLanguage || getLanguage();
    serviceProfiles = structuredClone(view.speech.profiles ?? {});
    formEndpoint = view.speech.endpointType;
    renderSpeechProvider();
    cfgFields.speechProvider.value = view.speech.provider;
    cfgFields.speechEndpoint.value = view.speech.endpointType;
    cfgFields.speechBaseUrl.value = view.speech.baseUrl;
    cfgFields.speechApiKey.value = view.speech.apiKey;
    cfgFields.speechModel.value = view.speech.model;
    renderSpeechLanguages(view.speech.language || "auto");
    cfgFields.speechSilence.value = String(view.speech.silenceSeconds);
    sendPhraseProfiles = structuredClone(view.speech.sendPhraseProfiles ?? {});
    exclamationPhrases = structuredClone(view.speech.exclamationPhrases ?? {});
    questionPhrases = structuredClone(view.speech.questionPhrases ?? {});
    newlinePhrases = structuredClone(view.speech.newlinePhrases ?? {});
    formPhraseLanguage = sendPhraseLanguage(view.speech.language);
    cfgFields.speechSendPhrase.value = initialSendPhrase(view.speech);
    fillSymbolCommands();
    formVertexProjectId = view.speech.vertexProjectId ?? "";
    cfgFields.speechAutoStart.checked = view.speech.autoStart;
    cfgFields.windowWidth.value = String(view.window.width);
    cfgFields.windowHeight.value = String(view.window.height);
    cfgFields.restoreFocus.checked = view.window.restoreFocus;
    cfgFields.clipboardBackend.value = view.clipboard.backend;
    cfgFields.autoPaste.checked = view.clipboard.autoPaste;
    cfgFields.autoPasteDelay.value = String(view.clipboard.autoPasteDelayMs);
    cfgFields.pasteKey.value = view.clipboard.pasteKey;
    cfgFields.hotkeyEnabled.checked = view.hotkey.enabled;
    cfgFields.hotkeyAccelerator.value = view.hotkey.accelerator;
    updateSpeechFieldVisibility();
    updateHotkeyGuidance();
  }

  function readSpeechLanguage() {
    return cfgFields.speechLanguage.value === "custom"
      ? document.getElementById("cfg-speech-language-custom").value.trim()
      : cfgFields.speechLanguage.value || "auto";
  }

  function updateCustomSpeechLanguage() {
    const custom = cfgFields.speechLanguage.value === "custom";
    const input = document.getElementById("cfg-speech-language-custom");
    document.getElementById("speech-language-custom-row").hidden = !custom;
    input.disabled = !custom;
    input.required = custom;
  }

  function renderSpeechLanguages(current = readSpeechLanguage()) {
    const custom = cfgFields.speechLanguage.value === "custom";
    const options = speechLanguageOptions(
      cfgFields.speechProvider.value, cfgFields.speechEndpoint.value,
      cfgFields.speechModel.value, current
    );
    cfgFields.speechLanguage.replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
    cfgFields.speechLanguage.value = current || "auto";
    if (!current && custom) cfgFields.speechLanguage.value = "custom";
    updateCustomSpeechLanguage();
    document.getElementById("speech-language-note").textContent =
      cfgFields.speechProvider.value === "browser" || ["custom", "whisper-cpp"].includes(cfgFields.speechEndpoint.value)
        ? t("利用できる言語は接続先やモデルに依存します。一覧にない言語は「その他」で指定できます。")
        : t("言語はサービスごとに保存されます。一覧にない言語は「その他」で指定できます。");
  }

  function fillSymbolCommands() {
    const defaults = defaultSpeechCommands(formPhraseLanguage);
    document.getElementById("cfg-exclamation-phrases").value = exclamationPhrases[formPhraseLanguage] ?? defaults.exclamation;
    document.getElementById("cfg-question-phrases").value = questionPhrases[formPhraseLanguage] ?? defaults.question;
    document.getElementById("cfg-newline-phrases").value = newlinePhrases[formPhraseLanguage] ?? defaults.newline;
  }

  function switchSendPhraseLanguage() {
    if (formPhraseLanguage) {
      sendPhraseProfiles[formPhraseLanguage] = cfgFields.speechSendPhrase.value;
      exclamationPhrases[formPhraseLanguage] = document.getElementById("cfg-exclamation-phrases").value;
      questionPhrases[formPhraseLanguage] = document.getElementById("cfg-question-phrases").value;
      newlinePhrases[formPhraseLanguage] = document.getElementById("cfg-newline-phrases").value;
    }
    formPhraseLanguage = sendPhraseLanguage(readSpeechLanguage());
    cfgFields.speechSendPhrase.value = sendPhraseProfiles[formPhraseLanguage] ?? defaultSendPhrase(formPhraseLanguage);
    fillSymbolCommands();
  }

  function readSettingsForm() {
    rememberService();
    switchSendPhraseLanguage();
    return {
      uiLanguage: document.getElementById("cfg-ui-language").value,
      speech: {
        profiles: structuredClone(serviceProfiles),
        provider: cfgFields.speechProvider.value,
        endpointType: cfgFields.speechEndpoint.value,
        baseUrl: cfgFields.speechBaseUrl.value.trim(),
        apiKey: cfgFields.speechApiKey.value.trim(),
        model: cfgFields.speechModel.value.trim(),
        language: readSpeechLanguage(),
        silenceSeconds: Number(cfgFields.speechSilence.value),
        sendPhrase: cfgFields.speechSendPhrase.value,
        sendPhraseProfiles: structuredClone(sendPhraseProfiles),
        exclamationPhrases: structuredClone(exclamationPhrases),
        questionPhrases: structuredClone(questionPhrases),
        newlinePhrases: structuredClone(newlinePhrases),
        vertexProjectId: formVertexProjectId,
        autoStart: cfgFields.speechAutoStart.checked
      },
      window: {
        width: Number(cfgFields.windowWidth.value),
        height: Number(cfgFields.windowHeight.value),
        restoreFocus: cfgFields.restoreFocus.checked
      },
      clipboard: {
        backend: cfgFields.clipboardBackend.value,
        autoPaste: cfgFields.autoPaste.checked,
        autoPasteDelayMs: Number(cfgFields.autoPasteDelay.value),
        pasteKey: cfgFields.pasteKey.value
      },
      hotkey: {
        enabled: cfgFields.hotkeyEnabled.checked,
        accelerator: cfgFields.hotkeyAccelerator.value.trim()
      }
    };
  }

  // Only the fields the selected service actually uses stay visible, so a
  // stale Base URL or key cannot look as if it applies to Gemini or Vertex.
  function updateSpeechFieldVisibility() {
    renderSpeechLanguages();
    const browser = cfgFields.speechProvider.value === "browser";
    const endpointType = cfgFields.speechEndpoint.value;
    const google = isGoogleEndpoint(endpointType);
    cfgFields.speechBaseUrl.placeholder = endpointType === "azure-mai-transcribe"
      ? "https://your-resource.cognitiveservices.azure.com" : "https://api.openai.com/v1";
    cfgFields.speechApiKey.placeholder = endpointType === "azure-mai-transcribe" ? "Azure Speech API Key" : "sk-...";
    rows.endpoint.hidden = browser;
    rows.baseUrl.hidden = browser || google;
    rows.apiKey.hidden = browser || endpointType === "whisper-cpp" || endpointType === "vertex-transcribe";
    rows.model.hidden = browser || google || endpointType === "whisper-cpp";
    rows.vertex.hidden = browser || endpointType !== "vertex-transcribe";
    if (!rows.vertex.hidden) void refreshVertexStatus();
  }

  function applyEndpointPreset() {
    rememberService();
    formEndpoint = cfgFields.speechEndpoint.value;
    const preset = serviceProfiles[formEndpoint] ?? endpointPreset(formEndpoint);
    cfgFields.speechBaseUrl.value = preset.baseUrl;
    cfgFields.speechModel.value = preset.model;
    cfgFields.speechApiKey.value = preset.apiKey ?? "";
    renderSpeechLanguages(preset.language ?? "auto");
    switchSendPhraseLanguage();
    formVertexProjectId = preset.vertexProjectId ?? "";
    updateSpeechFieldVisibility();
  }

  async function refreshVertexStatus() {
    try {
      const status = await appBinding()?.GetVertexOAuthStatus();
      vertexStatusEl.textContent = status?.connected
        ? t("接続済み ({0})", status.clientId ?? "")
        : t("未接続");
    } catch (caught) {
      vertexStatusEl.textContent = t("状態を取得できません: {0}", message(caught));
    }
  }

  async function connectVertex() {
    setSettingsStatus(t("OAuth クライアント JSON を選択してください…"));
    try {
      const client = await appBinding()?.SelectVertexOAuthClient();
      if (!client?.clientId) {
        setSettingsStatus("");
        return;
      }
      const projectId = client.projectId?.trim();
      if (!projectId) throw new Error(t("OAuth クライアント JSON に project_id がありません。Google Cloud から JSON を再ダウンロードしてください。"));
      setSettingsStatus(t("ブラウザで Google の認可を完了してください…"));
      await appBinding()?.ConnectVertexOAuth(client.clientId, client.clientSecret ?? "", projectId);
      formVertexProjectId = projectId;
      setSettingsStatus(t("Google に接続しました。"));
    } catch (caught) {
      setSettingsStatus(message(caught), true);
    }
    await refreshVertexStatus();
  }

  function hyprlandBindLine(accelerator) {
    const parts = accelerator.split("+").filter(Boolean);
    if (parts.length < 2) return "";
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map((m) => {
      const lower = m.toLowerCase();
      return lower === "ctrl" || lower === "control" ? "CTRL"
        : lower === "shift" ? "SHIFT"
          : lower === "alt" ? "ALT"
            : "SUPER";
    }).join(" ");
    return `bind = ${mods}, ${key.toUpperCase()}, exec, speech-popup show`;
  }

  function updateHotkeyGuidance() {
    const os = appInfo?.os ?? "";
    const accelerator = cfgFields.hotkeyAccelerator.value.trim();
    if (os === "windows") {
      hotkeyNoteEl.textContent = t("Windows ではアプリがホットキーを登録します。");
      hotkeyBindRow.hidden = true;
      return;
    }
    if (os === "darwin") {
      hotkeyNoteEl.textContent = t("macOS では OS 側のショートカット機能から `speech-popup show` を呼び出してください (Shortcuts.app など)。");
      hotkeyBindRow.hidden = true;
      return;
    }
    hotkeyNoteEl.textContent = t("Linux ではキー登録はコンポジタ側の仕事です。下の bind 行を hyprland.conf に追加してください。");
    const line = hyprlandBindLine(accelerator);
    hotkeyBindRow.hidden = !line;
    hotkeyBindLineEl.textContent = line;
  }

  function setSettingsStatus(text, isError = false) {
    settingsStatusEl.textContent = text;
    settingsStatusEl.dataset.error = String(isError);
  }

  function renderSettingsInfo() {
    if (!appInfo) {
      settingsInfoEl.textContent = "";
      return;
    }
    settingsInfoEl.textContent = [
      `version: ${appInfo.version}`,
      `os: ${appInfo.os}`,
      `config: ${appInfo.configPath}`,
      `data: ${appInfo.dataDir}`,
      `log: ${appInfo.logPath}`,
      t("ホットキー: {0}", hotkeyStateLabel()),
      t("録音: {0}", speechSupported() ? t("利用可能") : t("利用不可")),
      t("ブラウザ音声認識: {0}", browserSpeechSupported() ? t("利用可能") : t("利用不可"))
    ].join("\n");
  }

  function hotkeyStateLabel() {
    if (!appInfo?.hotkeyEnabled) return t("アプリ内登録は無効 (OS 側で `speech-popup show` に割り当ててください)");
    if (appInfo.hotkeyActive) return t("{0} を登録済み", appInfo.hotkeyKey);
    return t("{0} の登録に失敗 — {1}", appInfo.hotkeyKey, appInfo.hotkeyError);
  }

  async function openSettings() {
    setMenuOpen(false);
    settingsOverlay.dataset.open = "true";
    setOverlayOpen(true);
    engine?.stop();
    try {
      config = await appBinding()?.LoadConfig();
    } catch (caught) {
      setSettingsStatus(message(caught), true);
    }
    if (config) fillSettingsForm(config);
    setSettingsStatus("");
    renderSettingsInfo();
    cfgFields.speechProvider.focus();
  }

  function closeSettings() {
    settingsOverlay.dataset.open = "false";
    if (!overlayOpen()) setOverlayOpen(false);
    focusInput();
  }

  async function applyUILanguage(language) {
    setLanguage(language || getLanguage());
    localizeDOM(document);
    await appBinding()?.SetUILanguage?.(getLanguage());
    helpBodyEl.textContent = helpText();
    if (lastEngineState) renderEngineState(lastEngineState);
    renderSpeechProvider();
    updateHotkeyGuidance();
    updateSpeechFieldVisibility();
    renderSettingsInfo();
  }

  async function saveSettings() {
    try {
      const view = readSettingsForm();
      const phrases = [
        document.getElementById("cfg-exclamation-phrases").value,
        document.getElementById("cfg-question-phrases").value,
        document.getElementById("cfg-newline-phrases").value,
        cfgFields.speechSendPhrase.value
      ].map(value => new Set(splitCommandPhrases(value).map(phrase => phrase.toLowerCase())));
      if (phrases.some((group, index) => phrases.slice(index + 1).some(other => [...group].some(phrase => other.has(phrase))))) {
        throw new Error(t("同じフレーズを複数の動作に設定することはできません。"));
      }
      const result = await appBinding()?.SaveConfig(view);
      config = await appBinding()?.LoadConfig();
      await applyUILanguage(config?.uiLanguage || view.uiLanguage);
      // HTTP engines read settings for every retry, so changing credentials
      // or endpoints must leave the retained recording available.
      if (engine && engineProvider !== speechSettings().provider) {
        engine.discard();
        engine = null;
        engineProvider = null;
      }
      renderSpeechProvider();
      await loadAppInfo();
      startupWarning = appInfo?.hotkeyError ?? "";
      renderSettingsInfo();
      setSettingsStatus(result?.warning ? t("保存しました。{0}", result.warning) : t("保存しました。"), !!result?.warning);
    } catch (caught) {
      setSettingsStatus(message(caught), true);
    }
  }

  function message(caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }

  // ---- events -------------------------------------------------------------

  menuButton.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenuOpen(menuEl.hidden);
  });

  document.addEventListener("click", (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target) && e.target !== menuButton) setMenuOpen(false);
  });

  menuSettingsButton.addEventListener("click", () => void openSettings());
  menuHelpButton.addEventListener("click", () => {
    setMenuOpen(false);
    openHelp();
  });
  menuEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      focusInput();
    }
  });

  helpCloseButton.addEventListener("click", closeHelp);
  helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) closeHelp();
  });
  helpOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      closeHelp();
    }
  });

  settingsCloseButton.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  settingsOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      closeSettings();
    }
  });
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveSettings();
  });
  cfgFields.speechProvider.addEventListener("change", updateSpeechFieldVisibility);
  cfgFields.speechEndpoint.addEventListener("change", applyEndpointPreset);
  cfgFields.speechModel.addEventListener("change", () => renderSpeechLanguages());
  cfgFields.speechLanguage.addEventListener("change", () => {
    updateCustomSpeechLanguage();
    if (cfgFields.speechLanguage.value === "custom") document.getElementById("cfg-speech-language-custom").focus();
    else switchSendPhraseLanguage();
  });
  document.getElementById("cfg-speech-language-custom").addEventListener("change", switchSendPhraseLanguage);
  document.getElementById("speech-symbols-reset").addEventListener("click", () => {
    const defaults = defaultSpeechCommands(readSpeechLanguage());
    document.getElementById("cfg-exclamation-phrases").value = defaults.exclamation;
    document.getElementById("cfg-question-phrases").value = defaults.question;
    document.getElementById("cfg-newline-phrases").value = defaults.newline;
  });
  document.getElementById("speech-send-phrase-reset").addEventListener("click", () => {
    cfgFields.speechSendPhrase.value = defaultSendPhrase(readSpeechLanguage());
  });
  cfgFields.hotkeyAccelerator.addEventListener("input", updateHotkeyGuidance);
  hotkeyCopyBindButton.addEventListener("click", () => {
    const line = hotkeyBindLineEl.textContent;
    if (line) void appBinding()?.CopyToClipboard(line);
  });
  vertexConnectButton.addEventListener("click", () => void connectVertex());
  vertexDisconnectButton.addEventListener("click", async () => {
    try {
      await appBinding()?.DisconnectVertexOAuth();
      setSettingsStatus(t("Google の接続を解除しました。"));
    } catch (caught) {
      setSettingsStatus(message(caught), true);
    }
    await refreshVertexStatus();
  });

  modeEl.addEventListener("click", toggleRecording);
  modeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRecording();
    }
  });
  recordButton.addEventListener("click", () => {
    toggleRecording();
    focusInput();
  });
  retryButton.addEventListener("click", () => {
    setError("");
    void buildEngine().retry();
  });
  errorSettingsButton.addEventListener("click", () => void openSettings());
  copyButton.addEventListener("click", () => void copyAndClose());
  closeButton.addEventListener("click", closeWithoutCopy);

  inputEl.addEventListener("keydown", handleKeydown);

  function handleKeydown(e) {
    if (e.isComposing) return;
    if (editor.handleKeydown(e)) return;
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      if (engine?.busy()) {
        engine.stop();
        setStatus(t("録音を中止しました。"), true);
      } else {
        closeWithoutCopy();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      void copyAndClose();
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === "Space" || e.key === " ")) {
      e.preventDefault();
      toggleRecording();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      setError("");
      void buildEngine().retry();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      engine?.discard();
      setStatus(t("保持していた録音を破棄しました。"), true);
      return;
    }
    if (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (showHistory(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
    }
  }

  // ---- boot ---------------------------------------------------------------

  async function boot() {
    localizeDOM(document);
    setStatus(idleStatus());
    try {
      await waitForWailsRuntime();
    } catch {
      setError(t("バックエンドに接続できません。"));
      return;
    }
    const app = appBinding();
    await app.SetUILanguage?.(getLanguage());
    try {
      config = await app.LoadConfig();
      await applyUILanguage(config?.uiLanguage);
    } catch (caught) {
      setError(t("設定を読み込めません: {0}", message(caught)));
    }
    renderSpeechProvider();
    try {
      const raw = await app.LoadHistory();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed.filter((entry) => typeof entry === "string").slice(-HISTORY_LIMIT);
    } catch {
      history = [];
    }
    await loadAppInfo();
    if (appInfo?.hotkeyError) startupWarning = appInfo.hotkeyError;
    if (config) fillSettingsForm(config);
    renderEngineState({ status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null });
    await app.NotifyReady();
  }

  globalThis.window?.runtime?.EventsOn?.("popup:shown", onPopupShown);
  globalThis.window?.runtime?.EventsOn?.("popup:focus-input", (overlay) => {
    if (openRequestedOverlay(overlay)) return;
    if (overlayOpen()) return;
    focusInput();
    if (config?.speech?.autoStart && !engine?.busy()) toggleRecording();
  });
  globalThis.window?.runtime?.EventsOn?.("popup:hidden", () => {
    // Never hold the microphone open behind a hidden window.
    engine?.stop();
  });

  void boot();
})();
