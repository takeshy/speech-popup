// Live dictation through the WebView's own SpeechRecognition, ported from
// gemihub-desktop's src/llm/useChatSpeech.ts.
//
// Availability depends entirely on the embedded browser engine: WebKitGTK and
// WebView2 ship no recognizer, so this path reports "unsupported" there and the
// user should pick one of the recorded providers instead.

import { speechDraft } from "./speech.js";

export function browserSpeechSupported() {
  return !!(globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition);
}

export function createBrowserRecognizer({ getSettings, getBase, onInput, onSend, onState }) {
  let recognition = null;
  let meter = null;
  const state = { status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null };

  function publish(changes) {
    Object.assign(state, changes);
    onState({ ...state });
  }

  function stop() {
    const current = recognition;
    recognition = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
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
      publish({ error: "このウィンドウはブラウザ音声認識に対応していません。設定で別のサービスを選んでください。" });
      return;
    }
    const settings = { ...getSettings() };
    const base = getBase();
    try {
      const current = new Constructor();
      recognition = current;
      const language = settings.language.trim();
      current.lang = !language || language.toLowerCase() === "auto"
        ? navigator.language || "ja-JP"
        : language === "ja" ? "ja-JP" : language === "en" ? "en-US" : language;
      current.continuous = true;
      current.interimResults = true;
      current.onresult = (event) => {
        if (recognition !== current) return;
        const results = Array.from(event.results);
        const transcript = results.map((result) => result[0].transcript).join("");
        // Only a final trailing command sends; interim hypotheses may change.
        const draft = speechDraft(
          base,
          transcript,
          results.length > 0 && results.every((result) => result.isFinal),
          settings.sendPhrase
        );
        onInput(draft.text);
        if (draft.send) {
          stop();
          if (draft.text.trim()) onSend(draft.text);
        }
      };
      current.onerror = (event) => {
        const messages = {
          "not-allowed": "マイクの使用が許可されていません。",
          "service-not-allowed": "音声認識サービスが利用できません。",
          "audio-capture": "マイクを取得できませんでした。",
          network: "ネットワークエラーが発生しました。",
          "no-speech": "音声が検出されませんでした。"
        };
        publish({ error: `音声認識に失敗しました: ${messages[event.error] ?? event.error} (${event.error})` });
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
        publish({ meterStream: stream });
      }).catch(() => {});
    } catch (caught) {
      stop();
      publish({ error: `音声認識を開始できません: ${caught instanceof Error ? caught.message : String(caught)}` });
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
