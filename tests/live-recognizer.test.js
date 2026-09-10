import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { speechDraft, validateSpeechSettings } from "../frontend/src/speech.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ endpointType = "openai", microphone, start, capture } = {}) {
  let handler, text = "", context = 0;
  const calls = { tracks: 0, captures: 0, captureStops: 0, starts: 0, stops: 0, finishes: 0, sends: [] };
  const stream = { getTracks: () => [{ stop() { calls.tracks++; } }] };
  const timers = new Map();
  const create = vm.runInNewContext(
    readFileSync(new URL("../frontend/src/live_recognizer.js", import.meta.url), "utf8")
      .replace(/^import .*;$/gm, "").replace(/export /g, "") + "\ncreateLiveRecognizer;", {
      t: x => x, speechDraft, validateSpeechSettings,
      navigator: { mediaDevices: { getUserMedia: () => microphone ?? Promise.resolve(stream) } },
      AudioContext: class {},
      setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; },
      clearTimeout: id => timers.delete(id)
    });
  const captureResult = { stop: async () => { calls.captureStops++; } };
  const options = {
    getSettings: () => ({ provider: "live", endpointType, apiKey: "test", language: "auto", sendPhrase: "送信" }),
    getBase: () => text, getContext: () => context, getText: () => text,
    onInput: value => { text = value; context++; }, onSend: value => calls.sends.push(value), onState() {},
    capture: async () => { calls.captures++; return capture ?? captureResult; },
    liveTransport: {
      start: async () => { calls.starts++; return start ? await start : "s"; },
      send: async () => {}, finish: async () => { calls.finishes++; }, stop: async () => { calls.stops++; },
      onEvent: fn => { handler = fn; return () => { handler = null; }; }
    }
  };
  return { engine: create(options), create: () => create(options), stream, captureResult, calls, timers,
    event: event => handler?.({ sessionId: "s", ...event }), text: () => text,
    edit: value => { text = value; context++; }, move: () => { context++; } };
}

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
