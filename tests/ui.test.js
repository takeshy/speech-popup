import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRecorder, speechSupported } from "../frontend/src/recorder.js";
import { createTextEditor } from "../frontend/src/editor.js";
import { createAutoSizer } from "../frontend/src/autosize.js";
import { defaultSpeechCommands, speechCommandsFor, splitCommandPhrases } from "../frontend/src/speech_commands.js";
import { parseReplacementRules, serializeReplacementRules } from "../frontend/src/replacements.js";
import { defaultSendPhrase, initialSendPhrase, sendPhraseLanguage } from "../frontend/src/send_phrases.js";
import { speechLanguageOptions } from "../frontend/src/speech_languages.js";
import { t as translate, setLanguage, getLanguage } from "../frontend/src/i18n.js";
setLanguage("ja");
import { endpointPreset, isGoogleEndpoint, validateSpeechSettings } from "../frontend/src/speech.js";

// Run the UI with its real recorder and speech transport, replacing only the
// DOM, Wails bindings and browser audio devices. No private UI hooks are used.
const source = readFileSync(new URL("../frontend/src/main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "");

async function until(predicate, detail = "") {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`UI did not reach the expected state${detail ? `: ${detail}` : ""}`);
}

async function setup(t, { history = [], copyFails = false, vertexClient = null, speech = {}, respond = null, recordingStep = 3000 } = {}) {
  let microphoneRequests = 0;
  let recordingTime = 0;
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
  // Rows the settings pane builds at runtime are reachable by id like every
  // other element, so a test asserts on the fields the user actually fills in.
  function createElement() {
    const handlers = {};
    const node = {
      value: "", textContent: "", hidden: false, dataset: {}, checked: false, className: "", children: [],
      parent: null, focused: false, focus() { node.focused = true; }, setAttribute() {},
      append(...children) {
        for (const child of children) {
          child.parent = node;
          node.children.push(child);
        }
      },
      replaceChildren(...children) {
        for (const child of node.children) child.parent = null;
        node.children = [];
        node.append(...children);
      },
      remove() {
        if (!node.parent) return;
        node.parent.children = node.parent.children.filter((child) => child !== node);
        node.parent = null;
      },
      addEventListener(name, callback) { handlers[name] = callback; },
      fire(name, event = {}) { handlers[name]?.({ preventDefault() {}, ...event }); }
    };
    let id = "";
    Object.defineProperty(node, "id", {
      get() { return id; },
      set(value) {
        id = value;
        elements.set(value, node);
      }
    });
    return node;
  }
  function element(id) {
    if (!elements.has(id)) {
      // Static elements are the same stand-ins as the ones built at runtime,
      // plus what a select and a text field need.
      const node = createElement();
      node.selectionStart = 0;
      node.selectionEnd = 0;
      node.options = [];
      const replaceChildren = node.replaceChildren;
      node.replaceChildren = (...children) => {
        node.options = children;
        node.value = children[0]?.value ?? "";
        replaceChildren(...children);
      };
      node.setSelectionRange = (start, end) => {
        node.selectionStart = start;
        node.selectionEnd = end;
      };
      node.setRangeText = (text, start, end) => {
        node.value = node.value.slice(0, start) + text + node.value.slice(end);
        node.setSelectionRange(start + text.length, start + text.length);
      };
      const fire = node.fire;
      node.fire = (name, event = {}) => {
        if (id === "record" && name === "click") recordingTime += recordingStep;
        fire(name, event);
      };
      node.id = id;
    }
    const node = elements.get(id);
    if (id === "cfg-speech-language" && !node.selectValueInstalled) {
      node.selectValueInstalled = true;
      let selected = "";
      Object.defineProperty(node, "value", {
        get() { return selected; },
        set(value) { selected = this.options.some(option => option.value === value) ? value : ""; }
      });
    }
    return node;
  }
  const events = {};
  let config = {
    speech: { provider: "openai-compatible", endpointType: "openai", baseUrl: "https://example.com/v1",
      apiKey: "invalid", model: "whisper-1", language: "auto", silenceSeconds: 0,
      sendPhrase: "", vertexProjectId: "", autoStart: true, ...speech },
    window: { width: 600, height: 300, restoreFocus: true },
    clipboard: { backend: "wails", autoPaste: true, autoPasteDelayMs: 80, pasteKey: "ctrl+v" },
    hotkey: { enabled: false, accelerator: "Ctrl+8" }
  };
  let savedHistory = JSON.stringify(history);
  let hides = 0;
  let ready;
  const booted = new Promise((resolve) => { ready = resolve; });
  const requests = [];
  const vertexConnections = [];
  const app = {
    LoadConfig: async () => structuredClone(config),
    SaveConfig: async (view) => { config = structuredClone(view); return {}; },
    LoadHistory: async () => savedHistory,
    SaveHistory: async (data) => { savedHistory = data; },
    GetAppInfo: async () => ({ os: "linux", version: "test" }),
    NotifyReady: async () => ready(),
    SetOverlayOpen: async () => {},
    SelectVertexOAuthClient: async () => vertexClient,
    ConnectVertexOAuth: async (...args) => { vertexConnections.push(args); },
    GetVertexOAuthStatus: async () => ({ connected: vertexConnections.length > 0, clientId: vertexClient?.clientId }),
    ReadClipboard: async () => "",
    CopyToClipboard: async () => { if (copyFails) throw new Error("copy failed"); },
    CopyTranscript: async (text) => {
      if (copyFails) throw new Error("copy failed");
      return text !== "";
    },
    HidePopup: async () => { hides++; events["popup:hidden"](); },
    SpeechHTTPRequest: async (request) => {
      requests.push(request);
      if (respond) return respond(request);
      return request.headers.Authorization === "Bearer corrected"
        ? { status: 200, body: '{"text":"recognized"}' }
        : { status: 401, body: "" };
    }
  };
  const timers = new Set();
  const context = vm.createContext({
    document: { getElementById: element, createElement, addEventListener() {} },
    window: { go: { main: { App: app } }, runtime: {
      EventsOn(name, callback) { events[name] = callback; }
    } },
    createRecorder: options => createRecorder({ ...options, now: () => recordingTime }), createTextEditor, createAutoSizer, speechSupported, endpointPreset, isGoogleEndpoint, validateSpeechSettings,
    t: translate, getLanguage, setLanguage, speechLanguageOptions, defaultSendPhrase, initialSendPhrase, sendPhraseLanguage, defaultSpeechCommands, speechCommandsFor, splitCommandPhrases, parseReplacementRules, serializeReplacementRules,
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    localizeDOM() {},
    createAudioMeter: () => ({ attach: async () => true }),
    browserSpeechSupported: () => false,
    URL, structuredClone, setTimeout, clearTimeout, clearInterval,
    setInterval(...args) { const timer = setInterval(...args); timers.add(timer); return timer; }
  });
  t.after(() => {
    events["popup:hidden"]?.();
    for (const timer of timers) clearInterval(timer);
  });
  vm.runInContext(source, context);
  await booted;
  return { element, events, requests, vertexConnections, history: () => JSON.parse(savedHistory),
    config: () => structuredClone(config), hides: () => hides, microphoneRequests: () => microphoneRequests };
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

test("English UI displays the provider, settings and transcription errors in English", async (t) => {
  setLanguage("en");
  t.after(() => setLanguage("ja"));
  const ui = await setup(t);
  assert.equal(ui.element("speech-provider").textContent, "Transcription: OpenAI");
  assert.equal(ui.element("mode").textContent, "Idle");
  ui.element("record").fire("click");
  await until(() => ui.element("mode").dataset.recording === "true");
  assert.equal(ui.element("mode").textContent, "Recording");
  ui.element("record").fire("click");
  await until(() => ui.requests.length === 1 && !ui.element("retry").hidden);
  assert.match(ui.element("error").textContent, /Speech recognition failed: STT HTTP 401/);
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "Saved.");
});

test("reopening archives uncopied text, clears the editor and allows history retrieval", async (t) => {
  const ui = await setup(t, { history: ["older"] });
  const input = ui.element("input");
  input.value = " uncopied\ntext ";
  ui.element("close").fire("click");
  ui.events["popup:shown"]("help");
  assert.equal(input.value, "");
  assert.deepEqual(ui.history(), ["older", " uncopied\ntext "]);
  ui.element("help-close").fire("click");
  input.fire("keydown", { ctrlKey: true, key: "z" });
  assert.equal(input.value, "", "new session must clear the old undo stack");
  input.fire("keydown", { ctrlKey: true, key: "ArrowUp" });
  assert.equal(input.value, " uncopied\ntext ");
  input.fire("keydown", { ctrlKey: true, key: "ArrowDown" });
  assert.equal(input.value, "");
  ui.events["popup:shown"]("help");
  assert.deepEqual(ui.history(), ["older", " uncopied\ntext "], "empty input adds no entry");
});

test("Vertex JSON replaces the saved project and persists it without manual entry", async (t) => {
  const ui = await setup(t, {
    vertexClient: { clientId: "desktop-client", clientSecret: "secret", projectId: "cloud-project" },
    speech: { endpointType: "vertex-transcribe", vertexProjectId: "old-project" }
  });
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("vertex-connect").fire("click");
  await until(() => ui.element("settings-status").textContent === "Google に接続しました。");
  assert.deepEqual(ui.vertexConnections, [["desktop-client", "secret", "cloud-project"]]);
  ui.element("cfg-speech-endpoint").value = "openai";
  ui.element("cfg-speech-endpoint").fire("change");
  ui.element("cfg-speech-endpoint").value = "vertex-transcribe";
  ui.element("cfg-speech-endpoint").fire("change");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.config().speech.vertexProjectId, "cloud-project");
  assert.equal(ui.config().speech.profiles["vertex-transcribe"].vertexProjectId, "cloud-project");
});

