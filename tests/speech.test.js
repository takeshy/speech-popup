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

test("validateSpeechSettings accepts only OpenAI and Gemini in live mode", () => {
  assert.equal(validateSpeechSettings({ ...baseSettings, provider: "live", endpointType: "openai", apiKey: "key" }),
    "wss://api.openai.com/v1/realtime?intent=transcription");
  assert.equal(validateSpeechSettings({ ...baseSettings, provider: "live", endpointType: "gemini-transcribe", apiKey: "key" }),
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent");
  assert.throws(() => validateSpeechSettings({ ...baseSettings, provider: "live", endpointType: "custom", apiKey: "key" }), /OpenAI.*Gemini/);
  assert.throws(() => validateSpeechSettings({ ...baseSettings, provider: "live", endpointType: "openai", apiKey: "" }), /API Key/);
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

test("question and Enter commands convert on final recognition, without needing silence", () => {
  for (const command of ["クエスチョン", "クエスチョンマーク", "question", "Question", "question mark"]) {
    for (const silence of [true, false]) {
      assert.equal(speechDraft("", `hello ${command}。`, true, "", silence).text, "hello?");
      assert.equal(speechDraft("", command, false, "", silence).text, command);
    }
  }
  assert.equal(speechDraft("", "いいですかクエスチョン。", true, "").text, "いいですか?");
  for (const word of ["まる", "丸", "句点", "くてん", "てん", "読点", "カンマ", "ピリオド",
    "はてな", "改行", "exclamation", "comma", "period", "new line", "disenter", "enters",
    "subquestion", "questions", "クエスチョンについて話す"]) {
    assert.equal(speechDraft("", word, true, "", true).text, word);
  }
  assert.deepEqual(speechDraft("", "hello question over", true, "over", true), { text: "hello question", send: true });
});

test("recognizer punctuation is preserved verbatim", () => {
  for (const text of ["きょうは。", "きょうは。晴れです。", "きょうは。、", "Hello.", "晴れです丸", "句点。"]) {
    assert.equal(speechDraft("", text, true, "").text, text);
  }
  assert.equal(speechDraft("前の入力。", "次の入力。", true, "").text, "前の入力。 次の入力。");
  assert.equal(speechDraft("きょうは。", "、", true, "").text, "きょうは。、");
});

test("Azure MAI sends WAV and enhanced-mode definition with subscription-key authentication", async () => {
  const settings = { ...baseSettings, ...endpointPreset("azure-mai-transcribe"),
    endpointType: "azure-mai-transcribe", baseUrl: "https://resource.cognitiveservices.azure.com/", apiKey: " azure-key " };
  const expectedURL = "https://resource.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15";
  assert.equal(validateSpeechSettings(settings), expectedURL);
  assert.throws(() => validateSpeechSettings({ ...settings, apiKey: " " }), /API Key/);
  assert.throws(() => validateSpeechSettings({ ...settings, model: "" }), /Model/);
  assert.throws(() => validateSpeechSettings({ ...settings, language: "not a tag" }), /BCP-47/);
  for (const language of ["auto", "ja", "en-US"]) {
    const audio = encodeSpeechWav(Float32Array.from([0.1, -0.2]));
    const text = await transcribeSpeech(audio, { ...settings, language }, async (request) => {
      assert.equal(request.url, expectedURL);
      assert.equal(request.method, "POST");
      assert.equal(request.headers["Ocp-Apim-Subscription-Key"], "azure-key");
      assert.equal(request.headers.Authorization, undefined);
      const form = await new Response(Buffer.from(request.bodyBase64, "base64"), { headers: request.headers }).formData();
      assert.deepEqual([...form.keys()].sort(), ["audio", "definition"]);
      assert.deepEqual(await form.get("audio").arrayBuffer(), await audio.arrayBuffer());
      assert.deepEqual(JSON.parse(form.get("definition")), {
        enhancedMode: { enabled: true, model: "MAI-Transcribe-2" },
        ...(language === "auto" ? {} : { locales: [language] })
      });
      return { status: 200, body: JSON.stringify({ combinedPhrases: [{ text: " こんにちは。 " }] }) };
    }, fakeSignal());
    assert.equal(text, "こんにちは。");
  }
  for (const result of [null, {}, { error: "secret" }, { combinedPhrases: [null] }, { combinedPhrases: [{ text: 123 }] }]) {
    await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])), settings,
      async () => ({ status: 200, body: JSON.stringify(result) }), fakeSignal()), /応答を解釈/);
  }
  assert.equal(await transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])), settings,
    async () => ({ status: 200, body: '{"combinedPhrases":[]}' }), fakeSignal()), "");
  await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])), settings,
    async () => ({ status: 401, body: "azure-key" }), fakeSignal()), (error) => {
      assert.match(error.message, /401/);
      assert.doesNotMatch(error.message, /azure-key/);
      return true;
    });
});

