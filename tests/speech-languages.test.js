import assert from "node:assert/strict";
import test from "node:test";
import { speechLanguageCodes, speechLanguageLabel, speechLanguageOptions } from "../frontend/src/speech_languages.js";
import { defaultSendPhrase, initialSendPhrase, sendPhraseLanguage } from "../frontend/src/send_phrases.js";
import { speechDraft } from "../frontend/src/speech.js";

test("service catalogs use their own codes and start other languages with disabled commands", () => {
  for (const endpoint of ["openai", "custom", "whisper-cpp", "azure-mai-transcribe", "gemini-transcribe", "vertex-transcribe"]) {
    const codes = speechLanguageCodes("openai-compatible", endpoint);
    assert.ok(codes.length > 50);
    assert.equal(new Set(codes).size, codes.length);
    for (const code of codes) {
      assert.match(code, /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i);
      assert.ok(speechLanguageLabel(code).includes(code));
      if (!["en", "ja"].includes(sendPhraseLanguage(code))) assert.equal(defaultSendPhrase(code), "", code);
    }
  }
  assert.ok(speechLanguageCodes("openai-compatible", "whisper-cpp").includes("jw"));
  assert.ok(speechLanguageCodes("openai-compatible", "azure-mai-transcribe").includes("fil"));
  assert.ok(!speechLanguageCodes("openai-compatible", "azure-mai-transcribe", "MAI-Transcribe-1.5").includes("yue"));
  assert.match(speechLanguageLabel("fr", "en"), /français/);
  assert.match(speechLanguageLabel("ja", "en"), /日本語/);
  assert.ok(speechLanguageOptions("browser", "openai", "", "fr-CA").some(option => option.value === "fr-CA"));
});

test("phrase language aliases, automatic language, and legacy edits are retained", () => {
  assert.equal(sendPhraseLanguage("auto", "fr-CA"), "fr");
  assert.equal(sendPhraseLanguage("jw"), "jv");
  assert.equal(sendPhraseLanguage("tl"), "fil");
  assert.equal(sendPhraseLanguage("cmn-Hans-CN"), "zh");
  assert.equal(defaultSendPhrase("zh-TW"), "");
  assert.equal(defaultSendPhrase("fr-CA"), "");
  assert.equal(defaultSendPhrase("ja"), "これで終わります");
  assert.equal(defaultSendPhrase("en"), "I'm done speaking");
  assert.equal(initialSendPhrase({ language: "de", sendPhrase: "over, オーバー" }), "");
  assert.equal(initialSendPhrase({ language: "de", sendPhrase: "my command" }), "my command");
  assert.equal(initialSendPhrase({ language: "de", sendPhrase: "" }), "");
  assert.equal(initialSendPhrase({ language: "de", sendPhrase: "old", sendPhraseProfiles: { de: "" } }), "");
});

test("multilingual send commands match whole words or unspaced script endings", () => {
  for (const [code, transcript, result] of [
    ["fr", "bonjour terminé.", "bonjour"],
    ["ru", "привет готово", "привет"],
    ["ar", "مرحبا إرسال؟", "مرحبا"],
    ["hi", "नमस्ते भेजो।", "नमस्ते"],
    ["zh", "你好发送。", "你好"],
    ["th", "สวัสดีส่งข้อความ", "สวัสดี"],
    ["ko", "안녕하세요 전송", "안녕하세요"]
  ]) {
    const phrase = { fr: "terminé", ru: "готово", ar: "إرسال", hi: "भेजो", zh: "发送", th: "ส่งข้อความ", ko: "전송" }[code];
    const draft = speechDraft("", transcript, true, phrase);
    assert.equal(draft.send, true, code);
    assert.equal(draft.text, result, code);
  }
  assert.equal(speechDraft("", "indéterminé", true, "terminé").send, false);
  assert.equal(speechDraft("", "непереготово", true, "готово").send, false);
  assert.equal(speechDraft("", "bonjour terminé", false, "terminé").send, false);
  assert.equal(speechDraft("", "bonjour terminé", true, "").send, false);
});