test("Vertex JSON without a project stops before OAuth and preserves the saved project", async (t) => {
  const ui = await setup(t, {
    vertexClient: { clientId: "desktop-client", projectId: " " },
    speech: { endpointType: "vertex-transcribe", vertexProjectId: "old-project" }
  });
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("vertex-connect").fire("click");
  await until(() => ui.element("settings-status").textContent.includes("project_id"));
  assert.deepEqual(ui.vertexConnections, []);
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.config().speech.vertexProjectId, "old-project");
});

test("canceling the Vertex JSON picker does not start OAuth", async (t) => {
  const ui = await setup(t);
  ui.element("vertex-connect").fire("click");
  await until(() => ui.element("settings-status").textContent === "");
  assert.deepEqual(ui.vertexConnections, []);
});

test("Azure MAI endpoint and key persist when Settings is reopened", async (t) => {
  const ui = await setup(t);
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("cfg-speech-endpoint").value = "azure-mai-transcribe";
  ui.element("cfg-speech-endpoint").fire("change");
  assert.equal(ui.element("cfg-speech-api-key").value, "");
  assert.equal(ui.element("cfg-speech-model").value, "MAI-Transcribe-2");
  for (const row of ["row-base-url", "row-api-key", "row-model"]) assert.equal(ui.element(row).hidden, false);
  ui.element("cfg-speech-base-url").value = "https://resource.cognitiveservices.azure.com";
  ui.element("cfg-speech-api-key").value = "azure-test-key";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  ui.element("settings-close").fire("click");
  ui.element("cfg-speech-api-key").value = "";
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "azure-test-key");
  assert.equal(ui.element("cfg-speech-endpoint").value, "azure-mai-transcribe");
  assert.equal(ui.element("cfg-speech-base-url").value, "https://resource.cognitiveservices.azure.com");
  assert.equal(ui.element("speech-provider").textContent, "書き起こし: Azure MAI Transcribe");
});

