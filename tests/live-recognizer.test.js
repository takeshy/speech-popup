import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { speechDraft, validateSpeechSettings } from "../frontend/src/speech.js";
import { createTextEditor } from "../frontend/src/editor.js";
import { speechErrorMessage as errorMessage } from "../frontend/src/speech_errors.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ endpointType = "openai", microphone, start, capture, input, sendPhrase = "送信" } = {}) {
  let handler, text = "", context = 0, onSilence, onVoice;
  const editor = input && createTextEditor(input);
  const getText = () => input?.value ?? text;
  const calls = { tracks: 0, captures: 0, captureStops: 0, starts: 0, stops: 0, finishes: 0, sends: [] };
  const stream = { getTracks: () => [{ stop() { calls.tracks++; } }] };
  const timers = new Map();
  const create = vm.runInNewContext(
    readFileSync(new URL("../frontend/src/live_recognizer.js", import.meta.url), "utf8")
      .replace(/^import .*;$/gm, "").replace(/export /g, "") + "\ncreateLiveRecognizer;", {
      t: x => x, speechDraft, validateSpeechSettings, errorMessage,
      navigator: { mediaDevices: { getUserMedia: () => microphone ?? Promise.resolve(stream) } },
      AudioContext: class {},
      watchSpeechSilence: (_stream, _seconds, silence, _status, voice) => {
        onSilence = silence;
        onVoice = voice;
        return () => { onSilence = onVoice = null; };
      },
      setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; },
      clearTimeout: id => timers.delete(id)
    });
  const captureResult = { stop: async () => { calls.captureStops++; } };
  const options = {
    getSettings: () => ({ provider: "live", endpointType, apiKey: "test", language: "auto", sendPhrase }),
    getBase: () => editor ? editor.speechBase() : text,
    getContext: () => editor ? editor.speechContext() : context, getText,
    onInput: value => { if (editor) editor.applySpeechPrefix(value); else text = value; context++; },
    onSend: value => calls.sends.push(value), onState() {},
    capture: async () => { calls.captures++; return capture ?? captureResult; },
    liveTransport: {
      start: async () => { calls.starts++; return start ? await start : "s"; },
      send: async () => {}, finish: async () => { calls.finishes++; }, stop: async () => { calls.stops++; },
      onEvent: fn => { handler = fn; return () => { handler = null; }; }
    }
  };
  return { engine: create(options), create: () => create(options), stream, captureResult, calls, timers,
    editor, event: event => handler?.({ sessionId: "s", ...event }), text: getText,
    silence: () => onSilence?.(), voice: () => onVoice?.(),
    edit: value => { text = value; context++; }, move: () => { context++; } };
}

test("OpenAI finalizes a spoken send phrase after silence and closes only after confirmation", async () => {
  const h = harness({ sendPhrase: "以上" });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "入力した文章。以上。" });
  assert.equal(h.calls.finishes, 0);
  h.silence();
  await tick();
  assert.equal(h.calls.finishes, 1);
  assert.equal(h.calls.sends.length, 0);
  h.event({ kind: "final", itemId: "a", text: "入力した文章。以上。" });
  await tick();
  assert.deepEqual(h.calls.sends, ["入力した文章。"]);
  assert.equal(h.calls.stops, 1);
});

test("a send phrase arriving after the pause still requests final confirmation", async () => {
  const h = harness({ sendPhrase: "以上" });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "入力した文章。" });
  h.silence();
  assert.equal(h.calls.finishes, 0);
  h.event({ kind: "delta", itemId: "a", text: "以上。" });
  await tick();
  assert.equal(h.calls.finishes, 1);
  h.event({ kind: "final", itemId: "a", text: "入力した文章。以上。" });
  assert.deepEqual(h.calls.sends, ["入力した文章。"]);
  await h.engine.stop();
});

