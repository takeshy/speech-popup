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
  // 300 ms of audible input arms it (250 ms minimum).
  for (let now = 0; now <= 300; now += 100) assert.equal(detect(0.05, now), false);
  assert.equal(detect(0, 400), false);
  // The window is measured from the last audible sample (t = 300).
  assert.equal(detect(0, 2299), false);
  assert.equal(detect(0, 2300), true);
  // Once finished it stays finished.
  assert.equal(detect(0, 5000), false);
});

test("a blip shorter than 250 ms does not arm the detector", () => {
  const detect = createSilenceDetector(1);
  detect(0.05, 0);
  detect(0.05, 100);
  for (let now = 200; now < 8000; now += 100) assert.equal(detect(0, now), false);
});

test("seconds = 0 disables the automatic stop", () => {
  const detect = createSilenceDetector(0);
  detect(0.05, 0);
  detect(0.05, 400);
  assert.equal(detect(0, 60000), false);
});