test("service profiles restore edits, isolate keys, and survive saving and reopening", async (t) => {
  const ui = await setup(t, { speech: { profiles: { "vertex-transcribe": { vertexProjectId: "my-project", baseUrl: "", model: "", language: "auto" } } } });
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  const switchTo = (name) => {
    ui.element("cfg-speech-endpoint").value = name;
    ui.element("cfg-speech-endpoint").fire("change");
  };
  ui.element("cfg-speech-language").value = "en";
  switchTo("azure-mai-transcribe");
  assert.equal(ui.element("cfg-speech-api-key").value, "");
  ui.element("cfg-speech-base-url").value = "https://azure.example.com";
  ui.element("cfg-speech-api-key").value = "azure-key";
  ui.element("cfg-speech-model").value = "MAI-Transcribe-1.5";
  ui.element("cfg-speech-language").value = "ja";
  switchTo("vertex-transcribe");
  assert.equal(ui.element("cfg-speech-api-key").value, "");
  switchTo("openai");
  assert.equal(ui.element("cfg-speech-api-key").value, "invalid");
  assert.equal(ui.element("cfg-speech-language").value, "en");
  switchTo("azure-mai-transcribe");
  assert.equal(ui.element("cfg-speech-api-key").value, "azure-key");
  assert.equal(ui.element("cfg-speech-model").value, "MAI-Transcribe-1.5");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  ui.element("settings-close").fire("click");
  ui.element("menu-settings").fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  switchTo("vertex-transcribe");
  assert.equal(ui.config().speech.profiles["vertex-transcribe"].vertexProjectId, "my-project");
  switchTo("openai");
  assert.equal(ui.element("cfg-speech-api-key").value, "invalid");
  ui.element("cfg-speech-api-key").value = "unsaved";
  ui.element("settings-close").fire("click");
  ui.element("menu-settings").fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  switchTo("openai");
  assert.equal(ui.element("cfg-speech-api-key").value, "invalid");
  switchTo("azure-mai-transcribe");
  assert.equal(ui.element("cfg-speech-base-url").value, "https://azure.example.com");
  assert.equal(ui.element("cfg-speech-language").value, "ja");
});