test("a recognized short send phrase finalizes even when the local voice gate missed it", async () => {
  const h = harness({ sendPhrase: "以上", capture: { stop: async () => {}, heardVoice: () => false } });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "以上。" });
  h.silence();
  await tick();
  assert.equal(h.calls.finishes, 1);
  h.event({ kind: "final", itemId: "a", text: "以上。" });
  assert.deepEqual(h.calls.sends, [""]);
  await h.engine.stop();
});

test("continuing speech and edited-away commands do not automatically finalize", async () => {
  const h = harness({ sendPhrase: "以上" });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "以上" });
  h.event({ kind: "delta", itemId: "a", text: "の説明です。" });
  h.silence();
  assert.equal(h.calls.finishes, 0);
  h.voice();
  h.event({ kind: "delta", itemId: "a", text: "以上" });
  h.edit("手動修正した文章");
  h.silence();
  assert.equal(h.calls.finishes, 0);
  assert.equal(h.calls.sends.length, 0);
  await h.engine.stop();
});

test("a final correction that removes the tentative send phrase keeps the popup open", async () => {
  const h = harness({ sendPhrase: "以上" });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "異常です。以上" });
  h.silence();
  await tick();
  h.event({ kind: "final", itemId: "a", text: "異常です。" });
  h.event({ kind: "done" });
  assert.equal(h.calls.sends.length, 0);
  assert.equal(h.text(), "異常です。");
  assert.equal(h.engine.state().status, "idle");
});

test("cancelling microphone acquisition releases the late stream without connecting", async () => {
  const mic = deferred();
  const h = harness({ microphone: mic.promise });
  const starting = h.engine.toggle();
  await h.engine.stop();
  assert.equal(h.engine.state().status, "idle");
  mic.resolve(h.stream);
  await starting;
  assert.equal(h.calls.tracks, 1);
  assert.equal(h.calls.starts, 0);
  assert.equal(h.calls.captures, 0);
});

test("cancelling a pending connection closes it before a replacement engine starts", async () => {
  const dial = deferred();
  const h = harness({ start: dial.promise });
  const starting = h.engine.toggle();
  await tick();
  const cancelled = h.engine.discard();
  assert.equal(h.calls.tracks, 1);
  const replacement = h.create();
  const restarting = replacement.toggle();
  await tick();
  assert.equal(h.calls.starts, 1);
  dial.resolve("s");
  await Promise.all([starting, cancelled, restarting]);
  assert.equal(h.calls.stops, 1);
  assert.equal(h.calls.captures, 1);
  assert.equal(h.engine.state().status, "idle");
  assert.equal(replacement.state().status, "recording");
  await replacement.stop();
});

test("cancelling pending capture disposes the late capture without resuming recording", async () => {
  const capture = deferred();
  const h = harness({ capture: capture.promise });
  const starting = h.engine.toggle();
  await tick();
  await h.engine.stop();
  capture.resolve(h.captureResult);
  await starting;
  assert.equal(h.calls.captureStops, 1);
  assert.equal(h.engine.state().status, "idle");
});

test("reopening waits for the old capture to drain before starting a replacement connection", async () => {
  const drained = deferred();
  const h = harness({ capture: { stop: () => drained.promise } });
  await h.engine.toggle();
  const closing = h.engine.discard();
  const replacement = h.create();
  const reopening = replacement.toggle();
  await tick();
  assert.equal(h.calls.starts, 1, "the replacement must wait for the old capture to stop");
  drained.resolve();
  await Promise.all([closing, reopening]);
  assert.equal(h.calls.starts, 2);
  assert.equal(h.calls.stops, 1);
  assert.equal(replacement.state().status, "recording");
  await replacement.stop();
});

