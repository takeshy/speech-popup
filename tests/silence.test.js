import assert from "node:assert/strict";
import test from "node:test";
import { createSilenceDetector, createVoiceGate } from "../frontend/src/silence.js";

test("the detector never fires before speech is heard", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  for (let now = 0; now < 10000; now += 100) {
    assert.equal(detect(0, now), false);
  }
});

test("the detector fires after the configured silence following speech", () => {
  const detect = createSilenceDetector(2, { graceMs: 0 });
  // Sustained speech arms the timeout.
  for (let now = 0; now <= 300; now += 100) assert.equal(detect(0.05, now), false);
  assert.equal(detect(0, 400), false);
  // The window is measured from the last audible sample (t = 300).
  assert.equal(detect(0, 2299), false);
  assert.equal(detect(0, 2300), true);
  // Once finished it stays finished.
  assert.equal(detect(0, 5000), false);
});

test("an isolated noise sample does not arm the detector", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  detect(0.05, 0);
  for (let now = 100; now < 8000; now += 100) assert.equal(detect(0, now), false);
});

test("a short word with a quiet gap still triggers transcription after silence", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  assert.equal(detect(0.05, 0), false);
  assert.equal(detect(0, 100), false);
  assert.equal(detect(0.05, 200), false);
  assert.equal(detect(0, 300), false);
  assert.equal(detect(0, 1199), false);
  assert.equal(detect(0, 1200), true);
});

test("separate noise clicks do not accumulate into speech", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  for (let now = 0; now < 5000; now += 100) {
    assert.equal(detect(now % 500 === 0 ? 0.05 : 0, now), false);
  }
});

test("isolated noise after speech does not postpone the silence boundary", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  detect(0.05, 0);
  detect(0.05, 100);
  detect(0, 200);
  // One loud frame occurs during the quiet period, but is not conversation.
  detect(0.05, 700);
  assert.equal(detect(0, 1099), false);
  assert.equal(detect(0, 1100), true);
});

test("seconds = 0 disables the automatic stop", () => {
  const detect = createSilenceDetector(0);
  detect(0.05, 0);
  detect(0.05, 400);
  assert.equal(detect(0, 60000), false);
});

test("the first recording cannot end from silence during its three second grace period", () => {
  const detect = createSilenceDetector(1);
  detect(0.05, 0);
  detect(0.05, 100);
  assert.equal(detect(0, 1100), false);
  assert.equal(detect(0, 2999), false);
  assert.equal(detect(0, 3000), true);
});

test("a noisy room reaches silence once its own level is learned", () => {
  const detect = createSilenceDetector(1, { graceMs: 0 });
  let now = 0;
  let fired = false;
  // Constant room noise, well above the old fixed threshold. With that threshold
  // the quiet period never arrived and the segment never closed; the level of the
  // room is learned within one window instead, and the noise then counts as quiet.
  for (; now < 12000 && !fired; now += 100) fired = detect(0.02, now);
  assert.equal(fired, true);
  assert.ok(now <= 7000, `expected silence within a window and its timeout, fired at ${now} ms`);
});

test("an uneven noisy room does not keep the voice gate open on ordinary fluctuations", () => {
  const gate = createVoiceGate();
  const room = [0.012, 0.018, 0.021, 0.016, 0.019];
  for (let i = 0; i < 100; i++) gate(room[i % room.length]);
  assert.equal(gate(0.021), false);
  assert.equal(gate(0.07), true);
});

test("speech is still heard over a room whose level has been learned", () => {
  const gate = createVoiceGate();
  for (let i = 0; i < 60; i++) gate(0.02);
  assert.equal(gate(0.02), false);
  assert.equal(gate(0.09), true);
  // Hysteresis: a syllable dip stays speech, so words do not split.
  assert.equal(gate(0.05), true);
  assert.equal(gate(0.02), false);
});

test("the gate keeps hearing speech that is barely above a quiet room", () => {
  const gate = createVoiceGate();
  for (let i = 0; i < 60; i++) assert.equal(gate(0.002), false);
  // A soft voice in a quiet room, which a fixed 0.015 threshold would miss.
  assert.equal(gate(0.014), true);
  assert.equal(gate(0.009), true);
  assert.equal(gate(0.001), false);
});