test("display language defaults to detected language and switches on save without losing text", async (t) => {
  setLanguage("ja");
  t.after(() => setLanguage("ja"));
  const ui = await setup(t);
  assert.equal(ui.element("cfg-ui-language").value, "ja");
  ui.element("input").value = "日本語 draft";
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("cfg-ui-language").value = "en";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "Saved.");
  assert.equal(ui.element("mode").textContent, "Idle");
  assert.equal(ui.element("input").value, "日本語 draft");
  ui.element("settings-close").fire("click");
  ui.element("menu-settings").fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.element("cfg-ui-language").value, "en");
  ui.element("cfg-ui-language").value = "ja";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.element("mode").textContent, "待機中");
});

test("speech dropdown changes service codes and preserves existing regional tags", async (t) => {
  const ui = await setup(t, { speech: { language: "fr-CA" } });
  const select = ui.element("cfg-speech-language");
  assert.equal(select.value, "fr-CA");
  assert.ok(select.options.some(option => option.value === "fr"));
  ui.element("cfg-speech-endpoint").value = "gemini-transcribe";
  ui.element("cfg-speech-endpoint").fire("change");
  assert.equal(select.value, "auto");
  assert.ok(select.options.some(option => option.value === "fr-FR"));
  assert.ok(!select.options.some(option => option.value === "fr"));
  select.value = "fr-FR";
  select.fire("change");
  ui.element("cfg-speech-endpoint").value = "openai";
  ui.element("cfg-speech-endpoint").fire("change");
  assert.equal(select.value, "fr-CA");
  select.value = "custom";
  select.fire("change");
  assert.equal(ui.element("cfg-speech-language-custom").disabled, false);
  ui.element("cfg-speech-language-custom").value = "es-MX";
  ui.element("cfg-speech-language-custom").fire("change");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.config().speech.language, "es-MX");
  assert.equal(ui.config().speech.profiles["gemini-transcribe"].language, "fr-FR");
  assert.equal(select.value, "es-MX");
});

