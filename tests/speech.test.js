import assert from "node:assert/strict";
import test from "node:test";
import { setLanguage } from "../frontend/src/i18n.js";
setLanguage("ja");
import {
  combineSpeechWavs,
  encodeSpeechWav,
  endpointPreset,
  isGoogleEndpoint,
  speechDraft,
  transcribeSpeech,
  transcriptionURL,
  validateSpeechSettings
} from "../frontend/src/speech.js";

const baseSettings = {
  provider: "openai-compatible",
  endpointType: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  model: "whisper-1",
  language: "auto",
  silenceSeconds: 3,
  sendPhrase: "over, オーバー",
  vertexProjectId: ""
};

test("transcriptionURL appends the per-service path", () => {
  assert.equal(
    transcriptionURL("https://api.openai.com/v1", "openai"),
    "https://api.openai.com/v1/audio/transcriptions"
  );
  assert.equal(
    transcriptionURL("http://127.0.0.1:8080/", "whisper-cpp"),
    "http://127.0.0.1:8080/inference"
  );
  assert.equal(
    transcriptionURL("", "gemini-transcribe"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent"
  );
  assert.equal(
    transcriptionURL("", "vertex-transcribe", "my-project"),
    "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-3.5-transcribe-preview:generateContent"
  );
});

test("transcriptionURL rejects URLs that could leak the API key", () => {
  assert.throws(() => transcriptionURL("https://user:pw@example.com/v1", "custom"));
  assert.throws(() => transcriptionURL("https://example.com/v1?token=x", "custom"));
  assert.throws(() => transcriptionURL("ftp://example.com/v1", "custom"));
  assert.throws(() => transcriptionURL("", "vertex-transcribe", "bad project"));
});

test("isGoogleEndpoint and endpointPreset stay in step", () => {
  assert.equal(isGoogleEndpoint("gemini-transcribe"), true);
  assert.equal(isGoogleEndpoint("vertex-transcribe"), true);
  assert.equal(isGoogleEndpoint("whisper-cpp"), false);
  assert.equal(endpointPreset("whisper-cpp").baseUrl, "http://127.0.0.1:8080");
  assert.equal(endpointPreset("openai").model, "whisper-1");
});

test("speechDraft appends with a separating space", () => {
  assert.deepEqual(speechDraft("", "こんにちは", true, "over"), { text: "こんにちは", send: false });
  assert.deepEqual(speechDraft("hello", "world", true, "over"), { text: "hello world", send: false });
  assert.deepEqual(speechDraft("hello ", "world", true, "over"), { text: "hello world", send: false });
});

test("speechDraft strips a trailing send phrase only when final", () => {
  assert.deepEqual(speechDraft("", "送ります オーバー", true, "over, オーバー"), {
    text: "送ります",
    send: true
  });
  assert.deepEqual(speechDraft("", "send it over.", true, "over, オーバー"), {
    text: "send it",
    send: true
  });
  // Interim results must never trigger the send.
  assert.equal(speechDraft("", "send it over", false, "over").send, false);
  // A word merely containing the phrase does not send.
  assert.equal(speechDraft("", "the leftover", true, "over").send, false);
  // An empty phrase list disables the feature entirely.
  assert.equal(speechDraft("", "over", true, "").send, false);
});

test("validateSpeechSettings reports what is missing", () => {
  assert.doesNotThrow(() => validateSpeechSettings(baseSettings));
  assert.throws(() => validateSpeechSettings({ ...baseSettings, model: "" }), /Model/);
  // whisper.cpp names no model.
  assert.doesNotThrow(() => validateSpeechSettings({
    ...baseSettings,
    endpointType: "whisper-cpp",
    baseUrl: "http://127.0.0.1:8080",
    model: ""
  }));
  assert.throws(() => validateSpeechSettings({
    ...baseSettings,
    endpointType: "gemini-transcribe",
    apiKey: ""
  }), /API Key/);
  assert.throws(() => validateSpeechSettings({
    ...baseSettings,
    endpointType: "gemini-transcribe",
    language: "not a tag"
  }), /BCP-47/);
});

test("encodeSpeechWav writes a 16 kHz mono header", async () => {
  const wav = encodeSpeechWav(Float32Array.from([0, 1, -1, 0.5]));
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(view.byteLength, 44 + 4 * 2);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(44 + 2, true), 32767);
  assert.equal(view.getInt16(44 + 4, true), -32768);
});

