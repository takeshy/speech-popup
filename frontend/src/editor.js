// Textarea editing matching skk-popup's committed-text shortcuts. Keep native
// typing/copy/cut/paste, but share undo across those edits and scripted edits.
export function createTextEditor(input, onChange = () => {}) {
  const undo = [];
  const redo = [];
  let pending = null;
  let composing = false;
  const snapshot = () => ({ text: input.value, start: input.selectionStart, end: input.selectionEnd });
  let previous = snapshot();

  function remember(before) {
    if (before.text === input.value) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }

  function changed() {
    previous = snapshot();
    onChange();
  }

  function restore(from, to) {
    const entry = from.pop();
    if (!entry) return;
    to.push(snapshot());
    input.value = entry.text;
    input.setSelectionRange(entry.start, entry.end);
    pending = null;
    changed();
  }

  function replace(start, end, text) {
    const before = snapshot();
    input.setRangeText(text, start, end, "end");
    remember(before);
    changed();
  }

  input.addEventListener("compositionstart", () => {
    pending = snapshot();
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    remember(pending ?? previous);
    pending = null;
    changed();
  });
  input.addEventListener("beforeinput", (event) => {
    if (composing || event.isComposing) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      if (event.inputType === "historyUndo") restore(undo, redo);
      else restore(redo, undo);
      return;
    }
    pending = snapshot();
  });
  input.addEventListener("input", () => {
    if (composing) { onChange(); return; }
    remember(pending ?? previous);
    pending = null;
    changed();
  });

  function handleKeydown(event) {
    if (composing || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey) return false;
    const key = (event.key ?? "").toLowerCase();
    if (!"oaefbkuzy".includes(key) || key.length !== 1) return false;
    event.preventDefault();
    if (key === "z") {
      if (event.shiftKey) restore(redo, undo);
      else restore(undo, redo);
      return true;
    }
    if (key === "y") { restore(redo, undo); return true; }
    const { value: text, selectionStart: start, selectionEnd: end } = input;
    const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const newline = text.indexOf("\n", start);
    const lineEnd = newline < 0 ? text.length : newline;
    const move = (pos) => input.setSelectionRange(pos, pos);
    if (key === "o") input.setSelectionRange(0, text.length);
    else if (key === "a") move(lineStart);
    else if (key === "e") move(lineEnd);
    else if (key === "f") {
      move(start !== end ? end : Math.min(text.length, end + (text.codePointAt(end) > 0xffff ? 2 : 1)));
    } else if (key === "b") {
      const last = text.charCodeAt(start - 1);
      const before = text.charCodeAt(start - 2);
      const pair = last >= 0xdc00 && last <= 0xdfff && before >= 0xd800 && before <= 0xdbff;
      move(start !== end ? start : Math.max(0, start - (pair ? 2 : 1)));
    } else if (start !== end) replace(start, end, "");
    else if (key === "k") replace(start, lineEnd === start ? Math.min(text.length, start + 1) : lineEnd, "");
    else if (key === "u") replace(lineStart, start, "");
    return true;
  }

  return {
    handleKeydown,
    setText(text) {
      const before = snapshot();
      input.value = text;
      input.setSelectionRange(input.value.length, input.value.length);
      remember(before);
      pending = null;
      changed();
    },
    reset(text = "") {
      input.value = text;
      input.setSelectionRange(input.value.length, input.value.length);
      undo.length = redo.length = 0;
      pending = null;
      changed();
    }
  };
}
