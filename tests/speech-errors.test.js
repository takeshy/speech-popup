import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRecorder } from "../frontend/src/recorder.js";
import { createLiveRecognizer } from "../frontend/src/live_recognizer.js";
import { createBrowserRecognizer } from "../frontend/src/browser_speech.js";
import { speechErrorMessage } from "../frontend/src/speech_errors.js";
import { getLanguage, setLanguage } from "../frontend/src/i18n.js";

const details = {
  ja: {
    NotFoundError: "マイクが見つかりません。マイクを接続し、OSの入力設定で有効になっているか確認してください。",
    OverconstrainedError: "マイクが見つからないか、使用できません。マイクの接続とOSの入力設定を確認してください。",
    NotReadableError: "マイクを使用できません。他のアプリで使用中でないか、OSの入力設定を確認してください。",
    NotAllowedError: "マイクの使用が許可されていません。"
  },
  en: {
    NotFoundError: "No microphone was found. Connect a microphone and make sure it is enabled in your system's input settings.",
    OverconstrainedError: "No usable microphone was found. Check your microphone connection and your system's input settings.",
    NotReadableError: "Cannot use the microphone. Check whether another app is using it and review your system's input settings.",
    NotAllowedError: "Microphone permission was denied."
  }
};

test("microphone failures show localized guidance in all recognition modes", async t => {
  const originalLanguage = getLanguage();
  t.after(() => setLanguage(originalLanguage));
  let failure, requests = 0, starts = 0;
  const globals = {
    navigator: { mediaDevices: { getUserMedia: async constraints => {
      assert.deepEqual(constraints, { audio: true });
      requests++;
      throw failure;
    } } },
    AudioContext: class {},
    OfflineAudioContext: class {},
    MediaRecorder: class { constructor() { starts++; } },
    SpeechRecognition: class { start() { starts++; } abort() {} }
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const modes = [
    { name: "live", create: createLiveRecognizer,
      prefix: { ja: "ライブ書き起こしを開始できません: ", en: "Could not start live transcription: " } },
    { name: "recorded", create: createRecorder,
      prefix: { ja: "録音を開始できません: ", en: "Cannot start recording: " } },
    { name: "browser", create: createBrowserRecognizer,
      prefix: { ja: "音声認識を開始できません: ", en: "Cannot start speech recognition: " } }
  ];
  for (const language of ["ja", "en"]) {
    setLanguage(language);
    for (const mode of modes) {
      for (const name of Object.keys(details[language])) {
        await t.test(`${mode.name}: ${language}: ${name}`, async () => {
          // OverconstrainedError is not reliably an Error instance in WebViews.
          failure = name === "OverconstrainedError"
            ? { name, message: "Invalid constraint", constraint: "" }
            : new DOMException("", name);
          const previousRequests = requests;
          const engine = mode.create({
            getSettings: () => ({ provider: mode.name === "live" ? "live" : "openai",
              endpointType: "openai", apiKey: "test", language: "auto",
              baseUrl: "https://api.openai.com/v1", model: "whisper-1" }),
            getBase: () => "", onInput() { assert.fail("unexpected transcript"); },
            onState() {}, onSend() { assert.fail("unexpected send"); },
            liveTransport: { start: async () => { starts++; }, stop: async () => {}, onEvent() {} }
          });
          await engine.toggle();
          assert.equal(requests, previousRequests + 1);
          assert.equal(engine.state().status, "idle");
          assert.equal(engine.state().meterStream, null);
          assert.equal(engine.state().error, mode.prefix[language] + details[language][name]);
          assert.equal(starts, 0, "a microphone failure must prevent recording or provider startup");
          await engine.discard();
        });
      }
    }
  }
});

test("speech error formatting handles foreign exceptions and preserves other error details", t => {
  const originalLanguage = getLanguage();
  t.after(() => setLanguage(originalLanguage));
  setLanguage("en");
  const foreignError = vm.runInNewContext('Object.assign(new Error("Invalid constraint"), { name: "OverconstrainedError" })');
  assert.equal(foreignError instanceof Error, false);
  assert.equal(speechErrorMessage(foreignError), details.en.OverconstrainedError);
  assert.equal(speechErrorMessage(new Error("API request failed (503)")), "API request failed (503)");
  assert.equal(speechErrorMessage({ name: "UnknownError", message: "provider detail" }), "provider detail");
  assert.equal(speechErrorMessage({ name: "UnknownError", message: "" }), "UnknownError");
  assert.equal(speechErrorMessage(new DOMException("", "AbortError")), "Canceled.");
  assert.equal(speechErrorMessage("connection closed"), "connection closed");
  assert.equal(speechErrorMessage(null), "null");
  assert.equal(speechErrorMessage(undefined), "undefined");
});
