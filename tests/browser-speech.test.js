import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { speechDraft, convertSpokenSymbol } from "../frontend/src/speech.js";
import { applyReplacementRules } from "../frontend/src/replacements.js";
import { speechErrorMessage as errorMessage } from "../frontend/src/speech_errors.js";
import { setLanguage } from "../frontend/src/i18n.js";
setLanguage("ja");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness({ microphone, start } = {}) {
  const calls = [];
  const native = [];
  let text = "";
  const stream = { getTracks: () => [{ stop: () => calls.push("release") }] };
  const create = vm.runInNewContext(
    readFileSync(new URL("../frontend/src/browser_speech.js", import.meta.url), "utf8")
      .replace(/^import .*;$/gm, "").replace(/export /g, "") + "\ncreateBrowserRecognizer;", {
      speechDraft, convertSpokenSymbol, applyReplacementRules, errorMessage,
      t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, index) => args[index]),
      navigator: { language: "ja-JP", mediaDevices: { getUserMedia: () => {
        calls.push("request");
        return microphone ? microphone() : Promise.resolve(stream);
      } } },
      SpeechRecognition: class {
        constructor() { native.push(this); }
        start() { calls.push("start"); start?.(this); }
        abort() { calls.push("abort"); }
      }
    });
  const engine = create({
    getSettings: () => ({ language: "ja", sendPhrase: "以上" }),
    getBase: () => text, onInput: value => { text = value; }, onSend() {}, onState() {}
  });
  return { engine, calls, native, stream };
}

test("browser recognition waits for microphone permission before starting", async () => {
  const mic = deferred();
  const h = harness({ microphone: () => mic.promise });
  const starting = h.engine.toggle();
  assert.deepEqual(h.calls, ["request"]);
  assert.equal(h.engine.state().status, "starting");
  mic.resolve(h.stream);
  await starting;
  assert.deepEqual(h.calls, ["request", "start"]);
  assert.equal(h.engine.state().status, "recording");
  assert.equal(h.engine.state().meterStream, h.stream);
  h.engine.stop();
  assert.equal(h.calls.at(-1), "release");
});

test("microphone denial does not start recognition and explains the permission error", async () => {
  const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const h = harness({ microphone: () => Promise.reject(denied) });
  await h.engine.toggle();
  assert.equal(h.calls.includes("start"), false);
  assert.equal(h.engine.state().status, "idle");
  assert.match(h.engine.state().error, /マイクの使用が許可されていません/);
});

test("closing during microphone permission prevents a late start and releases the stream", async () => {
  const mic = deferred();
  const h = harness({ microphone: () => mic.promise });
  const starting = h.engine.toggle();
  h.engine.stop();
  mic.resolve(h.stream);
  await starting;
  assert.equal(h.calls.includes("start"), false);
  assert.equal(h.calls.filter(call => call === "release").length, 1);
  assert.equal(h.engine.state().status, "idle");
});

test("a cancelled permission failure cannot stop a later recording", async () => {
  const first = deferred();
  let requests = 0;
  const h = harness({ microphone: () => ++requests === 1 ? first.promise : Promise.resolve(h.stream) });
  const starting = h.engine.toggle();
  h.engine.stop();
  await h.engine.toggle();
  first.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  await starting;
  assert.equal(h.engine.state().status, "recording");
  assert.equal(h.engine.state().error, "");
  h.engine.stop();
});

test("a synchronous recognition error cannot be overwritten by recording state", async () => {
  const h = harness({ start: current => current.onerror({ error: "not-allowed" }) });
  await h.engine.toggle();
  assert.equal(h.engine.state().status, "idle");
  assert.match(h.engine.state().error, /マイクの使用が許可されていません/);
  assert.equal(h.calls.at(-1), "release");
});
