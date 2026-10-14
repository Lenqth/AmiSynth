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
 *
 * It plays a timeline (see song.js): a list of 4-bar patterns played one after another and then
 * looped (one entry = the classic pattern loop). Step times are computed from an anchor
 * (time of step k = anchorTime + (k - anchorStep) * stepDur) rather than accumulated, so a pattern
 * boundary lands on exactly the same time as the next step of a single long pattern would; the
 * timeline is re-read on every tick, so edits (and pattern / song mode changes) apply live.
 */
export class Sequencer {
  /**
   * @param {import('./engine.js').AudioEngine} engine
   * @param {() => (import('./song.js').Timeline | Pattern)} getTimeline a Timeline, or a single Pattern
   * @param {(note:number, time:number) => void} onDrum UI feedback hook
   * @param {(note:number, time:number, duration:number) => void} [onSynthNote] UI feedback hook
   */
  constructor(engine, getTimeline, onDrum, onSynthNote = () => {}) {
    this.engine = engine;
    this.getTimeline = getTimeline;
    this.onDrum = onDrum;
    this.onSynthNote = onSynthNote;
    this.timer = 0;
    this.playing = false;
    /** steps scheduled since start (monotonic) */
    this.count = 0;
    /** position of the next step to schedule: timeline entry + step inside its pattern */
    this.entry = 0;
    this.step = 0;
    this.anchorTime = 0;
    this.anchorCount = 0;
    this.stepDur = 0.125;
    this.sendTransport = false;
    /** @type {{time:number, entry:number, slot:number, index:number, step:number}[]} scheduled steps (for the playhead) */
    this.queue = [];
  }

  /** @returns {import('./song.js').Timeline} */
  timeline() {
    const t = this.getTimeline();
    if (Array.isArray(t.entries)) return t;
    // a bare pattern (old API): one entry
    return { bpm: t.bpm, melodic: t.melodic === 'phys' ? 'phys' : 'synth', entries: [{ pattern: t, slot: -1, index: 0 }] };
  }

  start() {
    if (this.playing || !this.engine.ctx) return;
    this.playing = true;
    this.count = 0;
    this.entry = 0;
    this.step = 0;
    this.queue = [];
    this.stepDur = 60 / this.timeline().bpm / STEPS_PER_BEAT;
    this.anchorTime = this.engine.time + 0.06;
    this.anchorCount = 0;
    this.sendTransport = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.queue = [];
    this.engine.clear();
    this.engine.transport(this.timeline().bpm, false);
  }

  /** AudioContext time of the step with the given count. */
  timeOf(count) {
    return this.anchorTime + (count - this.anchorCount) * this.stepDur;
  }

  /** Step currently audible (entry / arrangement slot / pattern index / step), or null. */
  position() {
    if (!this.playing || this.queue.length === 0) return null;
    const t = this.engine.time;
    let i = 0;
    while (i + 1 < this.queue.length && this.queue[i + 1].time <= t) i++;
    if (i > 0) this.queue.splice(0, i);
    return this.queue[0].time <= t ? this.queue[0] : null;
  }

  /** Step currently audible inside its pattern (for the playhead), or -1. */
  currentStep() {
    return this.position()?.step ?? -1;
  }

  tick() {
    const tl = this.timeline();
    const stepDur = 60 / tl.bpm / STEPS_PER_BEAT;
    if (stepDur !== this.stepDur) {
      // tempo change: re-anchor the clock at the next step
      this.anchorTime = this.timeOf(this.count);
      this.anchorCount = this.count;
      this.stepDur = stepDur;
      this.sendTransport = true;
    }
    const horizon = this.engine.time + 0.12;
    // nobody reads the playhead (e.g. hidden tab): only the last few steps can be audible anyway
    if (this.queue.length > 1024) this.queue.splice(0, this.queue.length - 64);
    for (let time = this.timeOf(this.count); time < horizon; time = this.timeOf(this.count)) {
      // the timeline may have shrunk since the last step (pattern deleted, mode switched)
      if (this.entry >= tl.entries.length) this.entry = 0;
      const e = tl.entries[this.entry];
      this.scheduleStep(tl, e.pattern, this.step, time, stepDur, this.entry);
      this.queue.push({ time, entry: this.entry, slot: e.slot, index: e.index, step: this.step });
      this.count++;
      if (++this.step >= STEPS) {
        this.step = 0;
        this.entry = (this.entry + 1) % tl.entries.length;
      }
    }
  }

  scheduleStep(tl, pattern, step, time, stepDur, entry = 0) {
    const inst = tl.melodic === 'phys' ? 'phys' : 'synth';
    // host transport for the arpeggiator / synced LFO: bar 1 of the timeline = beat 0
    if (step === 0 || this.sendTransport) {
      this.sendTransport = false;
      this.engine.transport(tl.bpm, true, (entry * STEPS + step) / STEPS_PER_BEAT, time);
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
