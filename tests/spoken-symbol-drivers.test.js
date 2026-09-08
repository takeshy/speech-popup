import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { speechDraft, convertSpokenSymbol } from "../frontend/src/speech.js";

const load = (file, context, factory) => vm.runInNewContext(
  readFileSync(new URL(`../frontend/src/${file}.js`, import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace(/export /g, "") + `\n${factory};`, context);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("recorder converts question commands on manual stop or silence, including retries", async () => {
  for (const silent of [true, false]) {
    let silence;
    let fail = true;
    let text = "hello";
    const create = load("recorder", {
      t: x => x, speechDraft, AbortController, Blob, performance, setTimeout, clearTimeout,
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
      OfflineAudioContext: class {},
      MediaRecorder: class {
        static isTypeSupported() { return true; }
        state = "inactive";
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          queueMicrotask(() => {
            this.ondataavailable?.({ data: new Blob(["audio"]) });
            void this.onstop?.();
          });
        }
      },
      validateSpeechSettings() {},
      recordingsToWav: async () => new Blob(["wav"]),
      transcribeSpeech: async () => { if (fail) throw Error("retry me"); return "クエスチョン"; },
      watchSpeechSilence: (_stream, _seconds, callback, status) => { silence = callback; status(true); return () => {}; }
    }, "createRecorder");
    const recorder = create({ getSettings: () => ({ silenceSeconds: 1, sendPhrase: "" }),
      getBase: () => text, onInput: value => { text = value; }, onSend() { assert.fail("must not send Enter"); }, onState() {} });
    await recorder.toggle();
    if (silent) silence(); else await recorder.toggle();
    await tick();
    assert.equal(text, "hello");
    assert.equal(recorder.state().retainedCount, 1);
    fail = false;
    await recorder.retry();
    assert.equal(text, "hello?");
    recorder.discard();
  }
});

test("browser preserves punctuation and converts question commands only on final results", async () => {
  let current, text = "";
  const create = load("browser_speech", {
    t: x => x, speechDraft, convertSpokenSymbol,
    navigator: { language: "ja", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    SpeechRecognition: class { constructor() { current = this; } start() {} abort() {} }
  }, "createBrowserRecognizer");
  const recognizer = create({ getSettings: () => ({ language: "ja", silenceSeconds: 0, sendPhrase: "" }),
    getBase: () => text, onInput: value => { text = value; }, onSend() { assert.fail("unexpected send"); }, onState() {} });
  recognizer.toggle();
  await tick();
  const result = (value, isFinal) => Object.assign([{ transcript: value }], { isFinal });
  current.onresult({ results: [result("こんにちは。", true), result("いいですかクエスチョン", false)] });
  assert.equal(text, "こんにちは。いいですかクエスチョン");
  current.onresult({ results: [result("こんにちは。", true), result("いいですかクエスチョン", true)] });
  assert.equal(text, "こんにちは。いいですか?");
  current.onresult({ results: [result("こんにちは。", true), result("いいですかクエスチョン", true)] });
  assert.equal(text, "こんにちは。いいですか?");
  recognizer.stop();
});

test("editing live dictation consumes displayed results so revisions cannot resurrect deleted text", async () => {
  let current, silence;
  let text = "before";
  let writes = 0;
  let sends = 0;
  const create = load("browser_speech", {
    t: x => x, speechDraft, convertSpokenSymbol,
    navigator: { language: "ja", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    SpeechRecognition: class { constructor() { current = this; } start() {} abort() {} },
    watchSpeechSilence: (_stream, _seconds, callback, status) => { silence = callback; status(true); return () => {}; }
  }, "createBrowserRecognizer");
  const recognizer = create({ getSettings: () => ({ language: "ja", silenceSeconds: 1, sendPhrase: "over" }),
    getBase: () => text, onInput: value => { text = value; writes++; }, onSend() { sends++; }, onState() {} });
  recognizer.toggle();
  await tick();
  const result = (value, isFinal = true) => Object.assign([{ transcript: value }], { isFinal });
  text = "edited before the first result";
  current.onresult({ results: [result("heard", false)] });
  assert.equal(text, "edited before the first result heard");
  text = ""; // Ctrl+O, Backspace, cut, or a regular textarea edit.
  current.onresult({ results: [result("heard over")] });
  assert.equal(text, "");
  assert.equal(sends, 0, "an edited-away hypothesis must not trigger send when finalized");
  assert.equal(text, "");
  current.onresult({ results: [result("heard over"), result("new words")] });
  assert.equal(text, "new words");
  text = "corrected words";
  assert.equal(text, "corrected words", "silence must not overwrite edits either");
  const count = writes;
  current.onresult({ results: [result("heard over"), result("new words")] });
  assert.equal(writes, count, "unchanged results must not reset the cursor or undo stack");
  current.onresult({ results: [result("heard over"), result("new words"), result("continue")] });
  assert.equal(text, "corrected words continue");
  recognizer.stop();
});

test("silence converts queued utterances while the microphone and next recording stay active", async (t) => {
  const boundaries = [];
  const replies = [];
  let text = "";
  let streams = 0, trackStops = 0, starts = 0, requests = 0;
  const create = load("recorder", {
    t: x => x, speechDraft, AbortController, Blob, performance, setTimeout, clearTimeout,
    navigator: { mediaDevices: { getUserMedia: async () => {
      streams++;
      return { getTracks: () => [{ stop() { trackStops++; } }] };
    } } },
    OfflineAudioContext: class {},
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      state = "inactive";
      start() { this.state = "recording"; starts++; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["audio"]) });
          void this.onstop?.();
        });
      }
    },
    validateSpeechSettings() {}, recordingsToWav: async () => new Blob(["wav"]),
    transcribeSpeech: () => { requests++; return new Promise(resolve => replies.push(resolve)); },
    watchSpeechSilence: (_stream, _seconds, silence, status, voice) => {
      boundaries.push({ silence, voice }); status(true); return () => {};
    }
  }, "createRecorder");
  const recorder = create({ getSettings: () => ({ silenceSeconds: 1, sendPhrase: "" }),
    getBase: () => text, onInput: value => { text = value; }, onSend() { assert.fail("unexpected send"); }, onState() {} });
  t.after(() => recorder.discard());
  await recorder.toggle();
  boundaries[0].voice();
  boundaries[0].silence();
  await tick();
  assert.equal(recorder.recording(), true);
  assert.equal(starts, 2);
  assert.equal(streams, 1);
  assert.equal(trackStops, 0, "silence must not close the microphone");
  boundaries[1].voice();
  boundaries[1].silence();
  await tick();
  assert.equal(starts, 3, "next utterance records while earlier requests wait");
  assert.equal(requests, 1, "transcriptions must remain ordered");
  text = "edited";
  replies.shift()("hello");
  await tick();
  assert.equal(text, "edited hello");
  assert.equal(requests, 2);
  replies.shift()("。");
  await tick();
  assert.equal(text, "edited hello。");
  assert.equal(recorder.recording(), true);
  await recorder.toggle();
  await tick();
  assert.equal(recorder.busy(), false);
  assert.ok(trackStops > 0, "manual stop closes the microphone");
  assert.equal(requests, 2, "the silent tail is not sent for transcription");
});

