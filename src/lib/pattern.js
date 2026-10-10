// 4-bar pattern model + look-ahead scheduler.
// Events are sent to the worklets with AudioContext timestamps and applied
// sample-accurately there (same as MIDI with sample offsets in JSFX).

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const BARS = 4;
export const STEPS = STEPS_PER_BEAT * BEATS_PER_BAR * BARS;

/** @typedef {{note:number,start:number,len:number,vel:number}} RollNote */
/** @typedef {{note:number,step:number,vel:number}} DrumHit */
/** @typedef {{bpm:number, notes:RollNote[], drums:DrumHit[]}} Pattern */

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
    if (bar === 3) drums.push({ note: 39, step: b + 15, vel: 100 });
    for (let s = 2; s < 16; s += 4) drums.push({ note: s === 14 && bar % 2 === 1 ? 46 : 42, step: b + s, vel: 100 });
    for (const s of [1, 7, 9, 13]) drums.push({ note: 42, step: b + s, vel: 55 });
  }
  return { bpm: 118, notes, drums };
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
   */
  constructor(engine, getPattern, onDrum) {
    this.engine = engine;
    this.getPattern = getPattern;
    this.onDrum = onDrum;
    this.timer = 0;
    this.playing = false;
    this.nextStep = 0;
    this.nextTime = 0;
    this.startTime = 0;
    this.startStep = 0;
    this.stepDur = 0.125;
  }

  start() {
    if (this.playing || !this.engine.ctx) return;
    this.playing = true;
    this.nextStep = 0;
    this.nextTime = this.engine.time + 0.06;
    this.anchor(this.nextTime, 0);
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.engine.clear();
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
    }
    const horizon = this.engine.time + 0.12;
    while (this.nextTime < horizon) {
      this.scheduleStep(pattern, this.nextStep, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.nextStep = (this.nextStep + 1) % STEPS;
    }
  }

  scheduleStep(pattern, step, time, stepDur) {
    for (const n of pattern.notes) {
      if (n.start !== step) continue;
      this.engine.noteOn('synth', n.note, n.vel, time);
      // release slightly before the step boundary so repeated notes retrigger cleanly
      this.engine.noteOff('synth', n.note, time + n.len * stepDur - 0.002);
    }
    for (const h of pattern.drums) {
      if (h.step !== step) continue;
      this.engine.noteOn('drums', h.note, h.vel, time);
      this.onDrum(h.note, time);
    }
  }
}