test("send phrases follow language changes, remember edits and disabling, and reset", async (t) => {
  const ui = await setup(t, { speech: { language: "en", sendPhrase: "over, オーバー" } });
  const phrase = ui.element("cfg-speech-send-phrase");
  const language = ui.element("cfg-speech-language");
  const choose = (code) => { language.value = code; language.fire("change"); };
  assert.equal(phrase.value, "I'm done speaking");
  assert.equal(ui.element("send-phrase-hint").textContent, "終了するには「I'm done speaking」と話してください");
  assert.equal(ui.element("send-phrase-hint").hidden, false);
  choose("fr");
  assert.equal(phrase.value, "");
  phrase.value = "envoyer maintenant";
  choose("de");
  assert.equal(phrase.value, "");
  phrase.value = "";
  choose("fr");
  assert.equal(phrase.value, "envoyer maintenant");
  choose("de");
  assert.equal(phrase.value, "");
  ui.element("speech-send-phrase-reset").fire("click");
  assert.equal(phrase.value, "");
  choose("fr");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.config().speech.sendPhraseProfiles.fr, "envoyer maintenant");
  assert.equal(ui.config().speech.sendPhraseProfiles.de, "");
  ui.element("menu-settings").fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(phrase.value, "envoyer maintenant");
  ui.element("cfg-speech-endpoint").value = "gemini-transcribe";
  ui.element("cfg-speech-endpoint").fire("change");
  choose("fr-FR");
  assert.equal(phrase.value, "envoyer maintenant", "same language shares edits across services");
});

test("saved language-specific send phrases are restored at startup", async (t) => {
  const ui = await setup(t, { speech: {
    language: "fr", sendPhrase: "stale global phrase", sendPhraseProfiles: { fr: "", de: "abschicken" }
  } });
  assert.equal(ui.element("cfg-speech-send-phrase").value, "");
  ui.element("cfg-speech-language").value = "de";
  ui.element("cfg-speech-language").fire("change");
  assert.equal(ui.element("cfg-speech-send-phrase").value, "abschicken");
});

test("record button preserves the caret and inserts recognition before the suffix", async (t) => {
  const ui = await setup(t, { speech: { apiKey: "corrected" } });
  const input = ui.element("input");
  input.value = "left  right";
  input.setSelectionRange(5, 5);
  ui.element("record").fire("click");
  assert.equal(input.selectionStart, 5);
  await until(() => ui.element("mode").dataset.recording === "true");
  ui.element("record").fire("click");
  await until(() => input.value === "left recognized right");
  assert.equal(input.selectionStart, "left recognized".length);
  input.fire("keydown", { key: "z", ctrlKey: true });
  assert.equal(input.value, "left  right");
  assert.equal(input.selectionStart, 5);
});

test("recorded speech replaces selected text and keeps the remaining text", async (t) => {
  const ui = await setup(t, { speech: { apiKey: "corrected" } });
  const input = ui.element("input");
  input.value = "left old right";
  input.setSelectionRange(5, 8);
  ui.element("record").fire("click");
  await until(() => ui.element("mode").dataset.recording === "true");
  ui.element("record").fire("click");
  await until(() => input.value === "left recognized right");
});

test("a send phrase with no preceding text closes without copying", async (t) => {
  const ui = await setup(t, {
    speech: { apiKey: "corrected", language: "ja", sendPhrase: "これで終わります" },
    respond: () => ({ status: 200, body: '{"text":"これで終わります"}' })
  });
  ui.element("record").fire("click");
  await until(() => ui.element("mode").dataset.recording === "true");
  ui.element("record").fire("click");
  await until(() => ui.hides() === 1);
  assert.equal(ui.element("input").value, "");
});

