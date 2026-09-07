import assert from "node:assert/strict";
import test from "node:test";
import { createTextEditor } from "../frontend/src/editor.js";

function setup(text = "") {
  const handlers = {};
  const input = {
    value: text, selectionStart: 0, selectionEnd: 0,
    addEventListener(name, callback) { handlers[name] = callback; },
    setSelectionRange(start, end = start) { this.selectionStart = start; this.selectionEnd = end; },
    setRangeText(value, start, end) {
      this.value = this.value.slice(0, start) + value + this.value.slice(end);
      this.setSelectionRange(start + value.length);
    }
  };
  const editor = createTextEditor(input);
  const key = (key, modifiers = {}) => {
    let prevented = false;
    const handled = editor.handleKeydown({ key, ctrlKey: true,
      preventDefault() { prevented = true; }, ...modifiers });
    assert.equal(prevented, handled);
    return handled;
  };
  return { input, editor, key, emit: (name, event = {}) => handlers[name](event) };
}

test("line navigation and select-all match skk-popup", () => {
  const { input, key } = setup("first\n日本語\nlast");
  input.setSelectionRange(7);
  key("a"); assert.equal(input.selectionStart, 6);
  key("e"); assert.equal(input.selectionStart, 9);
  key("o"); assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, input.value.length);
  key("b"); assert.equal(input.selectionEnd, 0);
  key("o"); key("f"); assert.equal(input.selectionStart, input.value.length);
});

test("character navigation never splits a surrogate pair", () => {
  const { input, key } = setup("あ🎤い");
  key("f"); assert.equal(input.selectionStart, 1);
  key("f"); assert.equal(input.selectionStart, 3);
  key("b"); assert.equal(input.selectionStart, 1);
  key("b"); key("b"); assert.equal(input.selectionStart, 0);
});

test("kill to line end joins lines on the next press and can be undone", () => {
  const { input, key } = setup("abc\ndef");
  input.setSelectionRange(1);
  key("k"); assert.equal(input.value, "a\ndef");
  key("k"); assert.equal(input.value, "adef");
  key("z"); assert.equal(input.value, "a\ndef"); assert.equal(input.selectionStart, 1);
  key("z"); assert.equal(input.value, "abc\ndef");
  key("z", { shiftKey: true }); assert.equal(input.value, "a\ndef");
});

test("kill to line start preserves the preceding newline and deletes selections", () => {
  const { input, key, editor } = setup("abc\ndef");
  input.setSelectionRange(6);
  key("u"); assert.equal(input.value, "abc\nf"); assert.equal(input.selectionStart, 4);
  key("u"); assert.equal(input.value, "abc\nf");
  key("z"); assert.equal(input.value, "abc\ndef");
  input.setSelectionRange(1, 5);
  key("k"); assert.equal(input.value, "aef");
  key("z"); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 5);
  key("u"); assert.equal(input.value, "aef");
  editor.reset("\nabc");
  input.setSelectionRange(0);
  key("a"); key("u"); assert.equal(input.selectionStart, 0); assert.equal(input.value, "\nabc");
});

test("native cut/paste, scripted edits and undo share one history", () => {
  const { input, key, emit, editor } = setup("original");
  input.setSelectionRange(0, 8);
  emit("beforeinput", { inputType: "deleteByCut" });
  input.setRangeText("", 0, 8); emit("input");
  emit("beforeinput", { inputType: "insertFromPaste" });
  input.setRangeText("pasted", 0, 0); emit("input");
  key("u"); assert.equal(input.value, "");
  key("z"); assert.equal(input.value, "pasted");
  key("z"); assert.equal(input.value, "");
  key("z"); assert.equal(input.value, "original");
  editor.setText("transcript"); key("z"); assert.equal(input.value, "original");
  editor.reset(); key("z"); assert.equal(input.value, "");
});

test("IME composition is left alone and undone as one edit", () => {
  const { input, key, emit } = setup();
  emit("compositionstart");
  input.value = "に"; emit("input");
  assert.equal(key("a"), false);
  input.value = "日本"; emit("input");
  emit("compositionend"); emit("input");
  key("z"); assert.equal(input.value, "");
  key("y"); assert.equal(input.value, "日本");
});

test("standard clipboard and recording keys are not intercepted", () => {
  const { key } = setup();
  for (const name of ["c", "x", "v", "d", "r", " "]) assert.equal(key(name), false);
  assert.equal(key("a", { altKey: true }), false);
  assert.equal(key("a", { metaKey: true }), false);
  assert.equal(key("a", { isComposing: true }), false);
});
