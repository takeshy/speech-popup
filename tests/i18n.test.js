import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { t, setLanguage, resolveLanguage, localizeDOM } from "../frontend/src/i18n.js";
import { messages } from "../frontend/src/messages.js";

test("Japanese locales use Japanese; other locales fall back to English", () => {
  for (const locale of ["ja", "ja-JP", "JA_jp"]) assert.equal(resolveLanguage(locale), "ja");
  for (const locale of ["en-US", "fr-FR", "", undefined]) assert.equal(resolveLanguage(locale), "en");
  setLanguage("ja-JP"); assert.equal(t("録音中"), "録音中");
  setLanguage("en-US"); assert.equal(t("録音中"), "Recording");
});

test("translation preserves interpolated user text and placeholder-like content", () => {
  setLanguage("en");
  assert.equal(t("書き起こし: {0}", "日本語 {1} $&"), "Transcription: 日本語 {1} $&");
  assert.equal(t("untranslated system error"), "untranslated system error");
  for (const [source, translation] of Object.entries(messages)) {
    assert.deepEqual(translation.match(/\{\d+\}/g)?.sort() ?? [], source.match(/\{\d+\}/g)?.sort() ?? [], source);
  }
});

test("all literal UI translation calls have an English catalog entry", () => {
  for (const file of ["main", "speech", "recorder", "browser_speech"]) {
    const source = readFileSync(new URL(`../frontend/src/${file}.js`, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bt\(("(?:\\.|[^"\\])*")/g)) {
      const key = JSON.parse(match[1]);
      assert.ok(Object.hasOwn(messages, key), `${file}: ${key}`);
    }
  }
});

test("DOM localization translates labels and attributes without changing textarea data", () => {
  setLanguage("en");
  const nodes = [
    { textContent: "  設定  ", parentElement: { tagName: "LABEL" } },
    { textContent: "設定", parentElement: { tagName: "TEXTAREA" } }
  ];
  const attrs = { title: "メニュー", placeholder: "a user value" };
  const walker = { currentNode: null, nextNode() { this.currentNode = nodes[index++]; return !!this.currentNode; } };
  let index = 0;
  const document = { documentElement: {}, body: {}, createTreeWalker: () => walker,
    querySelectorAll: () => [{ getAttribute: (key) => attrs[key], setAttribute: (key, value) => { attrs[key] = value; } }] };
  localizeDOM(document);
  assert.equal(document.documentElement.lang, "en");
  assert.equal(nodes[0].textContent, "  Settings  ");
  assert.equal(nodes[1].textContent, "設定");
  assert.equal(attrs.title, "Menu");
  assert.equal(attrs.placeholder, "a user value");
});
