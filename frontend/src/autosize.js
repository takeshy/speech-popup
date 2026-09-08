// Measure wrapped text at the current width without changing the editor's
// selection or scroll position. The native window enforces the screen limit.
export function createAutoSizer(input, { getMinimum, isOverlayOpen, resize, viewportHeight }) {
  let timer;
  let running = false;
  let pending = false;
  async function fit() {
    if (running) { pending = true; return; }
    if (isOverlayOpen() || !input.style || !input.clientHeight) return;
    const scrollTop = input.scrollTop;
    const height = input.style.height;
    const flex = input.style.flex;
    const outerHeight = input.getBoundingClientRect().height;
    const borders = outerHeight - input.clientHeight;
    const chrome = viewportHeight() - outerHeight;
    let naturalHeight;
    try {
      input.style.flex = "0 0 auto";
      input.style.height = "0px";
      naturalHeight = input.scrollHeight + borders;
    } finally {
      input.style.height = height;
      input.style.flex = flex;
      input.scrollTop = scrollTop;
    }
    const minimum = getMinimum();
    const target = Math.ceil(Math.max(minimum, chrome + naturalHeight));
    running = true;
    try {
      await resize(target);
    } catch {
      // Keep the textarea scrollable if the native window cannot resize.
    } finally {
      revealCaret(input);
      running = false;
      if (pending) { pending = false; schedule(); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { void fit(); }, 50);
  }
  return { schedule, fit };
}

// setRangeText/setSelectionRange do not reliably scroll a textarea in WebViews.
// Measure the caret with the same wrapping and typography without changing text
// or selection. Only move enough to reveal the active line, including mid-text edits.
export function revealCaret(input) {
  const doc = input.ownerDocument;
  const view = doc?.defaultView;
  if (!view || !input.clientHeight || !input.clientWidth) return;
  const style = view.getComputedStyle(input);
  const mirror = doc.createElement("div");
  for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
    "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textTransform",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "tabSize", "direction"]) {
    mirror.style[property] = style[property];
  }
  Object.assign(mirror.style, {
    position: "fixed", top: "0", left: "0", visibility: "hidden", pointerEvents: "none",
    boxSizing: "border-box", width: `${input.clientWidth}px`, whiteSpace: "pre-wrap",
    overflowWrap: "break-word", wordBreak: style.wordBreak
  });
  const position = input.selectionDirection === "backward" ? input.selectionStart : input.selectionEnd;
  mirror.textContent = input.value.slice(0, position);
  const marker = doc.createElement("span");
  marker.textContent = input.value.slice(position) || "\u200b";
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    const rect = marker.getClientRects()[0];
    if (!rect) return;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const top = Math.max(0, rect.top - mirror.getBoundingClientRect().top - (lineHeight - rect.height) / 2);
    const bottom = top + lineHeight + parseFloat(style.paddingBottom || "0");
    if (top < input.scrollTop) input.scrollTop = top;
    else if (bottom > input.scrollTop + input.clientHeight) input.scrollTop = bottom - input.clientHeight;
  } finally {
    mirror.remove();
  }
}
