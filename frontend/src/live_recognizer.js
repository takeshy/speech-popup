import { t } from "./i18n.js";
import { createPCMCapture } from "./pcm_capture.js";
import { speechDraft, validateSpeechSettings } from "./speech.js";

export function liveSpeechSupported() {
  return !!navigator.mediaDevices?.getUserMedia &&
    !!(globalThis.AudioContext ?? globalThis.webkitAudioContext);
}

const transportQueues = new WeakMap();

export function createLiveRecognizer({ getSettings, getBase, getContext, getText, onInput, onSend, onState, liveTransport, capture = createPCMCapture }) {
  let active = null;
  let ending = null;
  // Serialize connection changes: a cancelled dial must close before a new start.
  const connection = action => {
    const result = (transportQueues.get(liveTransport) ?? Promise.resolve()).then(action);
    transportQueues.set(liveTransport, result.catch(() => {}));
    return result;
  };
  const state = { status: "idle", error: "", silenceHint: "", retainedCount: 0, meterStream: null };
  const publish = changes => { Object.assign(state, changes); onState({ ...state }); };

  async function stopSession(current, finish) {
    if (!current || (current.stopping && finish)) return;
    current.stopping = true;
    if (active === current) active = null;
    ending = finish ? current : null;
    clearTimeout(current.finishTimer);
    current.stream?.getTracks().forEach(track => track.stop());
    if (!finish) publish({ status: "idle", meterStream: null });
    try { await current.capture?.stop(); } catch {}
    // Audio has already streamed to the provider, but an entirely quiet input
    // needs neither finalization nor its timeout wait.
    if (finish && current.capture?.heardVoice?.() === false) {
      ending = null;
      await connection(() => liveTransport.stop()).catch(() => {});
      publish({ status: "idle", meterStream: null });
      return;
    }
    try {
      if (finish && ending === current) await liveTransport.finish(current.id);
      else if (!finish) await connection(() => liveTransport.stop()).catch(() => {});
    } catch (caught) {
      if (finish) publish({ error: t("ライブ書き起こしの終了に失敗しました: {0}", errorMessage(caught)) });
    }
  }

  async function toggle() {
    if (ending || (active && state.status === "starting")) {
      await cancel();
      return;
    }
    if (active) {
      const current = active;
      current.ending = true;
      publish({ status: "transcribing", meterStream: null });
      await stopSession(current, true);
      if (ending === current) {
        current.finishTimer = setTimeout(() => {
          void connection(() => liveTransport.stop());
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
    const current = { settings, stream: null, id: "", capture: null, committed: getBase(), partial: "", stopping: false, ending: false, finishTimer: null, openAIItems: new Map(), ignoredItems: new Set(), ignoreGemini: false };
    current.lastRendered = current.committed;
    current.lastContext = getContext?.();
    active = current;
    try {
      validateSpeechSettings(settings);
      publish({ status: "starting" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active !== current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      current.stream = stream;
      current.id = await connection(() => liveTransport.start());
      if (active !== current) return;
      current.capture = await capture(stream, settings.endpointType === "openai" ? 24000 : 16000,
        chunk => liveTransport.send(current.id, chunk),
        caught => fail(current, caught));
      if (active !== current) {
        await current.capture.stop();
        return;
      }
      publish({ status: "recording", meterStream: stream });
    } catch (caught) {
      if (active !== current) return;
      const stopped = stopSession(current, false);
      publish({ error: t("ライブ書き起こしを開始できません: {0}", errorMessage(caught)) });
      await stopped;
    }
  }

  function preserveEdits(current) {
    const base = getBase();
    const context = getContext?.();
    if (base === current.lastRendered && context === current.lastContext) return;
    current.committed = base;
    current.lastRendered = base;
    current.lastContext = context;
    for (const id of current.openAIItems.keys()) current.ignoredItems.add(id);
    current.openAIItems.clear();
    if (current.partial && current.settings.endpointType !== "openai") current.ignoreGemini = true;
    current.partial = "";
  }

  function render(current, text) {
    onInput(text);
    current.lastRendered = text;
    current.lastContext = getContext?.();
  }

  function renderPartial(current) {
    const draft = speechDraft(current.committed, current.partial, false, current.settings.sendPhrase);
    render(current, draft.text);
  }

  function commit(current, text, remainingPartial = "") {
    current.partial = remainingPartial;
    const draft = speechDraft(current.committed, text, true, current.settings.sendPhrase, false, false,
      current.settings.symbolCommands, current.settings.replacements);
    current.committed = draft.text;
    render(current, remainingPartial ? speechDraft(draft.text, remainingPartial, false, current.settings.sendPhrase).text : draft.text);
    if (draft.send) {
      clearTimeout(current.finishTimer);
      void stopSession(current, false);
      onSend(getText?.() ?? draft.text);
      return;
    }
    // More turns may still be in flight; only done (or cancellation) ends the session.
  }

  function handleEvent(event) {
    const target = active ?? ending;
    if (!target || event.sessionId !== target.id) return;
    if (event.kind === "error") return fail(target, new Error(event.message || "live speech failed"));
    preserveEdits(target);
    if (event.kind === "done") {
      clearTimeout(target.finishTimer);
      target.partial = "";
      render(target, target.committed);
      ending = null;
      publish({ status: "idle", meterStream: null });
      return;
    }
    if (target.settings.endpointType === "openai") {
      if (target.ignoredItems.has(event.itemId)) {
        if (event.kind === "final") target.ignoredItems.delete(event.itemId);
        return;
      }
      if (event.kind === "delta") {
        target.openAIItems.set(event.itemId, (target.openAIItems.get(event.itemId) ?? "") + event.text);
        target.partial = [...target.openAIItems.values()].join("");
        renderPartial(target);
      } else if (event.kind === "final") {
        target.openAIItems.delete(event.itemId);
        commit(target, event.text, [...target.openAIItems.values()].join(""));
      }
    } else if (target.ignoreGemini) {
      if (event.kind === "final") target.ignoreGemini = false;
    } else if (event.kind === "interim") {
      target.partial = event.text;
      renderPartial(target);
    } else if (event.kind === "final") {
      commit(target, event.text);
    }
  }

  async function fail(current, caught) {
    if (active !== current && ending !== current) return;
    const stopped = stopSession(current, false);
    publish({ error: t("ライブ書き起こしに失敗しました: {0}", errorMessage(caught)) });
    await stopped;
  }

  const unsubscribe = liveTransport.onEvent(handleEvent);
  const cancel = async () => {
    const current = active ?? ending;
    if (current) await stopSession(current, false);
  };
  const discard = async () => { unsubscribe?.(); await cancel(); };
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
