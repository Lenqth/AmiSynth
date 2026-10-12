// 4-bar pattern model + look-ahead scheduler.
// Events are sent to the worklets with AudioContext timestamps and applied
// sample-accurately there (same as MIDI with sample offsets in JSFX).

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const BARS = 4;
export const STEPS = STEPS_PER_BEAT * BEATS_PER_BAR * BARS;

/** @typedef {{note:number,start:number,len:number,vel:number}} RollNote */
/** @typedef {{note:number,step:number,vel:number}} DrumHit */
/** @typedef {{bpm:number, notes:RollNote[], drums:DrumHit[], melodic?:'synth'|'phys'}} Pattern */

/** @returns {Pattern} */
export function demoPattern() {
  const notes = [];
  // Cm - Ab - Eb - Bb, 8th note arpeggio + bass
  const chords = [
    [48, 60, 63, 67],
    [44, 60, 63, 68],
    [51, 58, 63, 67],
    [46, 58, 62, 65],
  ];
  const arp = [1, 2, 3, 2, 1, 2, 3, 2];
  chords.forEach((c, bar) => {
    const b = bar * 16;
    notes.push({ note: c[0], start: b, len: 3, vel: 110 });
    notes.push({ note: c[0], start: b + 6, len: 2, vel: 90 });
    notes.push({ note: c[0] + 12, start: b + 10, len: 2, vel: 90 });
    arp.forEach((idx, i) => notes.push({ note: c[idx] + 12, start: b + i * 2, len: 1, vel: i % 2 ? 70 : 95 }));
  });
  const drums = [];
  for (let bar = 0; bar < BARS; bar++) {
    const b = bar * 16;
    for (const s of [0, 4, 8, 12]) drums.push({ note: 36, step: b + s, vel: 120 });
    if (bar % 2 === 1) drums.push({ note: 36, step: b + 14, vel: 90 });
    for (const s of [4, 12]) drums.push({ note: 38, step: b + s, vel: 110 });
    if (bar === 0) drums.push({ note: 49, step: b, vel: 110 });
    if (bar === 3) {
      // tom fill into the loop
      drums.push({ note: 50, step: b + 13, vel: 100 }, { note: 47, step: b + 14, vel: 105 }, { note: 45, step: b + 15, vel: 115 });
    }
    for (let s = 2; s < 16; s += 4) drums.push({ note: s === 14 && bar % 2 === 1 ? 46 : 42, step: b + s, vel: 100 });
    for (const s of [1, 7, 9, 13]) drums.push({ note: 42, step: b + s, vel: 55 });
  }
  return { bpm: 118, notes, drums };
}

/**
 * Piano piece with dynamics (for the physical piano, which gets brighter when played harder):
 * Fmaj7 - G - Em7 - Am, broken-chord left hand and a melody; pp -> crescendo -> ff at bar 3
 * -> diminuendo to pp, with downbeat accents and softer off-beats.
 * @returns {Pattern}
 */
export function pianoDemoPattern() {
  const notes = [];
  // overall dynamic curve over the 64 steps
  const dyn = (step) => {
    const peak = 32; // ff on the downbeat of bar 3
    return step <= peak ? 45 + (70 * step) / peak : 115 - (80 * (step - peak)) / (STEPS - peak);
  };
  const v = (step, offset) => Math.max(1, Math.min(127, Math.round(dyn(step) + offset + (step % 16 === 0 ? 8 : step % 4 === 0 ? 0 : -6))));
  const left = [
    [41, 48, 57, 60, 64, 60, 57, 48],
    [43, 50, 59, 62, 67, 62, 59, 50],
    [40, 47, 55, 59, 64, 59, 55, 47],
    [45, 52, 57, 60, 64, 60, 57, 52],
  ];
  left.forEach((bar, b) => bar.forEach((note, i) => {
    const step = b * 16 + i * 2;
    // the bass note rings for the whole bar (held under the arpeggio)
    notes.push({ note, start: step, len: i === 0 ? 16 : 2, vel: v(step, i === 0 ? -5 : -18) });
  }));
  const melody = [
    [69, 0, 4], [67, 4, 2], [69, 6, 2], [72, 8, 6],
    [71, 16, 4], [69, 20, 2], [67, 22, 2], [74, 24, 8],
    [76, 32, 6], [74, 38, 2], [71, 40, 4], [67, 44, 4],
    [69, 48, 4], [64, 52, 4], [69, 56, 8],
  ];
  for (const [note, start, len] of melody) notes.push({ note: note + 12, start, len, vel: v(start, 8) });
  return { bpm: 84, notes, drums: [], melodic: 'phys' };
}