test("combineSpeechWavs concatenates PCM and fixes the sizes", async () => {
  const first = encodeSpeechWav(Float32Array.from([0.1, 0.2]));
  const second = encodeSpeechWav(Float32Array.from([0.3]));
  const combined = await combineSpeechWavs([first, second]);
  const view = new DataView(await combined.arrayBuffer());
  assert.equal(view.byteLength, 44 + 3 * 2);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getUint32(4, true), view.byteLength - 8);
  await assert.rejects(() => combineSpeechWavs([]), /空/);
});

function fakeSignal() {
  return { throwIfAborted() {} };
}

test("transcribeSpeech posts multipart form data with the bearer key", async () => {
  const seen = [];
  const text = await transcribeSpeech(
    encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, language: "ja" },
    async (request) => {
      seen.push(request);
      return { status: 200, headers: {}, body: JSON.stringify({ text: " こんにちは " }), bodyBase64: "" };
    },
    fakeSignal()
  );
  assert.equal(text, "こんにちは");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(seen[0].headers.Authorization, "Bearer sk-test");
  assert.match(seen[0].headers["Content-Type"], /^multipart\/form-data; boundary=/);
  const body = Buffer.from(seen[0].bodyBase64, "base64").toString("binary");
  assert.match(body, /name="model"/);
  assert.match(body, /whisper-1/);
  assert.match(body, /name="language"/);
});

test("transcribeSpeech omits the model and forces json for whisper.cpp", async () => {
  let request;
  await transcribeSpeech(
    encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, endpointType: "whisper-cpp", baseUrl: "http://127.0.0.1:8080", apiKey: "", model: "" },
    async (r) => {
      request = r;
      return { status: 200, headers: {}, body: JSON.stringify({ text: "hi" }), bodyBase64: "" };
    },
    fakeSignal()
  );
  assert.equal(request.url, "http://127.0.0.1:8080/inference");
  assert.equal(request.headers.Authorization, undefined);
  const body = Buffer.from(request.bodyBase64, "base64").toString("binary");
  assert.doesNotMatch(body, /name="model"/);
  assert.match(body, /name="response_format"[\s\S]*json/);
  assert.match(body, /name="language"[\s\S]*auto/);
});

test("transcribeSpeech treats [BLANK_AUDIO] as no speech", async () => {
  const text = await transcribeSpeech(
    encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, endpointType: "whisper-cpp", baseUrl: "http://127.0.0.1:8080", model: "" },
    async () => ({ status: 200, headers: {}, body: JSON.stringify({ text: "[BLANK_AUDIO]" }), bodyBase64: "" }),
    fakeSignal()
  );
  assert.equal(text, "");
});

test("transcribeSpeech sends Gemini inline audio with the API key header", async () => {
  let request;
  const text = await transcribeSpeech(
    encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, endpointType: "gemini-transcribe", apiKey: "gem-key", language: "ja" },
    async (r) => {
      request = r;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "おはよう" }] } }]
        }),
        bodyBase64: ""
      };
    },
    fakeSignal()
  );
  assert.equal(text, "おはよう");
  assert.equal(request.headers["x-goog-api-key"], "gem-key");
  const payload = JSON.parse(Buffer.from(request.bodyBase64, "base64").toString("utf8"));
  assert.equal(payload.contents[0].parts[0].inlineData.mimeType, "audio/wav");
  assert.deepEqual(payload.generationConfig.audioTranscriptionConfig.languageCodes, ["ja-JP"]);
});

test("transcribeSpeech never surfaces a server error body", async () => {
  await assert.rejects(
    () => transcribeSpeech(
      encodeSpeechWav(Float32Array.from([0.1])),
      baseSettings,
      async () => ({ status: 401, headers: {}, body: "sk-leaked-key is invalid", bodyBase64: "" }),
      fakeSignal()
    ),
    (error) => {
      assert.match(error.message, /STT HTTP 401/);
      assert.doesNotMatch(error.message, /sk-leaked-key/);
      return true;
    }
  );
});

