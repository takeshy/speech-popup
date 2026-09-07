import { t } from "./i18n.js";
// Live dictation through the WebView's own SpeechRecognition, ported from
// gemihub-desktop's src/llm/useChatSpeech.ts.
//
// Availability depends entirely on the embedded browser engine: WebKitGTK and
// WebView2 ship no recognizer, so this path reports "unsupported" there and the
// user should pick one of the recorded providers instead.

import { speechDraft, convertSpokenSymbol } from "./speech.js";
import { watchSpeechSilence } from "./silence.js";

export function browserSpeechSupported() {
  return !!(globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition);
}

export function createBrowserRecognizer({ getSettings, getBase, onInput, onSend, onState }) {
  let recognition = null;
  let meter = null;
  let stopSilence = null;
  const state = { status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null };

  function publish(changes) {
    Object.assign(state, changes);
    onState({ ...state });
  }

  function stop() {
    const current = recognition;
    recognition = null;
    stopSilence?.();
    stopSilence = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      current.onspeechstart = null;
      current.abort();
    }
    meter?.getTracks().forEach((track) => track.stop());
    meter = null;
    publish({ status: "idle", meterStream: null });
  }

  function toggle() {
    if (recognition) {
      stop();
      return;
    }
    publish({ error: "" });
    const Constructor = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    if (!Constructor) {
      publish({ error: t("このウィンドウはブラウザ音声認識に対応していません。設定で別のサービスを選んでください。") });
      return;
    }
    const settings = { ...getSettings() };
    let base = getBase();
    let lastRendered = base;
    try {
      const current = new Constructor();
      recognition = current;
      const language = settings.language.trim();
      current.lang = !language || language.toLowerCase() === "auto"
        ? navigator.language || "ja-JP"
        : language === "ja" ? "ja-JP" : language === "en" ? "en-US" : language;
      current.continuous = true;
      current.interimResults = true;
      let results = [];
      let consumed = 0;
      let quiet = false;
      const settled = new Set();
      const preserveEdits = () => {
        const edited = getBase();
        if (edited === lastRendered) return;
        base = edited;
        lastRendered = edited;
        // The user now owns all text already displayed, including interim
        // hypotheses. Ignore later revisions of those results; only a new
        // recognition segment may append text after the edit.
        consumed = Math.max(consumed, results.length);
      };
      const render = () => {
        if (recognition !== current) return;
        preserveEdits();
        if (quiet) results.forEach((result, index) => { if (result.isFinal) settled.add(index); });
        const pending = results.slice(consumed);
        const transcript = pending.map((result, index) => result.isFinal
          ? convertSpokenSymbol(result[0].transcript, settled.has(index + consumed)) : result[0].transcript).join("");
        // Only a final trailing command sends; interim hypotheses may change.
        const draft = speechDraft(
          base,
          transcript,
          pending.length > 0 && pending.every((result) => result.isFinal),
          settings.sendPhrase,
          false,
          true // Each final segment is normalized once; preserve explicit 。.
        );
        if (draft.text !== lastRendered) {
          lastRendered = draft.text;
          onInput(draft.text);
        }
        if (draft.send) {
          stop();
          if (draft.text.trim()) onSend(draft.text);
        }
      };
      const watchSilence = () => {
        stopSilence?.();
        if (!meter || settings.silenceSeconds <= 0) return;
        stopSilence = watchSpeechSilence(meter, settings.silenceSeconds, () => {
          quiet = true;
          render();
        }, () => {});
      };
      current.onspeechstart = () => {
        if (recognition !== current) return;
        quiet = false;
        watchSilence();
      };
      current.onresult = (event) => {
        if (recognition !== current) return;
        preserveEdits();
        results = Array.from(event.results);
        render();
      };
      current.onerror = (event) => {
        const messages = {
          "not-allowed": t("マイクの使用が許可されていません。"),
          "service-not-allowed": t("音声認識サービスが利用できません。"),
          "audio-capture": t("マイクを取得できませんでした。"),
          network: t("ネットワークエラーが発生しました。"),
          "no-speech": t("音声が検出されませんでした。")
        };
        publish({ error: t("音声認識に失敗しました: {0} ({1})", messages[event.error] ?? event.error, event.error) });
        stop();
      };
      current.onend = stop;
      publish({ status: "recording" });
      current.start();
      // Metering is optional: a failure here must not disable recognition.
      void navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
        if (recognition !== current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        meter = stream;
        watchSilence();
        publish({ meterStream: stream });
      }).catch(() => {});
    } catch (caught) {
      stop();
      publish({ error: t("音声認識を開始できません: {0}", caught instanceof Error ? caught.message : String(caught)) });
    }
  }

  return {
    toggle,
    retry: () => {},
    stop,
    discard: stop,
    state: () => ({ ...state }),
    recording: () => state.status === "recording",
    busy: () => state.status !== "idle"
  };
}
