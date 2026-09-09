import assert from "node:assert/strict";
import test from "node:test";
import { applyReplacementRules, parseReplacementRules } from "../frontend/src/replacements.js";

test("a rule is a spoken phrase and the text it becomes", () => {
  assert.deepEqual(parseReplacementRules("日記書いて => /daily"), [{ from: "日記書いて", to: "/daily" }]);
  // Blank lines, comments and half-written lines are not rules.
  assert.deepEqual(parseReplacementRules("\n# comment\n日記書いて\n"), []);
  // A full-width or plain arrow reads the same, and spacing is free.
  assert.deepEqual(parseReplacementRules("日記書いて→/daily\n議事録  ⇒  /minutes"), [
    { from: "日記書いて", to: "/daily" },
    { from: "議事録", to: "/minutes" },
  ]);
  // An empty replacement deletes the phrase; an arrow in the text survives.
  assert.deepEqual(parseReplacementRules("えーと =>\nやじるし => a => b"), [
    { from: "えーと", to: "" },
    { from: "やじるし", to: "a => b" },
  ]);
});

test("the spoken sentence becomes the command, with the rest of the dictation kept", () => {
  const rules = parseReplacementRules("日記書いて => /daily");
  assert.equal(applyReplacementRules("日記書いて", rules), "/daily");
  assert.equal(applyReplacementRules("日記書いて 今日は雨だった", rules), "/daily 今日は雨だった");
  assert.equal(applyReplacementRules("会議のメモ", rules), "会議のメモ");
});

test("the longest rule wins and Latin phrases match whole words only", () => {
  const rules = parseReplacementRules("daily note => /daily\ndaily => /d\nnote => /n");
  assert.equal(applyReplacementRules("open daily note now", rules), "open /daily now");
  // "note" must not fire inside "notebook", nor "daily" inside "dailygrind".
  assert.equal(applyReplacementRules("my notebook and dailygrind", rules), "my notebook and dailygrind");
  // Recognizer capitalization is not the user's.
  assert.equal(applyReplacementRules("Daily Note", rules), "/daily");
});

test("every occurrence is replaced", () => {
  const rules = parseReplacementRules("かいぎょう => \n");
  assert.equal(applyReplacementRules("あかいぎょうさかいぎょう", rules), "あさ");
});

test("punctuation the recognizer adds after the phrase does not survive the rule", () => {
  const rules = parseReplacementRules("インフォグラフィック => /infographic\n日記書いて => /daily\nえーと =>");
  // A phrase spoken as a sentence would otherwise leave "/infographic。".
  assert.equal(applyReplacementRules("インフォグラフィック。", rules), "/infographic");
  assert.equal(applyReplacementRules("インフォグラフィック！", rules), "/infographic");
  // The dictation that follows stays readable, with one separator.
  assert.equal(applyReplacementRules("日記書いて。今日は雨だった", rules), "/daily 今日は雨だった");
  assert.equal(applyReplacementRules("日記書いて 今日は雨だった", rules), "/daily 今日は雨だった");
  // A deletion takes the punctuation with it.
  assert.equal(applyReplacementRules("えーと、今日は雨", rules), "今日は雨");
  // Text that matches nothing keeps every mark it arrived with.
  assert.equal(applyReplacementRules("会議のメモ。", rules), "会議のメモ。");
});

test("a sentence replacement keeps its own punctuation", () => {
  const rules = parseReplacementRules("日記書いて => 今日の日記を書いて。\\n見出しは日付。");
  assert.equal(applyReplacementRules("日記書いて。", rules), "今日の日記を書いて。\n見出しは日付。");
  assert.equal(applyReplacementRules("日記書いて。あと天気も", rules), "今日の日記を書いて。\n見出しは日付。 あと天気も");
});
