import assert from "node:assert/strict";
import test from "node:test";
import { createAutoSizer } from "../frontend/src/autosize.js";

test("editor grows for wrapped lines, caps growth, shrinks and leaves overlays alone", async () => {
  const input = { style: { height: "", flex: "" }, clientHeight: 148, scrollHeight: 100,
    scrollTop: 25, getBoundingClientRect: () => ({ height: 150 }) };
  let overlay = false;
  const sizes = [];
  const sizer = createAutoSizer(input, { getMinimum: () => 300, viewportHeight: () => 300,
    isOverlayOpen: () => overlay, resize: async height => { sizes.push(height); } });
  await sizer.fit();
  assert.equal(sizes.at(-1), 300);
  input.scrollHeight = 260;
  await sizer.fit();
  assert.equal(sizes.at(-1), 412);
  input.scrollHeight = 1500;
  await sizer.fit();
  assert.equal(sizes.at(-1), 600);
  input.scrollHeight = 40;
  await sizer.fit();
  assert.equal(sizes.at(-1), 300);
  assert.deepEqual(input.style, { height: "", flex: "" });
  assert.equal(input.scrollTop, 25, "measurement must not scroll the editor");
  overlay = true;
  const count = sizes.length;
  await sizer.fit();
  assert.equal(sizes.length, count);
});

test("a user-configured height above 600 is preserved and resize failures leave editing intact", async () => {
  const input = { style: { height: "", flex: "" }, clientHeight: 648, scrollHeight: 1500,
    scrollTop: 10, getBoundingClientRect: () => ({ height: 650 }) };
  const sizer = createAutoSizer(input, { getMinimum: () => 800, viewportHeight: () => 800,
    isOverlayOpen: () => false, resize: async height => { assert.equal(height, 800); throw Error("unavailable"); } });
  await sizer.fit();
  assert.equal(input.scrollTop, 10);
  assert.deepEqual(input.style, { height: "", flex: "" });
});