test("cancelled quiet finalization cannot stop a newly opened session", async () => {
  const drained = deferred();
  const h = harness({ capture: { stop: () => drained.promise, heardVoice: () => false } });
  await h.engine.toggle();
  const finishing = h.engine.toggle();
  const closing = h.engine.discard();
  const replacement = h.create();
  const reopening = replacement.toggle();
  drained.resolve();
  await Promise.all([finishing, closing, reopening]);
  assert.equal(h.calls.starts, 2);
  assert.equal(h.calls.stops, 1, "only the cancelled session should be stopped");
  assert.equal(replacement.state().status, "recording");
  await replacement.stop();
});

for (const endpointType of ["openai", "gemini-transcribe"]) {
  test(`${endpointType} preserves edits to committed text`, async () => {
    const h = harness({ endpointType });
    await h.engine.toggle();
    h.event({ kind: "final", itemId: "a", text: "元の文章" });
    h.edit("手動修正");
    h.event({ kind: "final", itemId: "b", text: "続き" });
    assert.equal(h.text(), "手動修正 続き");
    await h.engine.stop();
  });

  test(`${endpointType} ignores revisions and commands from an edited interim segment`, async () => {
    const h = harness({ endpointType });
    await h.engine.toggle();
    h.event({ kind: endpointType === "openai" ? "delta" : "interim", itemId: "a", text: "途中" });
    h.edit("修正済み");
    h.event({ kind: "final", itemId: "a", text: "送信" });
    assert.equal(h.text(), "修正済み");
    assert.equal(h.calls.sends.length, 0);
    h.event({ kind: "final", itemId: "b", text: "次" });
    assert.equal(h.text(), "修正済み 次");
    await h.engine.stop();
  });

  test(`${endpointType} accepts multiple final turns after stopping until done`, async () => {
    const h = harness({ endpointType });
    await h.engine.toggle();
    await h.engine.toggle();
    h.event({ kind: "final", itemId: "a", text: "前の発話" });
    assert.equal(h.calls.stops, 0);
    assert.equal(h.engine.state().status, "transcribing");
    h.event({ kind: "final", itemId: "b", text: "後の発話" });
    h.event({ kind: "done" });
    assert.equal(h.text(), "前の発話 後の発話");
    assert.equal(h.engine.state().status, "idle");
    assert.equal(h.timers.size, 0);
  });
}

test("cursor context changes consume the current hypothesis even if the prefix is unchanged", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "途中" });
  h.move();
  h.event({ kind: "final", itemId: "a", text: "書き換え" });
  assert.equal(h.text(), "途中");
  await h.engine.stop();
});

test("OpenAI continues the same streaming item after keyboard edits", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "元の文章" });
  h.edit("手動修正");
  h.event({ kind: "delta", itemId: "a", text: "続き" });
  assert.equal(h.text(), "手動修正 続き");
  h.event({ kind: "delta", itemId: "a", text: "の文章" });
  assert.equal(h.text(), "手動修正 続きの文章");
  h.event({ kind: "final", itemId: "a", text: "元の文章続きの文章。" });
  assert.equal(h.text(), "手動修正 続きの文章。");
  assert.equal(h.engine.state().status, "recording");
  assert.equal(h.calls.starts, 1);
  assert.equal(h.calls.stops, 0);
  await h.engine.stop();
});

test("OpenAI preserves repeated edits and does not replay a revised consumed prefix", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "元の文章" });
  h.edit("修正");
  h.event({ kind: "delta", itemId: "a", text: "続き" });
  h.edit("再修正");
  h.event({ kind: "delta", itemId: "a", text: "さらに続く" });
  h.event({ kind: "final", itemId: "a", text: "元の文の訂正続きさらに続く" });
  assert.equal(h.text(), "再修正 さらに続く");
  h.event({ kind: "final", itemId: "b", text: "次の発話" });
  assert.equal(h.text(), "再修正 さらに続く 次の発話");
  await h.engine.stop();
});

test("OpenAI continues after moving the caret without replaying the old hypothesis", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "途中" });
  h.move();
  h.event({ kind: "delta", itemId: "a", text: "続き" });
  assert.equal(h.text(), "途中 続き");
  h.event({ kind: "final", itemId: "a", text: "途中続き" });
  assert.equal(h.text(), "途中 続き");
  await h.engine.stop();
});

