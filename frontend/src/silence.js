// Speech boundaries detected from silence, ported from gemihub-desktop's src/llm/speechSilence.ts.

// Two audible samples in a short window arm the timeout. Natural speech has
// brief quiet consonants/gaps; requiring 250 ms of uninterrupted loud input
// can leave a short utterance buffered until the user speaks another sentence.
export function createSilenceDetector(seconds) {
  let firstVoice = null;
  let lastVoice = 0;
  let armed = false;
  let finished = false;
  return (rms, now) => {
    if (finished || seconds <= 0) return false;
    if (rms >= 0.015) {
      if (firstVoice === null || now - lastVoice > 300) firstVoice = now;
      else if (now - firstVoice >= 100) armed = true;
      lastVoice = now;
    } else {
      if (armed && now - lastVoice >= seconds * 1000) {
        finished = true;
        return true;
      }
    }
    return false;
  };
}

// watchSpeechSilence calls onSilence once the stream has been quiet for
// `seconds`. onStatus(false) means the AudioContext never started, so the
// caller must tell the user that silence detection is unavailable.
export function watchSpeechSilence(stream, seconds, onSilence, onStatus, onVoice = () => {}) {
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
    const detect = createSilenceDetector(seconds);
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
        if (rms >= 0.015) onVoice();
        if (detect(rms, performance.now())) {
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