export function emptyPattern(bpm = 120) {
  return { bpm, notes: [], drums: [] };
}

/**
 * Look-ahead scheduler ("A Tale of Two Clocks"): a coarse JS timer queues
 * events ~120 ms ahead with exact AudioContext timestamps.
 */
export class Sequencer {
  /**
   * @param {import('./engine.js').AudioEngine} engine
   * @param {() => Pattern} getPattern
   * @param {(note:number, time:number) => void} onDrum UI feedback hook
   * @param {(note:number, time:number, duration:number) => void} [onSynthNote] UI feedback hook
   */
  constructor(engine, getPattern, onDrum, onSynthNote = () => {}) {
    this.engine = engine;
    this.getPattern = getPattern;
    this.onDrum = onDrum;
    this.onSynthNote = onSynthNote;
    this.timer = 0;
    this.playing = false;
    this.nextStep = 0;
    this.nextTime = 0;
    this.startTime = 0;
    this.startStep = 0;
    this.stepDur = 0.125;
    this.sendTransport = false;
  }

  start() {
    if (this.playing || !this.engine.ctx) return;
    this.playing = true;
    this.nextStep = 0;
    this.nextTime = this.engine.time + 0.06;
    this.anchor(this.nextTime, 0);
    this.sendTransport = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.engine.clear();
    this.engine.transport(this.getPattern().bpm, false);
  }

  anchor(time, step) {
    this.startTime = time;
    this.startStep = step;
  }

  /** Step currently audible (for the playhead), or -1. */
  currentStep() {
    if (!this.playing) return -1;
    const t = this.engine.time;
    if (t < this.startTime) return (this.startStep - 1 + STEPS) % STEPS;
    return (this.startStep + Math.floor((t - this.startTime) / this.stepDur)) % STEPS;
  }

  tick() {
    const pattern = this.getPattern();
    const stepDur = 60 / pattern.bpm / STEPS_PER_BEAT;
    if (stepDur !== this.stepDur) {
      // tempo change: re-anchor the playhead clock at the next step
      this.stepDur = stepDur;
      this.anchor(this.nextTime, this.nextStep);
      this.sendTransport = true;
    }
    const horizon = this.engine.time + 0.12;
    while (this.nextTime < horizon) {
      this.scheduleStep(pattern, this.nextStep, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.nextStep = (this.nextStep + 1) % STEPS;
    }
  }

  scheduleStep(pattern, step, time, stepDur) {
    const inst = pattern.melodic === 'phys' ? 'phys' : 'synth';
    // host transport for the arpeggiator / synced LFO: bar 1 of the pattern = beat 0
    if (step === 0 || this.sendTransport) {
      this.sendTransport = false;
      this.engine.transport(pattern.bpm, true, step / STEPS_PER_BEAT, time);
    }
    for (const n of pattern.notes) {
      if (n.start !== step) continue;
      this.engine.noteOn(inst, n.note, n.vel, time);
      // release slightly before the step boundary so repeated notes retrigger cleanly
      this.engine.noteOff(inst, n.note, time + n.len * stepDur - 0.002);
      this.onSynthNote(n.note, time, n.len * stepDur - 0.002);
    }
    for (const h of pattern.drums) {
      if (h.step !== step) continue;
      this.engine.noteOn('drums', h.note, h.vel, time);
      this.onDrum(h.note, time);
    }
  }
}
