import assert from "node:assert/strict";
import test from "node:test";
import { pcm16ToBase64, resamplePCM16 } from "../frontend/src/pcm_capture.js";

test("resamplePCM16 converts float audio to the requested PCM rate", () => {
  const result = resamplePCM16(Float32Array.from([-1, -0.5, 0, 0.5, 1, 0]), 48000, 24000);
  assert.deepEqual([...result], [-32768, 0, 32767]);
});

test("pcm16ToBase64 preserves little-endian PCM bytes", () => {
  const encoded = pcm16ToBase64(Int16Array.from([1, -2]));
  assert.deepEqual([...Buffer.from(encoded, "base64")], [1, 0, 254, 255]);
});
