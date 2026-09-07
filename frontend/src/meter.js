// Live input-level bars, ported from gemihub-desktop's SpeechActivity AudioMeter.
// The meter is decoration: if the AudioContext will not start, recording still
// works and the caller just shows "レベル取得不可".

const BAR_COUNT = 9;
const BINS_PER_BAR = 6;

export function createAudioMeter(container) {
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement("span");
    container.append(bar);
    bars.push(bar);
  }
  let context;
  let frame = 0;
  let disposed = false;

  function reset() {
    bars.forEach((bar) => {
      bar.style.height = "3px";
    });
  }

  function detach() {
    disposed = true;
    cancelAnimationFrame(frame);
    if (context && context.state !== "closed") void context.close().catch(() => {});
    context = undefined;
    reset();
  }

  // attach returns a promise for whether the level display actually started.
  function attach(stream) {
    detach();
    disposed = false;
    if (!stream || typeof AudioContext === "undefined") return Promise.resolve(false);
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(values);
        bars.forEach((bar, i) => {
          let sum = 0;
          for (let j = 0; j < BINS_PER_BAR; j++) sum += values[1 + i * BINS_PER_BAR + j];
          bar.style.height = `${3 + (sum / (BINS_PER_BAR * 255)) * 29}px`;
        });
        frame = requestAnimationFrame(draw);
      };
      return context.resume().then(() => {
        if (disposed || context?.state !== "running") return false;
        draw();
        return true;
      }).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  reset();
  return { attach, detach };
}
