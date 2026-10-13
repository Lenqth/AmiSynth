// Render the same scenario with the JS DSP and with the JSFX port (through the
// ysfx-based jsfx/tools/jsfx_render) and report the difference.
//   node scripts/jsfx-compare.js            (needs JSFX_RENDER=/path/to/jsfx_render)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultValues, DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS, TUNING_HOLDER_PARAMS } from '../src/dsp/params.js';
import { drums_init, drums_note_on, drums_render, drums_update } from '../src/dsp/drums.js';
import { phys_init, phys_render, phys_set_scale, phys_update } from '../src/dsp/phys.js';
import { phys_midi } from '../src/dsp/midi.js';
import {
  synth_cc, synth_init, synth_mod_wheel, synth_note_off, synth_note_on, synth_pitch_bend, synth_render, synth_set_scale,
  synth_sustain_pedal, synth_transport, synth_update,
} from '../src/dsp/synth.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const INSTRUMENTS = {
  synth: {
    file: 'AmiSynth Synth.jsfx', defs: SYNTH_PARAMS, init: synth_init, update: synth_update, render: synth_render,
    transport: synth_transport,
    scale: synth_set_scale,
    midi(s, st, d1, d2) {
      const t = st & 0xf0;
      if (t === 0xb0) synth_cc(s, d1, d2);
      if (t === 0x90) synth_note_on(s, d1, d2);
      else if (t === 0x80) synth_note_off(s, d1);
      else if (t === 0xe0) synth_pitch_bend(s, ((d2 << 7) | d1) / 8192 - 1);
      else if (t === 0xb0 && d1 === 1) synth_mod_wheel(s, d2 / 127);
      else if (t === 0xb0 && d1 === 64) synth_sustain_pedal(s, d2 >= 64);
    },
  },
  drums: {
    file: 'AmiSynth Drums.jsfx', defs: DRUM_PARAMS, init: drums_init, update: drums_update, render: drums_render,
    // main mix + kick, snare/clap/rim, hats/cymbals, toms/perc (JSFX out pins 1..10)
    channels: 10,
    out(s, o, i) {
      o[i] = s.out_l;
      o[i + 1] = s.out_r;
      for (let b = 0; b < 4; b++) {
        o[i + 2 + 2 * b] = s.bus_l[b];
        o[i + 3 + 2 * b] = s.bus_r[b];
      }
    },
    midi(s, st, d1, d2) {
      if ((st & 0xf0) === 0x90 && d2 > 0) drums_note_on(s, d1, d2);
    },
  },
  phys: {
    file: 'AmiSynth Physical.jsfx', defs: PHYS_PARAMS, init: phys_init, update: phys_update, render: phys_render,
    scale: phys_set_scale,
    midi: phys_midi,
  },
};

const BLOCK = 128; // jsfx_render's block size: the host transport is read once per block (@block)

/**
 * JS render with the same event semantics as the worklet / JSFX (events before the sample at their frame).
 * host: { tempo, playing } like REAPER's tempo / play_state (default 120 bpm, stopped);
 * host.scale: { cents, dataRoot } = the shared scale file the JSFX reads (with tuning_source = 1).
 * host.onBlock(s, frame): called at the start of every 128-frame block (JS side of host.pre).
 * host.pre: { sliders: {id: value}, timed: [[frame, id, value]] } = an AmiSynth Tuning instance
 * run before the instrument in the JSFX render (see jsfx_render's "pre").
 */
export function renderJs(inst, params, events, sr, frames, host = { tempo: 120, playing: 0 }) {
  const s = {};
  inst.init(s, sr);
  inst.update(s, params);
  if (host.scale && params.tuning_source >= 0.5) inst.scale(s, host.scale.cents, host.scale.cents.length);
  const tempo = host.tempo ?? 120;
  const ch = inst.channels ?? 2;
  const out = new Float64Array(frames * ch);
  let e = 0;
  for (let i = 0; i < frames; i++) {
    if (i % BLOCK === 0) {
      if (inst.transport) inst.transport(s, tempo, host.playing, (i * tempo) / 60 / sr);
      host.onBlock?.(s, i);
    }
    while (e < events.length && events[e][0] <= i) {
      const [, a, b, c] = events[e++];
      inst.midi(s, a, b, c);
    }
    inst.render(s);
    if (inst.out) inst.out(s, out, i * ch);
    else {
      out[i * 2] = s.out_l;
      out[i * 2 + 1] = s.out_r;
    }
  }
  return out;
}

