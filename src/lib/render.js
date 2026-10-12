// Offline rendering of the piano-roll pattern with the same DSP cores the AudioWorklets run
// (and the same event timing as the Sequencer), for WAV / MP3 export.

import { DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS, defaultValues } from '../dsp/params.js';
import { synth_init, synth_render, synth_set_scale, synth_transport, synth_update } from '../dsp/synth.js';
import { phys_init, phys_render, phys_set_scale, phys_update } from '../dsp/phys.js';
import { drums_init, drums_render, drums_update } from '../dsp/drums.js';
import { drums_midi, phys_midi, synth_midi } from '../dsp/midi.js';
import { STEPS, STEPS_PER_BEAT } from './pattern.js';

const CORES = {
  synth: {
    defs: SYNTH_PARAMS, init: synth_init, update: synth_update, render: synth_render, midi: synth_midi, scale: synth_set_scale,
    transport: synth_transport,
  },
  phys: { defs: PHYS_PARAMS, init: phys_init, update: phys_update, render: phys_render, midi: phys_midi, scale: phys_set_scale },
  drums: { defs: DRUM_PARAMS, init: drums_init, update: drums_update, render: drums_render, midi: drums_midi, scale: null },
};

/**
 * MIDI events of `loops` repetitions of the pattern, per instrument, as [frame, status, d1, d2],
 * sorted by frame (stable, like the worklet queue). Timing matches Sequencer.scheduleStep.
 * @param {import('./pattern.js').Pattern} pattern
 */
export function patternEvents(pattern, sr, loops = 1) {
  const stepDur = 60 / pattern.bpm / STEPS_PER_BEAT;
  const melodic = pattern.melodic === 'phys' ? 'phys' : 'synth';
  const ev = { synth: [], phys: [], drums: [] };
  for (let k = 0; k < loops; k++) {
    for (let step = 0; step < STEPS; step++) {
      const t = (k * STEPS + step) * stepDur;
      for (const n of pattern.notes) {
        if (n.start !== step) continue;
        ev[melodic].push([Math.round(t * sr), 0x90, n.note, n.vel]);
        // released slightly before the step boundary so repeated notes retrigger cleanly
        ev[melodic].push([Math.round((t + n.len * stepDur - 0.002) * sr), 0x80, n.note, 0]);
      }
      for (const h of pattern.drums) if (h.step === step) ev.drums.push([Math.round(t * sr), 0x90, h.note, h.vel]);
    }
  }
  for (const k of Object.keys(ev)) {
    ev[k] = ev[k].map((e, i) => [e, i]).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([e]) => e);
  }
  return { ev, length: Math.round(loops * STEPS * stepDur * sr) };
}

/**
 * Render the pattern (plus the ringing tail, up to maxTail seconds) to stereo float buffers.
 * @param {{ pattern: any, params: {synth?:object, phys?:object, drums?:object}, scaleCents?: number[] | null,
 *   sampleRate?: number, loops?: number, maxTail?: number }} opts
 * @param {(fraction:number)=>void} [onProgress]
 * @returns {{ left: Float32Array, right: Float32Array, sampleRate: number, peak: number }}
 */
export function renderPattern(opts, onProgress = () => {}) {
  const sr = opts.sampleRate ?? 48000;
  const { ev, length } = patternEvents(opts.pattern, sr, opts.loops ?? 1);
  const maxTail = Math.round((opts.maxTail ?? 6) * sr);
  // only the instruments that play something are run
  const active = Object.keys(CORES).filter((k) => ev[k].length > 0).map((k) => {
    const core = CORES[k];
    const s = {};
    core.init(s, sr);
    const p = { ...defaultValues(core.defs), ...(opts.params?.[k] || {}) };
    core.update(s, p);
    if (core.scale && opts.scaleCents) core.scale(s, opts.scaleCents, opts.scaleCents.length);
    // playing from beat 0 at the pattern tempo (arpeggiator / synced LFO), like the Sequencer
    if (core.transport) core.transport(s, opts.pattern.bpm, 1, 0);
    return { core, s, events: ev[k], next: 0 };
  });
  const cap = length + maxTail;
  const left = new Float32Array(cap);
  const right = new Float32Array(cap);
  const quietFrames = Math.round(0.3 * sr);
  const report = Math.round(sr / 4);
  let quiet = 0;
  let peak = 0;
  let n = 0;
  while (n < cap) {
    let l = 0;
    let r = 0;
    for (const a of active) {
      while (a.next < a.events.length && a.events[a.next][0] <= n) {
        const e = a.events[a.next++];
        a.core.midi(a.s, e[1], e[2], e[3]);
      }
      a.core.render(a.s);
      l += a.s.out_l;
      r += a.s.out_r;
    }
    left[n] = l;
    right[n] = r;
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
    n++;
    // after the pattern: stop once everything has rung out
    if (n > length) {
      quiet = m < 0.0001 ? quiet + 1 : 0;
      if (quiet >= quietFrames) break;
    }
    if (n % report === 0) onProgress(Math.min(1, n / (length + sr)));
  }
  return { left: left.slice(0, n), right: right.slice(0, n), sampleRate: sr, peak };
}
