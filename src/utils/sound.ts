/** Tiny Web Audio click — no audio files, no deps */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Primary click — used on main actions */
export function playClick() {
  try {
    const ac = getCtx();
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.04);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch {}
}

/** Softer tick — chips, list items */
export function playTick() {
  try {
    const ac = getCtx();
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.025);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch {}
}

/** Success pop — confirm save */
export function playPop() {
  try {
    const ac = getCtx();
    const now = ac.currentTime;
    [0, 0.06].forEach((delay, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600 + i * 200, now + delay);
      gain.gain.setValueAtTime(0.06, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.06);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.06);
    });
  } catch {}
}
