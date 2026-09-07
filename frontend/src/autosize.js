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
    const target = Math.ceil(Math.max(minimum, Math.min(Math.max(minimum, 600), chrome + naturalHeight)));
    running = true;
    try {
      await resize(target);
    } catch {
      // Keep the textarea scrollable if the native window cannot resize.
    } finally {
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
