import assert from "node:assert/strict";
import test from "node:test";
import { defaultSpeechCommands, speechCommandsFor } from "../frontend/src/speech_commands.js";
import { speechDraft, convertSpokenSymbol } from "../frontend/src/speech.js";

test("only Japanese and English command defaults exist; empty overrides disable them", () => {
  assert.match(defaultSpeechCommands("ja-JP").question, /クエスチョン/);
  assert.equal(defaultSpeechCommands("en-GB").newline, "enter");
  assert.deepEqual(defaultSpeechCommands("es"), { question: "", newline: "", exclamation: "" });
  const commands = speechCommandsFor({ language: "en", questionPhrases: { en: "" }, newlinePhrases: { en: "next paragraph" } });
  assert.equal(convertSpokenSymbol("hello question", true, commands), "hello question");
  assert.equal(convertSpokenSymbol("hello. next paragraph.", true, commands), "hello.\n");
});

test("custom multi-word phrases match literally only at the end, preserving text", () => {
  const commands = { question: "signo de pregunta, really?", newline: "se acabo, se acabó" };
  assert.equal(convertSpokenSymbol("hola signo de pregunta.", true, commands), "hola?");
  assert.equal(convertSpokenSymbol("hola. se acabó.", true, commands), "hola.\n");
  assert.equal(convertSpokenSymbol("se acabo la reunión", true, commands), "se acabo la reunión");
  assert.equal(convertSpokenSymbol("reallyX", true, commands), "reallyX");
  assert.equal(convertSpokenSymbol("hello really?", true, commands), "hello?");
  assert.equal(convertSpokenSymbol("se acabó", false, commands), "se acabó");
  const sent = speechDraft("", "hola se acabó.", true, "se acabo, se acabó", false, false, commands);
  assert.deepEqual(sent, { text: "hola", send: true });
});

test("exclamation has one default alias per language and remains configurable", () => {
  const ja = defaultSpeechCommands("ja");
  const en = defaultSpeechCommands("en");
  assert.equal(ja.exclamation, "びっくり");
  assert.equal(en.exclamation, "exclamation");
  assert.equal(convertSpokenSymbol("すごい。びっくり。", true, ja), "すごい!");
  assert.equal(convertSpokenSymbol("エクスクラメーションマーク", true, ja), "エクスクラメーションマーク");
  assert.equal(convertSpokenSymbol("great exclamation.", true, en), "great!");
  const custom = speechCommandsFor({ language: "es", exclamationPhrases: { es: "así es" } });
  assert.equal(convertSpokenSymbol("hola así es.", true, custom), "hola!");
  assert.equal(convertSpokenSymbol("así es", false, custom), "así es");
  assert.equal(convertSpokenSymbol("space", true, en), "space");
  assert.equal(convertSpokenSymbol("hyphen", true, en), "hyphen");
  assert.equal(convertSpokenSymbol("スペース", true, ja), "スペース");
  assert.equal(convertSpokenSymbol("ハイフン", true, ja), "ハイフン");
});

test("question and exclamation replace preceding Japanese full stops across utterances", () => {
  const commands = defaultSpeechCommands("ja");
  for (const [phrase, symbol] of [["クエスチョン", "?"], ["びっくり", "!"]]) {
    assert.equal(speechDraft("前の文。次の文。", phrase, true, "", false, false, commands).text, "前の文。次の文" + symbol);
    assert.equal(speechDraft("", "次の文。" + phrase, true, "", false, false, commands).text, "次の文" + symbol);
  }
  for (const symbol of ["?", "!", "？", "！"]) {
    assert.equal(speechDraft("", "前の文。次の文。 " + symbol, true, "").text, "前の文。次の文" + symbol);
    assert.equal(speechDraft("次の文。 ", " " + symbol, true, "").text, "次の文" + symbol);
    assert.equal(speechDraft("次の文。\n", symbol, true, "").text, "次の文。\n" + symbol);
    assert.equal(speechDraft("次の文。", symbol, false, "").text, "次の文。" + symbol);
    assert.equal(speechDraft("次の文。", symbol, true, "", false, true).text, "次の文" + symbol);
  }
});

test("sentence-ending full stops yield to question and exclamation in other languages", () => {
  for (const stop of [".", "．", "。", "۔", "।", "॥", "։"]) {
    for (const symbol of ["!", "?", "！", "？", "؟"]) {
      const before = "first" + stop + " last";
      assert.equal(speechDraft(before + stop, symbol, true, "").text, before + symbol);
      assert.equal(speechDraft("", before + stop + " " + symbol, true, "").text, before + symbol);
      assert.equal(speechDraft(before + stop + "\n", symbol, true, "").text, before + stop + "\n" + symbol);
    }
    assert.equal(convertSpokenSymbol("hello" + stop + " question", true, defaultSpeechCommands("en")), "hello?");
    assert.equal(convertSpokenSymbol("hello" + stop + " exclamation", true, defaultSpeechCommands("en")), "hello!");
  }
  assert.equal(speechDraft("hello.", "world.", true, "").text, "hello. world.");
  assert.equal(speechDraft("hello?", "!", true, "").text, "hello?!");
});