export function renderJsfx(renderBin, inst, params, events, sr, frames, host = { tempo: 120, playing: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'amijsfx-'));
  const script = [
    // ysfx knows 64 sliders; beyond that (REAPER allows 256) the ids are plain variables
    ...inst.defs.map((d, i) => (i < 64 ? `slider ${i + 1} ${params[d.id]}` : `var ${d.id} ${params[d.id]}`)),
    `tempo ${host.tempo ?? 120} ${host.playing ? 1 : 0}`,
    ...(host.scale ? [`dataroot ${host.scale.dataRoot}`] : []),
    ...(host.pre ? preScript(host.pre) : []),
    ...events.map(([f, a, b, c]) => `midi ${f} ${a} ${b} ${c}`),
  ].join('\n');
  writeFileSync(join(dir, 'script.txt'), script);
  const outPath = join(dir, 'out.f32');
  execFileSync(renderBin, [join(root, 'jsfx', inst.file), String(sr), String(frames / sr), outPath, join(dir, 'script.txt')], { stdio: ['ignore', 'ignore', 'pipe'] });
  const buf = readFileSync(outPath);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

const holderIndex = (id) => {
  const i = TUNING_HOLDER_PARAMS.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`unknown AmiSynth Tuning parameter: ${id}`);
  return i + 1;
};

function preScript(pre) {
  return [
    `pre ${join(root, 'jsfx', 'AmiSynth Tuning.jsfx')}`,
    ...Object.entries(pre.sliders ?? {}).map(([id, v]) => `preslider ${holderIndex(id)} ${v}`),
    ...(pre.timed ?? []).map(([f, id, v]) => `preslider_at ${f} ${holderIndex(id)} ${v}`),
  ];
}

export function compare(a, b) {
  const n = Math.min(a.length, b.length);
  let maxDiff = 0;
  let energy = 0;
  let diffEnergy = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    maxDiff = Math.max(maxDiff, Math.abs(d));
    energy += a[i] * a[i];
    diffEnergy += d * d;
  }
  return { maxDiff, rms: Math.sqrt(energy / n), snrDb: 10 * Math.log10(energy / Math.max(diffEnergy, 1e-30)) };
}

export function scenario(name, overrides = {}) {
  const inst = INSTRUMENTS[name];
  return { ...defaultValues(inst.defs), ...overrides };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bin = process.env.JSFX_RENDER;
  if (!bin) {
    console.error('set JSFX_RENDER to the jsfx_render binary (see jsfx/README.md)');
    process.exit(2);
  }
  const SR = 48000;
  const chord = [[0, 0x90, 57, 100], [100, 0x90, 61, 90], [200, 0x90, 64, 80], [24000, 0x80, 57, 0], [24000, 0x80, 61, 0], [24000, 0x80, 64, 0]];
  for (const name of ['synth', 'phys', 'drums']) {
    const inst = INSTRUMENTS[name];
    const p = scenario(name);
    const ev = name === 'drums' ? [36, 38, 39, 42, 46, 37, 45, 47, 50, 49, 51, 56, 70].map((n, i) => [i * 3000, 0x90, n, 110]) : chord;
    const frames = SR;
    const r = compare(renderJs(inst, p, ev, SR, frames), renderJsfx(bin, inst, p, ev, SR, frames));
    console.log(name.padEnd(6), `max diff ${r.maxDiff.toExponential(2)}  rms ${r.rms.toFixed(4)}  SNR ${r.snrDb.toFixed(1)} dB`);
  }
}