test("OpenAI applies a newly spoken send command after an edit", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "元の文章" });
  h.edit("修正");
  h.event({ kind: "delta", itemId: "a", text: "続き送信" });
  h.event({ kind: "final", itemId: "a", text: "元の文章続き送信" });
  await tick();
  assert.equal(h.text(), "修正 続き");
  assert.deepEqual(h.calls.sends, ["修正 続き"]);
  assert.equal(h.calls.stops, 1);
});

test("OpenAI dictation follows keyboard editing in the editor and preserves the suffix", async () => {
  const input = {
    value: "", selectionStart: 0, selectionEnd: 0,
    addEventListener() {},
    setSelectionRange(start, end = start) { this.selectionStart = start; this.selectionEnd = end; },
    setRangeText(value, start, end) {
      this.value = this.value.slice(0, start) + value + this.value.slice(end);
      this.setSelectionRange(start + value.length);
    }
  };
  const h = harness({ input });
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "前の文。\n後の文。" });
  input.setSelectionRange(1);
  h.editor.handleKeydown({ key: "k", ctrlKey: true, preventDefault() {} });
  assert.equal(h.text(), "前\n後の文。");
  h.event({ kind: "delta", itemId: "a", text: "続き" });
  assert.equal(h.text(), "前 続き\n後の文。");
  h.event({ kind: "final", itemId: "a", text: "前の文。\n後の文。続き。" });
  assert.equal(h.text(), "前 続き。\n後の文。");
  assert.equal(input.selectionStart, "前 続き。".length);
  await h.engine.stop();
});

test("toggle cancels finalization instead of opening another microphone", async () => {
  const h = harness();
  await h.engine.toggle();
  await h.engine.toggle();
  await h.engine.toggle();
  assert.equal(h.calls.starts, 1);
  assert.equal(h.calls.stops, 1);
  assert.equal(h.engine.state().status, "idle");
  assert.equal(h.timers.size, 0);
});

test("stopping without detected speech skips provider finalization", async () => {
  const capture = { stop: async () => {}, heardVoice: () => false };
  const h = harness({ capture });
  await h.engine.toggle();
  await h.engine.toggle();
  assert.equal(h.calls.finishes, 0);
  assert.equal(h.calls.stops, 1);
  assert.equal(h.engine.state().status, "idle");
  assert.equal(h.timers.size, 0);
});

test("send phrase during finalization closes the connection immediately", async () => {
  const h = harness();
  await h.engine.toggle();
  await h.engine.toggle();
  h.event({ kind: "final", itemId: "a", text: "送信" });
  await tick();
  assert.equal(h.calls.stops, 1);
  assert.equal(h.calls.sends.length, 1);
  assert.equal(h.engine.state().status, "idle");
  assert.equal(h.timers.size, 0);
});

test("OpenAI keeps the second pending item until its authoritative final arrives", async () => {
  const h = harness();
  await h.engine.toggle();
  h.event({ kind: "delta", itemId: "a", text: "前の発話" });
  h.event({ kind: "delta", itemId: "b", text: "暫定" });
  await h.engine.toggle();
  h.event({ kind: "final", itemId: "a", text: "前の発話" });
  assert.equal(h.calls.stops, 0);
  h.event({ kind: "final", itemId: "b", text: "後の発話の確定結果" });
  h.event({ kind: "done" });
  assert.equal(h.text(), "前の発話 後の発話の確定結果");
});

test("the cancel button also cancels while waiting for microphone permission", async () => {
  const mic = deferred();
  const h = harness({ microphone: mic.promise });
  const starting = h.engine.toggle();
  await h.engine.toggle();
  mic.resolve(h.stream);
  await starting;
  assert.equal(h.calls.starts, 0);
  assert.equal(h.engine.state().status, "idle");
});
