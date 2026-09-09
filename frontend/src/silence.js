// Speech boundaries detected from silence, ported from gemihub-desktop's src/llm/speechSilence.ts.

// Room noise is not silence. A fan, a keyboard or a conversation next door sits
// above any fixed level, and against a single fixed threshold the quiet period
// never arrived, so nothing was ever transcribed. The room is measured instead:
// the quietest frame of the recent past is the floor, and speech is what rises
// clearly above it. The same code then works in a silent study and a noisy office.
const NOISE_WINDOW_FRAMES = 50; // 5 s at the 100 ms sampling interval
const VOICE_MARGIN = 3.5; // speech begins well above the room
const SILENCE_MARGIN = 1.8; // and has to fall back near it to count as quiet again
const MIN_VOICE_RMS = 0.012; // a silent room still needs a real voice
const MIN_FLOOR = 0.001;
const FLOOR_PERCENTILE = 0.2;
const INITIAL_GRACE_MS = 3000;

/**
 * Decide per frame whether the microphone is hearing speech, relative to the
 * level of this room. Two thresholds keep the answer from flapping between
 * syllables. The window starts filled with the lowest floor, so the first
 * seconds behave like the old fixed threshold rather than treating the opening
 * words as the room's own noise.
 */
export function createVoiceGate({
  frames = NOISE_WINDOW_FRAMES,
  voiceMargin = VOICE_MARGIN,
  silenceMargin = SILENCE_MARGIN,
  minVoice = MIN_VOICE_RMS,
} = {}) {
  const recent = new Array(frames).fill(MIN_FLOOR);
  let next = 0;
  let voice = false;
  return (rms) => {
    recent[next] = rms;
    next = (next + 1) % frames;
    // The absolute minimum is commonly a momentary dip in a fan or other
    // uneven background sound. A low percentile still represents the quiet
    // room level without letting one unusually quiet frame hold the threshold
    // down for the next five seconds.
    const ordered = recent.toSorted((a, b) => a - b);
    const floor = Math.max(MIN_FLOOR, ordered[Math.floor((ordered.length - 1) * FLOOR_PERCENTILE)]);
    const threshold = voice
      ? Math.max(minVoice * 0.6, floor * silenceMargin)
      : Math.max(minVoice, floor * voiceMargin);
    voice = rms >= threshold;
    return voice;
  };
}

// Two audible samples in a short window arm the timeout. Natural speech has
// brief quiet consonants/gaps; requiring 250 ms of uninterrupted loud input
// can leave a short utterance buffered until the user speaks another sentence.
export function createSilenceDetector(seconds, { graceMs = INITIAL_GRACE_MS, ...gateOptions } = {}) {
  const gate = createVoiceGate(gateOptions);
  let startedAt = null;
  let firstVoice = null;
  let previousVoice = null;
  let lastVoice = 0;
  let armed = false;
  let finished = false;
  // `voice` is published on the returned function so a caller that also reports
  // "the user is speaking" reads the same decision instead of its own threshold.
  const detect = (rms, now) => {
    startedAt ??= now;
    const heard = gate(rms);
    detect.voice = heard;
    if (finished || seconds <= 0) return false;
    if (heard) {
      // A click or clatter is often loud enough to cross an RMS threshold for
      // one frame. Only a voice run confirmed by a second nearby frame may arm
      // or extend the timeout. This keeps sporadic noise from postponing a
      // boundary forever after real speech has already occurred.
      if (firstVoice === null || previousVoice === null || now - previousVoice > 300) firstVoice = now;
      if (now - firstVoice >= 100) {
        armed = true;
        lastVoice = now;
      }
      previousVoice = now;
    } else {
      if (armed && now - startedAt >= graceMs && now - lastVoice >= seconds * 1000) {
        finished = true;
        return true;
      }
    }
    return false;
  };
  detect.voice = false;
  return detect;
}

// watchSpeechSilence calls onSilence once the stream has been quiet for
// `seconds`. onStatus(false) means the AudioContext never started, so the
// caller must tell the user that silence detection is unavailable.
export function watchSpeechSilence(stream, seconds, onSilence, onStatus, onVoice = () => {}, graceMs = INITIAL_GRACE_MS) {
  let context;
  let timer;
  let disposed = false;
  const cleanup = () => {
    disposed = true;
    clearInterval(timer);
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const detect = createSilenceDetector(seconds, { graceMs });
    void context.resume().then(() => {
      if (disposed) return;
      if (context?.state !== "running") {
        onStatus(false);
        cleanup();
        return;
      }
      onStatus(true);
      timer = setInterval(() => {
        if (context?.state !== "running") {
          onStatus(false);
          cleanup();
          return;
        }
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length
        );
        const quiet = detect(rms, performance.now());
        if (detect.voice) onVoice();
        if (quiet) {
          cleanup();
          onSilence();
        }
      }, 100);
    }).catch(() => {
      if (!disposed) onStatus(false);
      cleanup();
    });
  } catch {
    onStatus(false);
    cleanup();
  }
  return cleanup;
}