test("question and newline phrases follow language, preserve overrides, and survive save", async (t) => {
  const ui = await setup(t, { speech: { language: "en", sendPhrase: "over, オーバー" } });
  const language = ui.element("cfg-speech-language");
  const question = ui.element("cfg-question-phrases");
  const newline = ui.element("cfg-newline-phrases");
  const choose = (code) => { language.value = code; language.fire("change"); };
  assert.equal(newline.value, "enter");
  question.value = "";
  choose("es");
  assert.equal(question.value, "");
  assert.equal(newline.value, "");
  assert.equal(ui.element("cfg-speech-send-phrase").value, "");
  question.value = "signo de pregunta";
  newline.value = "nueva línea";
  ui.element("cfg-exclamation-phrases").value = "así es";
  ui.element("cfg-speech-send-phrase").value = "se acabo, se acabó";
  choose("ja");
  assert.equal(newline.value, "エンター");
  choose("en");
  assert.equal(question.value, "", "disabled English command stays disabled");
  choose("es");
  assert.equal(question.value, "signo de pregunta");
  assert.equal(newline.value, "nueva línea");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  assert.equal(ui.config().speech.questionPhrases.es, "signo de pregunta");
  assert.equal(ui.config().speech.exclamationPhrases.es, "así es");
  assert.equal(ui.config().speech.newlinePhrases.es, "nueva línea");
  assert.equal(ui.config().speech.sendPhraseProfiles.es, "se acabo, se acabó");
  ui.element("menu-settings").fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(newline.value, "nueva línea");
  assert.equal(ui.element("cfg-exclamation-phrases").value, "así es");
  ui.element("speech-symbols-reset").fire("click");
  assert.equal(ui.element("cfg-exclamation-phrases").value, "");
  assert.equal(question.value, "");
  assert.equal(newline.value, "");
});

test("one phrase cannot be assigned to two actions", async (t) => {
  const ui = await setup(t, { speech: { language: "en" } });
  ui.element("cfg-question-phrases").value = "same phrase";
  ui.element("cfg-newline-phrases").value = "SAME PHRASE";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").dataset.error === "true");
  assert.equal(ui.config().speech.questionPhrases, undefined);
});

test("saved symbol phrases actually control recorded transcription", async (t) => {
  const ui = await setup(t, { speech: {
    language: "es", apiKey: "corrected", newlinePhrases: { es: "recognized" },
    questionPhrases: { es: "" }
  } });
  const input = ui.element("input");
  input.value = "before. after";
  input.setSelectionRange(7, 7);
  ui.element("record").fire("click");
  await until(() => ui.element("mode").dataset.recording === "true");
  ui.element("record").fire("click");
  await until(() => input.value === "before.\n after");
  assert.equal(ui.hides(), 0);
});


test("a saved replacement rule turns dictation into the command it stands for", async (t) => {
  const ui = await setup(t, {
    // "/daily" cannot be dictated: this is the whole point of the rules.
    speech: { apiKey: "corrected", replacements: "日記書いて => /daily" },
    respond: () => ({ status: 200, body: '{"text":"日記書いて 今日は雨だった"}' })
  });
  const record = async (expected) => {
    ui.element("record").fire("click");
    await until(() => ui.element("mode").dataset.recording === "true");
    ui.element("record").fire("click");
    await until(() => ui.element("input").value.endsWith(expected), `input was ${JSON.stringify(ui.element("input").value)}, requests ${ui.requests.length}, saved ${JSON.stringify(ui.config().speech.replacements)}, status ${JSON.stringify(ui.element("status").textContent)}`);
  };
  await record("/daily 今日は雨だった");

  // Settings shows the saved rule in its two fields, one row per rule, with an
  // empty row waiting so the first rule needs no extra click.
  // openSettings reloads the config, fills the form and only then focuses its
  // first field, so that focus is the signal that the rows are the saved ones.
  const openSettings = async () => {
    ui.element("cfg-speech-provider").focused = false;
    ui.element("menu-settings").fire("click");
    await until(() => ui.element("cfg-speech-provider").focused);
  };
  await openSettings();
  assert.equal(ui.element("cfg-replacement-from-1").value, "日記書いて");
  assert.equal(ui.element("cfg-replacement-to-1").value, "/daily");
  // An empty row waits at the end, so a rule can be added without the button.
  assert.equal(ui.element("cfg-replacement-from-2").value, "");

  // A replacement is often a sentence, and it may span lines.
  ui.element("cfg-replacement-from-2").value = "今日は雨だった";
  ui.element("cfg-replacement-to-2").value = "今日は雨でした。\n傘を持って出ました。";
  ui.element("replacement-add").fire("click");
  assert.equal(ui.element("cfg-replacement-from-3").className, "replacement-from");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  // The row left empty is not stored as a rule.
  assert.equal(ui.config().speech.replacements, "日記書いて => /daily\n今日は雨だった => 今日は雨でした。\\n傘を持って出ました。");
  ui.element("settings-close").fire("click");
  await record("/daily 今日は雨でした。\n傘を持って出ました。");

  // Deleting a rule leaves the other one working.
  await openSettings();
  ui.element("replacement-remove-1").fire("click");
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").textContent === "保存しました。");
  ui.element("settings-close").fire("click");
  await record("日記書いて 今日は雨でした。\n傘を持って出ました。");
});


