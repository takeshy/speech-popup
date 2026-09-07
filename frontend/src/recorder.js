// Record-then-transcribe driver, ported from gemihub-desktop's
// src/llm/useRecordedSpeech.ts with the React hook turned into a plain object.
//
// The recorder keeps every captured clip until a transcription succeeds, so a
// network failure can be retried without asking the user to speak again.

import { recordingsToWav, speechDraft, transcribeSpeech, validateSpeechSettings } from "./speech.js";
import { watchSpeechSilence } from "./silence.js";

const MAX_RECORDING_MS = 5 * 60 * 1000;
const MAX_RECORDING_BYTES = 20 * 1024 * 1024;

export function speechSupported() {
  return !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof OfflineAudioContext !== "undefined";
}

// createRecorder wires the microphone to the STT transport.
//   getSettings() -> the speech settings in effect right now
//   getBase()     -> the text already in the box, which the transcript extends
//   onInput(text) -> replace the box contents
//   onSend(text)  -> the user spoke a send phrase: copy & close
//   onState(s)    -> status/error/meter updates for the UI
//   transport(request) -> the Go HTTP proxy
export function createRecorder({ getSettings, getBase, onInput, onSend, onState, transport }) {
  let active = null;
  let retained = { clips: [], durationMs: 0 };
  const state = {
    status: "idle",
    error: "",
    silenceHint: "",
    retainedCount: 0,
    meterStream: null
  };

  function publish(changes) {
    Object.assign(state, changes);
    onState({ ...state });
  }

  function stop(preserve = true) {
    const current = active;
    active = null;
    if (current) {
      current.controller.abort();
      clearTimeout(current.timer);
      current.stopSilence?.();
      if (current.recorder) {
        current.recorder.onstop = null;
        current.recorder.ondataavailable = null;
        current.recorder.onerror = null;
        if (current.recorder.state !== "inactive") current.recorder.stop();
      }
      current.stream?.getTracks().forEach((track) => track.stop());
    }
    if (!preserve) retained = { clips: [], durationMs: 0 };
    publish({
      status: "idle",
      meterStream: null,
      silenceHint: "",
      retainedCount: retained.clips.length
    });
  }

  function finishRecording(current) {
    if (active !== current || current.recorder?.state !== "recording") return;
    clearTimeout(current.timer);
    current.stopSilence?.();
    current.recorder.stop();
    current.stream?.getTracks().forEach((track) => track.stop());
    publish({ status: "preparing", meterStream: null, silenceHint: "" });
  }

  async function transcribeRetained(current, settings) {
    publish({ status: "preparing", meterStream: null });
    try {
      const wav = await recordingsToWav(retained.clips, current.controller.signal);
      current.controller.signal.throwIfAborted();
      publish({ status: "transcribing" });
      // Vertex uses the stored OAuth token; every other service authenticates
      // with the API key inside the request the transport forwards.
      const transcript = await transcribeSpeech(wav, settings, transport, current.controller.signal);
      if (active !== current) return;
      if (!transcript) throw new Error("音声を認識できませんでした。もう一度お試しください。");
      // The send phrase is only evaluated once the whole recording is in.
      const draft = speechDraft(getBase(), transcript, true, settings.sendPhrase);
      stop(false);
      onInput(draft.text);
      if (draft.send && draft.text.trim()) onSend(draft.text);
    } catch (caught) {
      if (active === current) {
        publish({ error: `音声認識に失敗しました: ${errorMessage(caught)}` });
        stop();
      }
    }
  }

  async function retry() {
    if (active || !retained.clips.length) return;
    const current = { controller: new AbortController(), captured: true };
    active = current;
    publish({ error: "" });
    await transcribeRetained(current, { ...getSettings() });
  }

  async function toggle() {
    const previous = active;
    if (previous) {
      if (previous.recorder?.state === "recording") {
        finishRecording(previous);
      } else if (previous.recorder && !previous.captured) {
        // Let the final dataavailable/stop events retain the last chunk before
        // the session is dropped.
        previous.cancelAfterStop = true;
      } else {
        stop();
      }
      return;
    }
    publish({ error: "" });
    if (retained.durationMs >= MAX_RECORDING_MS - 1000) {
      publish({ error: "保持している録音が5分に達しました。認識するか破棄してください。" });
      return;
    }
    if (!speechSupported()) {
      publish({ error: "このウィンドウでは録音を利用できません。" });
      return;
    }
    const settings = { ...getSettings() };
    const current = { controller: new AbortController() };
    active = current;
    publish({ status: "starting" });
    try {
      validateSpeechSettings(settings);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active !== current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      publish({ meterStream: stream });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      current.recorder = recorder;
      const chunks = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        size += event.data.size;
        if (size > MAX_RECORDING_BYTES) {
          publish({ error: "録音サイズの上限 (20MB) を超えました。" });
          stop();
        } else if (event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        publish({ error: "録音中にエラーが発生しました。" });
        stop();
      };
      recorder.onstop = async () => {
        clearTimeout(current.timer);
        current.stopSilence?.();
        publish({ silenceHint: "" });
        stream.getTracks().forEach((track) => track.stop());
        if (active !== current) return;
        const clip = new Blob(chunks, { type: recorder.mimeType });
        chunks.length = 0;
        current.captured = true;
        if (clip.size) {
          retained = {
            clips: [...retained.clips, clip],
            durationMs: retained.durationMs + (performance.now() - (current.startedAt ?? performance.now()))
          };
          publish({ retainedCount: retained.clips.length });
        }
        if (current.cancelAfterStop) {
          stop();
          return;
        }
        await transcribeRetained(current, settings);
      };
      recorder.start(1000);
      current.startedAt = performance.now();
      publish({ status: "recording" });
      if (settings.silenceSeconds > 0) {
        current.stopSilence = watchSpeechSilence(
          stream,
          settings.silenceSeconds,
          () => finishRecording(current),
          (available) => {
            if (active !== current) return;
            publish({
              silenceHint: available
                ? `無音 ${settings.silenceSeconds} 秒で自動停止します`
                : "無音の自動停止は利用できません"
            });
          }
        );
      }
      current.timer = setTimeout(
        () => finishRecording(current),
        Math.max(1000, MAX_RECORDING_MS - retained.durationMs)
      );
    } catch (caught) {
      if (active === current) {
        stop();
        publish({ error: `録音を開始できません: ${errorMessage(caught)}` });
      }
    }
  }

  return {
    toggle,
    retry,
    stop: (preserve = true) => stop(preserve),
    discard: () => stop(false),
    state: () => ({ ...state }),
    recording: () => state.status === "recording",
    busy: () => state.status !== "idle"
  };
}

function errorMessage(caught) {
  if (caught instanceof Error) {
    // getUserMedia rejects with a DOMException whose message is often empty.
    if (caught.name === "NotAllowedError") return "マイクの使用が許可されていません。";
    if (caught.name === "NotFoundError") return "マイクが見つかりません。";
    if (caught.name === "AbortError") return "中断されました。";
    return caught.message || caught.name;
  }
  return String(caught);
}
