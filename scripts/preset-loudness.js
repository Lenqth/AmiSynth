// Loudness of every built-in preset playing the same phrase (see tests/loudness.test.js).
//   node scripts/preset-loudness.js
// Synth / Physical: a held triad, then an 8th-note melody (one note at a time), 120 bpm.
// Drums: a 4-on-the-floor beat with snare, hats and a crash.

import { fileURLToPath } from 'node:url';
import { defaultValues, DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_render, synth_transport, synth_update } from '../src/dsp/synth.js';
import { phys_init, phys_render, phys_update } from '../src/dsp/phys.js';
import { drums_init, drums_render, drums_update } from '../src/dsp/drums.js';
import { drums_midi, phys_midi, synth_midi } from '../src/dsp/midi.js';
import { resolvePreset } from '../src/lib/presets.js';
import { integratedLoudness } from '../src/lib/loudness.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { DRUM_PRESETS } from '../src/presets/drums.js';

export const SR = 48000;
/** Common level every built-in preset is set to, measured with the phrases below. */
export const TARGET_LUFS = -18;

const beat = SR / 2; // 120 bpm
function melodicPhrase() {
  const ev = [];
  for (const n of [60, 64, 67]) {
    ev.push([0, 0x90, n, 100], [Math.round(beat * 3.8), 0x80, n, 0]);
  }
  [72, 71, 67, 64, 65, 67, 69, 72].forEach((n, i) => {
    const t = Math.round(beat * (4 + i * 0.5));
    ev.push([t, 0x90, n - 12, 100], [t + Math.round(beat * 0.45), 0x80, n - 12, 0]);
  });
  return ev.sort((a, b) => a[0] - b[0]);
}

function drumPhrase() {
  const ev = [[0, 0x90, 49, 110]];
  for (let b = 0; b < 8; b++) {
    const t = Math.round(b * beat);
    ev.push([t, 0x90, 36, 115], [t + Math.round(beat / 2), 0x90, 42, 90]);
    if (b % 2 === 1) ev.push([t, 0x90, 38, 110]);
  }
  return ev.sort((a, b) => a[0] - b[0]);
}

const CORES = {
  synth: { defs: SYNTH_PARAMS, presets: SYNTH_PRESETS, init: synth_init, update: synth_update, render: synth_render, midi: synth_midi, phrase: melodicPhrase },
  phys: { defs: PHYS_PARAMS, presets: PHYS_PRESETS, init: phys_init, update: phys_update, render: phys_render, midi: phys_midi, phrase: melodicPhrase },
  drums: { defs: DRUM_PARAMS, presets: DRUM_PRESETS, init: drums_init, update: drums_update, render: drums_render, midi: drums_midi, phrase: drumPhrase },
};

/** Integrated loudness of one preset playing its instrument's phrase (4 s + 1 s tail). */
export function presetLoudness(kind, preset) {
  const core = CORES[kind];
  const s = {};
  core.init(s, SR);
  core.update(s, resolvePreset(core.defs, preset));
  if (kind === 'synth') synth_transport(s, 120, 1, 0);
  const ev = core.phrase();
  const n = SR * 5;
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    while (e < ev.length && ev[e][0] <= i) {
      const [, a, b, c] = ev[e++];
      core.midi(s, a, b, c);
    }
    core.render(s);
    l[i] = s.out_l;
    r[i] = s.out_r;
  }
  return integratedLoudness(l, r, SR);
}

export function allPresetLoudness() {
  const out = [];
  for (const kind of Object.keys(CORES)) {
    for (const p of CORES[kind].presets) out.push({ kind, name: p.name, lufs: presetLoudness(kind, p) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(allPresetLoudness()));
    process.exit(0);
  }
  for (const r of allPresetLoudness()) {
    console.log(`${r.kind.padEnd(6)} ${r.name.padEnd(28)} ${r.lufs.toFixed(1).padStart(6)} LUFS  (${(TARGET_LUFS - r.lufs).toFixed(1)} dB to target)`);
  }
}
