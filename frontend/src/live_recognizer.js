import { t } from "./i18n.js";
import { speechErrorMessage as errorMessage } from "./speech_errors.js";
import { createPCMCapture } from "./pcm_capture.js";
import { speechDraft, validateSpeechSettings } from "./speech.js";
import { watchSpeechSilence } from "./silence.js";

export function liveSpeechSupported() {
  return !!navigator.mediaDevices?.getUserMedia &&
    !!(globalThis.AudioContext ?? globalThis.webkitAudioContext);
}

const transportQueues = new WeakMap();

export function createLiveRecognizer({ getSettings, getBase, getContext, getText, onInput, onSend, onState, liveTransport, capture = createPCMCapture, watchSilence = watchSpeechSilence }) {
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
    current.stopSilence?.();
    current.stream?.getTracks().forEach(track => track.stop());
    if (!finish) {
      publish({ status: "idle", meterStream: null });
      // Reserve the stop in the connection queue before awaiting capture:
      // reopening must not connect and then be stopped by this old session.
      await connection(async () => {
        try { await current.capture?.stop(); } catch {}
        await liveTransport.stop();
      }).catch(() => {});
      return;
    }
    try { await current.capture?.stop(); } catch {}
    // Cancellation may have replaced this session while its audio drained.
    if (ending !== current) return;
    // Audio has already streamed to the provider, but an entirely quiet input
    // needs neither finalization nor its timeout wait.
    if (current.capture?.heardVoice?.() === false && !current.partial.trim()) {
      ending = null;
      await connection(() => liveTransport.stop()).catch(() => {});
      publish({ status: "idle", meterStream: null });
      return;
    }
    try {
      await liveTransport.finish(current.id);
    } catch (caught) {
      if (ending === current) publish({ error: t("ライブ書き起こしの終了に失敗しました: {0}", errorMessage(caught)) });
    }
  }

  async function finishSession(current) {
    if (active !== current) return;
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
  }

  async function toggle() {
    if (ending || (active && state.status === "starting")) {
      await cancel();
      return;
    }
    if (active) {
      await finishSession(active);
      return;
    }
    publish({ error: "" });
    if (!liveSpeechSupported()) {
      publish({ error: t("このウィンドウではライブ音声入力を利用できません。") });
      return;
    }
    const settings = { ...getSettings() };
    const current = { settings, stream: null, id: "", capture: null, committed: getBase(), partial: "", stopping: false, ending: false, finishTimer: null, openAIItems: new Map(), consumedOpenAIItems: new Map(), ignoreGemini: false };
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
      if (settings.endpointType === "openai" && settings.sendPhrase?.trim()) watchForCommand(current);
    } catch (caught) {
      if (active !== current) return;
      const stopped = stopSession(current, false);
      publish({ error: t("ライブ書き起こしを開始できません: {0}", errorMessage(caught)) });
      await stopped;
    }
  }

  function watchForCommand(current) {
    // OpenAI finalizes this turn only after we commit the input buffer. A
    // tentative trailing send phrase plus an actual pause requests that final;
    // only the provider's confirmed transcript is allowed to copy and close.
    current.stopSilence = watchSilence(current.stream, Math.max(0.5, current.settings.silenceSeconds || 1), () => {
      if (active !== current) return;
      current.silent = true;
      finishCommand(current);
      if (active === current) watchForCommand(current);
    }, available => {
      if (active === current) publish({ silenceHint: available ? "" : t("無音の検出は利用できません") });
    }, () => { current.silent = false; });
  }

  function finishCommand(current) {
    if (active !== current || !current.silent) return;
    preserveEdits(current);
    if (speechDraft("", current.partial, true, current.settings.sendPhrase).send) {
      void finishSession(current);
    }
  }

  function preserveEdits(current) {
    const base = getBase();
    const context = getContext?.();
    if (base === current.lastRendered && context === current.lastContext) return;
    current.committed = base;
    current.lastRendered = base;
    current.lastContext = context;
    // An OpenAI item can span the whole recording. Consume only the text
    // already displayed, so later deltas from that same item still reach the
    // editor without replaying or overwriting the user's corrections.
    for (const [id, text] of current.openAIItems) {
      current.consumedOpenAIItems.set(id, (current.consumedOpenAIItems.get(id) ?? "") + text);
    }
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
      if (event.kind === "delta") {
        target.openAIItems.set(event.itemId, (target.openAIItems.get(event.itemId) ?? "") + event.text);
        target.partial = [...target.openAIItems.values()].join("");
        renderPartial(target);
        finishCommand(target);
      } else if (event.kind === "final") {
        const pending = target.openAIItems.get(event.itemId) ?? "";
        target.openAIItems.delete(event.itemId);
        let text = event.text;
        if (target.consumedOpenAIItems.has(event.itemId)) {
          const consumed = target.consumedOpenAIItems.get(event.itemId);
          target.consumedOpenAIItems.delete(event.itemId);
          // A final revision alone must not undo an edit or execute an old
          // send command. If speech continued, finalize only the new suffix.
          if (!pending) return;
          text = text.startsWith(consumed) ? text.slice(consumed.length) : pending;
        }
        commit(target, text, [...target.openAIItems.values()].join(""));
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
