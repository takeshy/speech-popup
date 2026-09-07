import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRecorder, speechSupported } from "../frontend/src/recorder.js";
import { createTextEditor } from "../frontend/src/editor.js";
import { endpointPreset, isGoogleEndpoint, validateSpeechSettings } from "../frontend/src/speech.js";

// Run the UI with its real recorder and speech transport, replacing only the
// DOM, Wails bindings and browser audio devices. No private UI hooks are used.
const source = readFileSync(new URL("../frontend/src/main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "");

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("UI did not reach the expected state");
}

async function setup(t, { history = [], copyFails = false } = {}) {
  let microphoneRequests = 0;
  const audioGlobals = {
    navigator: { mediaDevices: { getUserMedia: async () => {
      microphoneRequests++;
      return { getTracks: () => [{ stop() {} }] };
    } } },
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      mimeType = "audio/webm";
      state = "inactive";
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["recorded audio"]) });
          void this.onstop?.();
        });
      }
    },
    OfflineAudioContext: class {
      async decodeAudioData() { return { length: 160, duration: 0.01 }; }
      createBufferSource() { return { connect() {}, start() {} }; }
      async startRendering() { return { getChannelData: () => new Float32Array(160) }; }
    }
  };
  for (const [name, value] of Object.entries(audioGlobals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }

  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const handlers = {};
      elements.set(id, {
        value: "", textContent: "", hidden: false, dataset: {}, checked: false,
        selectionStart: 0, selectionEnd: 0,
        focus() {}, setAttribute() {},
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
        setRangeText(text, start, end) {
          this.value = this.value.slice(0, start) + text + this.value.slice(end);
          this.setSelectionRange(start + text.length, start + text.length);
        },
        addEventListener(name, callback) { handlers[name] = callback; },
        fire(name, event = {}) { handlers[name]?.({ preventDefault() {}, ...event }); }
      });
    }
    return elements.get(id);
  }
  const events = {};
  let config = {
    speech: { provider: "openai-compatible", endpointType: "openai", baseUrl: "https://example.com/v1",
      apiKey: "invalid", model: "whisper-1", language: "auto", silenceSeconds: 0,
      sendPhrase: "", vertexProjectId: "", autoStart: true },
    window: { width: 600, height: 300, restoreFocus: true },
    clipboard: { backend: "wails", autoPaste: true, autoPasteDelayMs: 80, pasteKey: "ctrl+v" },
    hotkey: { enabled: false, accelerator: "Ctrl+8" }
  };
  let savedHistory = JSON.stringify(history);
  let hides = 0;
  let ready;
  const booted = new Promise((resolve) => { ready = resolve; });
  const requests = [];
  const app = {
    LoadConfig: async () => structuredClone(config),
    SaveConfig: async (view) => { config = structuredClone(view); return {}; },
    LoadHistory: async () => savedHistory,
    SaveHistory: async (data) => { savedHistory = data; },
    GetAppInfo: async () => ({ os: "linux", version: "test" }),
    NotifyReady: async () => ready(),
    SetOverlayOpen: async () => {},
    ReadClipboard: async () => "",
    CopyToClipboard: async () => { if (copyFails) throw new Error("copy failed"); },
    HidePopup: async () => { hides++; events["popup:hidden"](); },
    SpeechHTTPRequest: async (request) => {
      requests.push(request);
      return request.headers.Authorization === "Bearer corrected"
        ? { status: 200, body: '{"text":"recognized"}' }
        : { status: 401, body: "" };
    }
  };
  const timers = new Set();
  const context = vm.createContext({
    document: { getElementById: element, addEventListener() {} },
    window: { go: { main: { App: app } }, runtime: {
      EventsOn(name, callback) { events[name] = callback; }
    } },
    createRecorder, createTextEditor, speechSupported, endpointPreset, isGoogleEndpoint, validateSpeechSettings,
    createAudioMeter: () => ({ attach: async () => true }),
    browserSpeechSupported: () => false,
    URL, setTimeout, clearTimeout, clearInterval,
    setInterval(...args) { const timer = setInterval(...args); timers.add(timer); return timer; }
  });
  t.after(() => {
    events["popup:hidden"]?.();
    for (const timer of timers) clearInterval(timer);
  });
  vm.runInContext(source, context);
  await booted;
  return { element, events, requests, history: () => JSON.parse(savedHistory),
    hides: () => hides, microphoneRequests: () => microphoneRequests };
}

test("failed recording can be retried after correcting credentials in Settings", async (t) => {
  const ui = await setup(t);
  ui.element("record").fire("click");
  await until(() => ui.element("mode").dataset.recording === "true");
  ui.element("record").fire("click");
  await until(() => ui.requests.length === 1 && !ui.element("retry").hidden);
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("cfg-speech-api-key").value = "corrected";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  ui.element("settings-close").fire("click");
  assert.equal(ui.element("retry").hidden, false);
  ui.element("retry").fire("click");
  await until(() => ui.element("input").value === "recognized");
  assert.equal(ui.microphoneRequests(), 1, "retry must use the original audio");
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.requests[1].headers.Authorization, "Bearer corrected");
});

test("show and recording shortcuts do not start audio behind Settings or Help", async (t) => {
  const ui = await setup(t);
  for (const overlay of ["settings", "help"]) {
    ui.element(`menu-${overlay}`).fire("click");
    // Also covers Settings while its initial LoadConfig is still pending.
    ui.events["popup:focus-input"]("");
    ui.element("record").fire("click");
    ui.element("input").fire("keydown", { ctrlKey: true, code: "Space" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ui.microphoneRequests(), 0);
    ui.element(`${overlay}-close`).fire("click");
  }
  ui.events["popup:focus-input"]("");
  await until(() => ui.microphoneRequests() === 1);
});

test("copy failure preserves the draft and does not save history or hide", async (t) => {
  const ui = await setup(t, { history: ["previous"], copyFails: true });
  ui.element("input").value = "draft";
  ui.element("copy").fire("click");
  await until(() => ui.element("status").textContent === "コピーに失敗しました。");
  assert.equal(ui.element("input").value, "draft");
  assert.deepEqual(ui.history(), ["previous"]);
  assert.equal(ui.hides(), 0);
});

test("history restores on boot, returns to the draft, and persists copied text", async (t) => {
  const initial = Array.from({ length: 30 }, (_, i) => `history ${i}`);
  const ui = await setup(t, { history: initial });
  const input = ui.element("input");
  input.value = "draft";
  input.fire("keydown", { ctrlKey: true, key: "ArrowUp" });
  assert.equal(input.value, "history 29");
  input.fire("keydown", { ctrlKey: true, key: "ArrowUp" });
  assert.equal(input.value, "history 28");
  input.fire("keydown", { ctrlKey: true, key: "ArrowDown" });
  assert.equal(input.value, "history 29");
  input.fire("keydown", { ctrlKey: true, key: "ArrowDown" });
  assert.equal(input.value, "draft");
  ui.element("close").fire("click");
  assert.equal(input.value, "draft");
  ui.element("copy").fire("click");
  await until(() => ui.hides() === 2);
  assert.deepEqual(ui.history(), [...initial.slice(1), "draft"]);
  input.fire("keydown", { ctrlKey: true, key: "ArrowUp" });
  assert.equal(input.value, "draft");
});