test("transcribeSpeech rejects a truncated Gemini candidate", async () => {
  await assert.rejects(
    () => transcribeSpeech(
      encodeSpeechWav(Float32Array.from([0.1])),
      { ...baseSettings, endpointType: "gemini-transcribe", apiKey: "gem-key" },
      async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "途中" }] } }] }),
        bodyBase64: ""
      }),
      fakeSignal()
    ),
    /打ち切/
  );
});

test("spoken punctuation and Enter convert only after final silence", () => {
  for (const [name, symbol] of [["てん", "、"], ["まる", "。"], ["カンマ", ","], ["コンマ", ","], ["ピリオド", "."], ["はてな", "?"], ["クエスチョンマーク", "?"], ["クエスチョン", "?"], ["びっくりマーク", "!"], ["エクスクラメーション", "!"], ["エクスクラメーションマーク", "!"], ["exclamation", "!"], ["Exclamation", "!"], ["exclamation mark", "!"], ["改行", "\n"], ["エンター", "\n"], ["Enter", "\n"], ["new line", "\n"], ["comma", ","], ["period", "."], ["question mark", "?"], ["question", "?"], ["Question", "?"], ["句点", "。"], ["読点", "、"]]) {
    assert.equal(speechDraft("", `hello ${name}。`, true, "", true).text, `hello${symbol}`);
    assert.equal(speechDraft("hello", name, true, "", true).text, `hello${symbol}`);
    assert.equal(speechDraft("", name, false, "", true).text, name);
    assert.equal(speechDraft("", name, true, "", false).text, name);
  }
  assert.equal(speechDraft("", "いいですかクエスチョン。", true, "", true).text, "いいですか?");
  assert.equal(speechDraft("", "クエスチョンについて話す", true, "", true).text, "クエスチョンについて話す");
  assert.equal(speechDraft("", "カンマについて話す", true, "", true).text, "カンマについて話す");
  assert.equal(speechDraft("", "会議が始まる", true, "", true).text, "会議が始まる");
  assert.equal(speechDraft("", "すごいエクスクラメーション。", true, "", true).text, "すごい!");
  assert.equal(speechDraft("", "エクスクラメーションについて話す", true, "", true).text, "エクスクラメーションについて話す");
  assert.equal(speechDraft("", "exclamation is a word", true, "", true).text, "exclamation is a word");
  assert.equal(speechDraft("", "exclamations", true, "", true).text, "exclamations");
  assert.equal(speechDraft("", "subexclamation", true, "", true).text, "subexclamation");
  assert.equal(speechDraft("", "subquestion", true, "", true).text, "subquestion");
  assert.equal(speechDraft("", "questions", true, "", true).text, "questions");
  assert.equal(speechDraft("", "disenter", true, "", true).text, "disenter");
  assert.equal(speechDraft("hello\n", "world", true, "", true).text, "hello\nworld");
  assert.equal(speechDraft("hello\n", "改行", true, "", true).text, "hello\n\n");
  assert.deepEqual(speechDraft("", "hello 改行 over", true, "over", true), { text: "hello 改行", send: true });
});

test("Japanese automatic full stops yield to explicit punctuation", () => {
  assert.equal(speechDraft("", "きょうは。てん。", true, "", true).text, "きょうは、");
  assert.equal(speechDraft("", "きょうは。、", true, "", true).text, "きょうは、");
  assert.equal(speechDraft("きょうは。", "てん", true, "", true).text, "きょうは、");
  assert.equal(speechDraft("", "きょうは。", true, "").text, "きょうは");
  assert.equal(speechDraft("", "きょうは。", false, "").text, "きょうは。");
  assert.equal(speechDraft("", "きょうは。まる。", true, "", true).text, "きょうは。");
  assert.equal(speechDraft("", "まる。", true, "", true).text, "。");
  assert.equal(speechDraft("", "きょうは。晴れです。", true, "").text, "きょうは。晴れです");
  assert.equal(speechDraft("", "Hello.", true, "").text, "Hello.");
  assert.equal(speechDraft("前の入力。", "次の入力。", true, "").text, "前の入力。 次の入力");
});
