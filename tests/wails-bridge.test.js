import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Wails bridge exposes the transcript copy method used by the UI", () => {
  const bridge = readFileSync(new URL("../frontend/src/wails_bridge.js", import.meta.url), "utf8");
  assert.match(bridge, /CopyTranscript:\s*\(text\)\s*=>\s*call\("CopyTranscript", text\)/);
  for (const method of ["StartLiveSpeech", "SendLiveSpeechAudio", "FinishLiveSpeech", "StopLiveSpeech"]) {
    assert.match(bridge, new RegExp(`${method}:.*call\\("${method}"`));
  }
});