test("browser revisions preserve the suffix and cursor moves affect only new segments", async () => {
  let current;
  let text = "left  right", start = 5, end = 5;
  let sent = "";
  const context = () => JSON.stringify([text, start, end]);
  const create = load("browser_speech", {
    t: x => x, speechDraft, convertSpokenSymbol,
    navigator: { language: "en", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    SpeechRecognition: class { constructor() { current = this; } start() {} abort() {} },
    watchSpeechSilence: () => () => {}
  }, "createBrowserRecognizer");
  const recognizer = create({
    getSettings: () => ({ language: "en", silenceSeconds: 0, sendPhrase: "over" }),
    getBase: () => text.slice(0, start), getContext: context, getText: () => text,
    onInput: value => { text = value + text.slice(end); start = end = value.length; },
    onSend: value => { sent = value; }, onState() {}
  });
  recognizer.toggle();
  await tick();
  const result = (value, isFinal = false) => Object.assign([{ transcript: value }], { isFinal });
  current.onresult({ results: [result("hello")] });
  assert.equal(text, "left hello right");
  current.onresult({ results: [result("hello world", true)] });
  assert.equal(text, "left hello world right");
  start = end = 0;
  current.onresult({ results: [result("revised old result", true)] });
  assert.equal(text, "left hello world right", "moving the cursor commits the displayed hypothesis");
  current.onresult({ results: [result("revised old result", true), result("over", true)] });
  assert.equal(sent, "left hello world right", "send at the start still copies the complete text");
  recognizer.stop();
});
