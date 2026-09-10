// Capture microphone samples as provider-sized mono PCM16 chunks. Live APIs
// require raw PCM, unlike the record-then-upload path which sends WAV files.

import { createVoiceGate } from "./silence.js";

export function resamplePCM16(input, inputRate, outputRate) {
  if (!input.length || inputRate <= 0 || outputRate <= 0) return new Int16Array();
  const length = Math.max(1, Math.floor(input.length * outputRate / inputRate));
  const output = new Int16Array(length);
  const scale = inputRate / outputRate;
  for (let i = 0; i < length; i++) {
    const position = i * scale;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    const sample = input[left] + (input[right] - input[left]) * fraction;
    const value = Math.max(-1, Math.min(1, sample));
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}

export function pcm16ToBase64(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export async function createPCMCapture(stream, outputRate, onChunk, onError) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("AudioContext is unavailable");
  const context = new Context();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  let stopped = false;
  let pending = Promise.resolve();
  const voiceGate = createVoiceGate();
  let firstVoiceAt = null;
  let lastVoiceAt = null;
  let heardVoice = false;
  processor.onaudioprocess = event => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const rms = Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length);
    if (voiceGate(rms)) {
      const now = performance.now();
      if (firstVoiceAt === null || lastVoiceAt === null || now - lastVoiceAt > 300) firstVoiceAt = now;
      if (now - firstVoiceAt >= 50) heardVoice = true;
      lastVoiceAt = now;
    }
    const encoded = pcm16ToBase64(resamplePCM16(input, context.sampleRate, outputRate));
    pending = pending.then(() => onChunk(encoded)).catch(error => {
      stopped = true;
      onError(error);
    });
  };
  return {
    heardVoice: () => heardVoice,
    async stop() {
      if (!stopped) {
        stopped = true;
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        mute.disconnect();
      }
      await pending;
      await context.close();
    }
  };
}
