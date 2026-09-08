import assert from "node:assert/strict";
import test from "node:test";
import { createSilenceDetector } from "../frontend/src/silence.js";

test("the detector never fires before speech is heard", () => {
  const detect = createSilenceDetector(1);
  for (let now = 0; now < 10000; now += 100) {
    assert.equal(detect(0, now), false);
  }
});

test("the detector fires after the configured silence following speech", () => {
  const detect = createSilenceDetector(2);
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
  const detect = createSilenceDetector(1);
  detect(0.05, 0);
  for (let now = 100; now < 8000; now += 100) assert.equal(detect(0, now), false);
});

test("a short word with a quiet gap still triggers transcription after silence", () => {
  const detect = createSilenceDetector(1);
  assert.equal(detect(0.05, 0), false);
  assert.equal(detect(0, 100), false);
  assert.equal(detect(0.05, 200), false);
  assert.equal(detect(0, 300), false);
  assert.equal(detect(0, 1199), false);
  assert.equal(detect(0, 1200), true);
});

test("separate noise clicks do not accumulate into speech", () => {
  const detect = createSilenceDetector(1);
  for (let now = 0; now < 5000; now += 100) {
    assert.equal(detect(now % 500 === 0 ? 0.05 : 0, now), false);
  }
});

test("seconds = 0 disables the automatic stop", () => {
  const detect = createSilenceDetector(0);
  detect(0.05, 0);
  detect(0.05, 400);
  assert.equal(detect(0, 60000), false);
});