test("Azure reports unsupported enhanced-mode endpoints without exposing response contents", async () => {
  const settings = { ...baseSettings, ...endpointPreset("azure-mai-transcribe"),
    endpointType: "azure-mai-transcribe", baseUrl: "https://japaneast.api.cognitive.microsoft.com" };
  const failure = { code: "InvalidRequest", message: "Enhanced mode with model is currently not supported yet." };
  for (const body of [failure, { error: failure }]) {
    await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])), settings,
      async () => ({ status: 400, body: JSON.stringify(body) }), fakeSignal()), /対応リージョン/);
  }
  for (const body of ['not JSON', JSON.stringify({ code: "InvalidRequest", message: "secret transcript sk-test" })]) {
    await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])), settings,
      async () => ({ status: 400, body }), fakeSignal()), (error) => {
        assert.match(error.message, /STT HTTP 400/);
        assert.doesNotMatch(error.message, /secret|sk-test|not JSON|対応リージョン/);
        return true;
      });
  }
});

test("spoken Enter inserts a line break and preserves the preceding punctuation", () => {
  for (const command of ["エンター", "enter", "Enter", "ENTER"]) {
    assert.deepEqual(speechDraft("前の文。", command + "。", true, ""), { text: "前の文。\n", send: false });
    assert.equal(speechDraft("", "前の文。 " + command + "。", true, "").text, "前の文。\n");
    assert.equal(speechDraft("", command, false, "").text, command);
  }
  assert.equal(speechDraft("", "エンターについて話す", true, "").text, "エンターについて話す");
  assert.equal(speechDraft("", "改行", true, "").text, "改行");
  assert.equal(speechDraft("", "new line", true, "").text, "new line");
});


test("Gemini empty successful responses explain that no transcript was returned", async () => {
  for (const content of [undefined, { parts: [] }, { parts: [{}] }, { parts: [{ text: " " }] }]) {
    await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])),
      { ...baseSettings, endpointType: "gemini-transcribe", apiKey: "gem-key" },
      async () => ({ status: 200, body: JSON.stringify({ candidates: [{ finishReason: "STOP", content }] }) }),
      fakeSignal()), /Gemini.*Ctrl\+R/);
  }
});

test("Gemini text can coexist with empty parts and transcription annotations", async () => {
  const text = await transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, endpointType: "gemini-transcribe", apiKey: "gem-key" },
    async () => ({ status: 200, body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: {
      parts: [{}, { text: "こんにちは" }, { audioTranscription: { words: [{ word: "こんにちは" }] } }]
    } }] }) }), fakeSignal());
  assert.equal(text, "こんにちは");
});

test("Gemini malformed parts report the failing field without exposing response data", async () => {
  await assert.rejects(() => transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])),
    { ...baseSettings, endpointType: "gemini-transcribe", apiKey: "gem-key" },
    async () => ({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: { secret: "private" } }] } }] }) }),
    fakeSignal()), error => {
      assert.match(error.message, /Gemini: part.text/);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
});


test("Gemini and Vertex accept the actual audioTranscription.text response", async () => {
  for (const endpointType of ["gemini-transcribe", "vertex-transcribe"]) {
    const text = await transcribeSpeech(encodeSpeechWav(Float32Array.from([0.1])),
      { ...baseSettings, endpointType, apiKey: "gem-key", vertexProjectId: "my-project" },
      async () => ({ status: 200, body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: {
        parts: [{ audioTranscription: { text: "Hello, this is a speech recognition test. " } },
          { audioTranscription: { text: "The weather is sunny today." } }]
      } }] }) }), fakeSignal());
    assert.equal(text, "Hello, this is a speech recognition test. The weather is sunny today.");
  }
});