test("MAI transcription still uses its saved endpoint, key, model and language after another service", async (t) => {
  const ui = await setup(t, {
    speech: { endpointType: "azure-mai-transcribe", baseUrl: "https://mai.example.com", apiKey: "mai-key",
      model: "MAI-Transcribe-2", language: "ja" },
    respond: request => request.url.includes("mai.example.com")
      ? { status: 200, body: JSON.stringify({ combinedPhrases: [{ text: "MAI result" }] }) }
      : { status: 200, body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Gemini result" }] } }] }) }
  });
  const record = async expected => {
    ui.element("record").fire("click");
    await until(() => ui.element("mode").dataset.recording === "true");
    ui.element("record").fire("click");
    await until(() => ui.element("input").value.endsWith(expected));
  };
  const switchService = async endpoint => {
    ui.element("menu-settings").fire("click");
    await new Promise(resolve => setImmediate(resolve));
    ui.element("cfg-speech-endpoint").value = endpoint;
    ui.element("cfg-speech-endpoint").fire("change");
    if (endpoint === "gemini-transcribe") ui.element("cfg-speech-api-key").value = "gemini-key";
    ui.element("settings-form").fire("submit");
    await until(() => ui.element("settings-status").textContent === "保存しました。");
    ui.element("settings-close").fire("click");
  };
  await record("MAI result");
  await switchService("gemini-transcribe");
  await record("Gemini result");
  await switchService("azure-mai-transcribe");
  await record("MAI result");
  assert.equal(ui.requests.length, 3);
  for (const request of [ui.requests[0], ui.requests[2]]) {
    assert.match(request.url, /^https:\/\/mai\.example\.com\//);
    assert.equal(request.headers["Ocp-Apim-Subscription-Key"], "mai-key");
    const multipart = Buffer.from(request.bodyBase64, "base64").toString();
    assert.ok(multipart.includes('"model":"MAI-Transcribe-2"'));
    assert.ok(multipart.includes('"locales":["ja"]'));
  }
});


test("saving Settings closes it, while validation errors leave it open", async (t) => {
  const ui = await setup(t);
  ui.element("menu-settings").fire("click");
  await until(() => ui.element("cfg-speech-api-key").value === "invalid");
  ui.element("cfg-question-phrases").value = "duplicate";
  ui.element("cfg-newline-phrases").value = "duplicate";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-status").dataset.error === "true");
  assert.equal(ui.element("settings-overlay").dataset.open, "true");
  ui.element("cfg-newline-phrases").value = "enter";
  ui.element("settings-form").fire("submit");
  await until(() => ui.element("settings-overlay").dataset.open === "false");
});

test("manual recordings are sent even when stopped within two seconds", async (t) => {
  for (const duration of [100, 1999, 2000, 2001]) {
    await t.test(String(duration), async t => {
      const ui = await setup(t, { recordingStep: duration, speech: { apiKey: "corrected" } });
      ui.element("record").fire("click");
      await until(() => ui.element("mode").dataset.recording === "true");
      ui.element("record").fire("click");
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(ui.requests.length, 1);
      assert.equal(ui.element("mode").dataset.recording, "false");
    });
  }
});
