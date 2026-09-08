import { t } from "./i18n.js";
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
//   getBase()     -> the prefix before the insertion point
//   onInput(text) -> update that prefix, preserving the suffix
//   getText()     -> the complete editor contents, for copy & close
//   onSend(text)  -> the user spoke a send phrase: copy & close
//   onState(s)    -> status/error/meter updates for the UI
//   transport(request) -> the Go HTTP proxy
export function createRecorder({ getSettings, getBase, getText, onInput, onSend, onState, transport, now = () => performance.now() }) {
  let active = null;
  // Complete, independently decodable chunks, kept in order until accepted.
  let retained = [];
  const state = { status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null };
  const retainedDuration = () => retained.reduce((sum, chunk) => sum + chunk.durationMs, 0);

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
      for (const recorder of current.recorders) {
        recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      current.stream?.getTracks().forEach(track => track.stop());
    }
    if (current?.startedAt !== undefined && now() - current.startedAt <= 2000) {
      retained = retained.filter(chunk => chunk.sessionId !== current.id);
    }
    if (!preserve) retained = [];
    publish({ status: "idle", meterStream: null, silenceHint: "", retainedCount: retained.length });
  }

  async function drain(current) {
    if (current.processing || active !== current) return;
    current.processing = true;
    try {
      // A short automatic segment must not escape before the user has had
      // two seconds to cancel an accidentally started recording.
      const delay = 2001 - (now() - current.startedAt);
      if (delay > 0) {
        await new Promise((resolve, reject) => {
          const signal = current.controller.signal;
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, delay);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      while (retained.length && active === current) {
        const chunk = retained[0];
        if (current.ending) publish({ status: "preparing", meterStream: null });
        const wav = await recordingsToWav([chunk.clip], current.controller.signal);
        current.controller.signal.throwIfAborted();
        if (current.ending) publish({ status: "transcribing" });
        const transcript = await transcribeSpeech(wav, current.settings, transport, current.controller.signal);
        if (active !== current) return;
        if (!transcript) throw new Error(t("音声を認識できませんでした。もう一度お試しください。"));
        const draft = speechDraft(getBase(), transcript, true, current.settings.sendPhrase, chunk.afterSilence, false, current.settings.symbolCommands);
        retained.shift();
        publish({ retainedCount: retained.length });
        onInput(draft.text);
        const text = getText?.() ?? draft.text;
        if (draft.send && text.trim()) {
          stop(false);
          onSend(text);
          return;
        }
      }
    } catch (caught) {
      if (active === current) {
        publish({ error: t("音声認識に失敗しました: {0}", errorMessage(caught)) });
        // Also retain the speech captured while the failed request was running.
        current.cancelAfterStop = true;
        if (current.recorder?.state === "recording") finishRecording(current);
        else if (!current.pendingCaptures) stop();
      }
    } finally {
      current.processing = false;
      if (active === current && current.ending && !current.pendingCaptures && !retained.length) stop(false);
    }
  }

  function finishRecording(current, afterSilence = false) {
    if (active !== current || current.recorder?.state !== "recording") return;
    if (!afterSilence && now() - current.startedAt <= 2000) {
      stop();
      return;
    }
    const recorder = current.recorder;
    recorder.afterSilence = afterSilence;
    current.stopSilence?.();
    if (!afterSilence) {
      current.ending = true;
      clearTimeout(current.timer);
    }
    recorder.stop();
    if (afterSilence) {
      // Rotate the audio container, not the microphone or recording session.
      // The next chunk records while earlier chunks are transcribed in order.
      startChunk(current, true);
    } else {
      current.stream.getTracks().forEach(track => track.stop());
      publish({ status: "preparing", meterStream: null, silenceHint: "" });
    }
  }

  function startChunk(current, followsSilence = false) {
    const recorder = new MediaRecorder(current.stream, current.mimeType ? { mimeType: current.mimeType } : undefined);
    current.recorder = recorder;
    current.recorders.add(recorder);
    current.pendingCaptures++;
    const chunks = [];
    let size = 0;
    let heardVoice = false;
    let silenceAvailable = false;
    const startedAt = now();
    recorder.ondataavailable = event => {
      if (active !== current) return;
      size += event.data.size;
      const queuedBytes = retained.reduce((sum, chunk) => sum + chunk.clip.size, 0);
      if (size + queuedBytes > MAX_RECORDING_BYTES) {
        publish({ error: t("録音サイズの上限 (20MB) を超えました。") });
        stop();
      } else if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      publish({ error: t("録音中にエラーが発生しました。") });
      stop();
    };
    recorder.onstop = async () => {
      current.recorders.delete(recorder);
      current.pendingCaptures--;
      if (active !== current) return;
      const clip = new Blob(chunks, { type: recorder.mimeType });
      // Do not submit the silent tail when the user stops after a pause.
      if (clip.size && !(followsSilence && silenceAvailable && !heardVoice)) {
        retained.push({ clip, sessionId: current.id, durationMs: now() - startedAt, afterSilence: recorder.afterSilence === true });
      }
      publish({ retainedCount: retained.length });
      if (current.cancelAfterStop) {
        if (!current.pendingCaptures) stop();
        return;
      }
      await drain(current);
    };
    current.startedAt ??= now();
    recorder.start(1000);
    if (current.settings.silenceSeconds > 0) {
      current.stopSilence = watchSpeechSilence(current.stream, current.settings.silenceSeconds,
        () => {
          if (active !== current) return;
          try { finishRecording(current, true); }
          catch (caught) {
            publish({ error: t("録音を開始できません: {0}", errorMessage(caught)) });
            stop();
          }
        }, available => {
          if (active !== current) return;
          silenceAvailable = available;
          publish({ silenceHint: available
            ? t("無音 {0} 秒で区切って変換します (録音は継続)", current.settings.silenceSeconds)
            : t("無音の検出は利用できません") });
        }, () => { heardVoice = true; });
    }
  }

  function newSession() {
    return { id: Symbol(), controller: new AbortController(), recorders: new Set(), pendingCaptures: 0,
      settings: { ...getSettings() } };
  }

  async function retry() {
    if (active || !retained.length) return;
    const current = newSession();
    current.ending = true;
    active = current;
    publish({ error: "" });
    await drain(current);
  }

  async function toggle() {
    if (active) {
      if (active.recorder?.state === "recording") finishRecording(active);
      else if (active.pendingCaptures) active.cancelAfterStop = true;
      else stop();
      return;
    }
    publish({ error: "" });
    if (retainedDuration() >= MAX_RECORDING_MS - 1000) {
      publish({ error: t("保持している録音が5分に達しました。認識するか破棄してください。") });
      return;
    }
    if (!speechSupported()) {
      publish({ error: t("このウィンドウでは録音を利用できません。") });
      return;
    }
    const current = newSession();
    active = current;
    publish({ status: "starting" });
    try {
      validateSpeechSettings(current.settings);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active !== current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      current.stream = stream;
      current.mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => MediaRecorder.isTypeSupported(type));
      startChunk(current);
      publish({ status: "recording", meterStream: stream });
      current.timer = setTimeout(() => finishRecording(current), Math.max(1000, MAX_RECORDING_MS - retainedDuration()));
    } catch (caught) {
      if (active === current) {
        stop();
        publish({ error: t("録音を開始できません: {0}", errorMessage(caught)) });
      }
    }
  }

  return { toggle, retry, stop, discard: () => stop(false), state: () => ({ ...state }),
    recording: () => state.status === "recording", busy: () => state.status !== "idle" };
}

function errorMessage(caught) {
  if (caught instanceof Error) {
    // getUserMedia rejects with a DOMException whose message is often empty.
    if (caught.name === "NotAllowedError") return t("マイクの使用が許可されていません。");
    if (caught.name === "NotFoundError") return t("マイクが見つかりません。");
    if (caught.name === "AbortError") return t("中断されました。");
    return caught.message || caught.name;
  }
  return String(caught);
}
