import { t } from "./i18n.js";
import { createPCMCapture } from "./pcm_capture.js";
import { speechDraft, validateSpeechSettings } from "./speech.js";

export function liveSpeechSupported() {
  return !!navigator.mediaDevices?.getUserMedia &&
    !!(globalThis.AudioContext ?? globalThis.webkitAudioContext);
}

export function createLiveRecognizer({ getSettings, getBase, getText, onInput, onSend, onState, liveTransport, capture = createPCMCapture }) {
  let active = null;
  let ending = null;
  const state = { status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null };
  const publish = changes => { Object.assign(state, changes); onState({ ...state }); };

  async function stopSession(current, finish) {
    if (!current || current.stopping) return;
    current.stopping = true;
    active = null;
    ending = finish ? current : null;
    clearTimeout(current.finishTimer);
    try { await current.capture?.stop(); } catch {}
    current.stream?.getTracks().forEach(track => track.stop());
    try {
      if (finish) await liveTransport.finish(current.id);
      else await liveTransport.stop();
    } catch (caught) {
      if (finish) publish({ error: t("ライブ書き起こしの終了に失敗しました: {0}", errorMessage(caught)) });
    }
    if (!finish) publish({ status: "idle", meterStream: null });
  }

  async function toggle() {
    if (active) {
      const current = active;
      current.ending = true;
      publish({ status: "transcribing", meterStream: null });
      await stopSession(current, true);
      if (ending === current) {
        current.finishTimer = setTimeout(() => {
          void liveTransport.stop();
          ending = null;
          publish({ status: "idle", meterStream: null });
        }, 8000);
      }
      return;
    }
    publish({ error: "" });
    if (!liveSpeechSupported()) {
      publish({ error: t("このウィンドウではライブ音声入力を利用できません。") });
      return;
    }
    const settings = { ...getSettings() };
    try {
      validateSpeechSettings(settings);
      publish({ status: "starting" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const current = { settings, stream, id: "", capture: null, committed: getBase(), partial: "", stopping: false, ending: false, finishTimer: null, openAIItems: new Map() };
      ending = null;
      active = current;
      current.id = await liveTransport.start();
      current.capture = await capture(stream, settings.endpointType === "openai" ? 24000 : 16000,
        chunk => liveTransport.send(current.id, chunk),
        caught => fail(current, caught));
      publish({ status: "recording", meterStream: stream });
    } catch (caught) {
      if (active) await stopSession(active, false);
      publish({ status: "idle", meterStream: null, error: t("ライブ書き起こしを開始できません: {0}", errorMessage(caught)) });
    }
  }

  function renderPartial(current) {
    const draft = speechDraft(current.committed, current.partial, false, current.settings.sendPhrase);
    onInput(draft.text);
  }

  function commit(current, text, remainingPartial = "") {
    current.partial = remainingPartial;
    const draft = speechDraft(current.committed, text, true, current.settings.sendPhrase, false, false,
      current.settings.symbolCommands, current.settings.replacements);
    current.committed = draft.text;
    onInput(remainingPartial ? speechDraft(draft.text, remainingPartial, false, current.settings.sendPhrase).text : draft.text);
    if (draft.send) {
      clearTimeout(current.finishTimer);
      ending = null;
      void stopSession(current, false);
      onSend(getText?.() ?? draft.text);
      return;
    }
    if (current.ending) {
      clearTimeout(current.finishTimer);
      void liveTransport.stop();
      ending = null;
      publish({ status: "idle", meterStream: null });
    }
  }

  function handleEvent(event) {
    const target = active ?? ending;
    if (!target || event.sessionId !== target.id) return;
    if (event.kind === "error") return fail(target, new Error(event.message || "live speech failed"));
    if (event.kind === "done") {
      target.partial = "";
      onInput(target.committed);
      ending = null;
      publish({ status: "idle", meterStream: null });
      return;
    }
    if (target.settings.endpointType === "openai") {
      if (event.kind === "delta") {
        target.openAIItems.set(event.itemId, (target.openAIItems.get(event.itemId) ?? "") + event.text);
        target.partial = [...target.openAIItems.values()].join("");
        renderPartial(target);
      } else if (event.kind === "final") {
        target.openAIItems.delete(event.itemId);
        commit(target, event.text, [...target.openAIItems.values()].join(""));
      }
    } else if (event.kind === "interim") {
      target.partial = event.text;
      renderPartial(target);
    } else if (event.kind === "final") {
      commit(target, event.text);
    }
  }

  async function fail(current, caught) {
    if (active === current) await stopSession(current, false);
    else await liveTransport.stop();
    ending = null;
    publish({ status: "idle", meterStream: null, error: t("ライブ書き起こしに失敗しました: {0}", errorMessage(caught)) });
  }

  const unsubscribe = liveTransport.onEvent(handleEvent);
  const cancel = async () => {
    if (active) await stopSession(active, false);
    else if (ending) {
      clearTimeout(ending.finishTimer);
      ending = null;
      await liveTransport.stop();
      publish({ status: "idle", meterStream: null });
    }
  };
  const discard = async () => { await cancel(); unsubscribe?.(); };
  return { toggle, retry: () => {}, stop: cancel, discard,
    state: () => ({ ...state }), recording: () => state.status === "recording", busy: () => state.status !== "idle" };
}

function errorMessage(caught) {
  if (caught instanceof Error) {
    if (caught.name === "NotAllowedError") return t("マイクの使用が許可されていません。");
    if (caught.name === "NotFoundError") return t("マイクが見つかりません。");
    return caught.message || caught.name;
  }
  return String(caught);
}
