// Compares the JSFX port (jsfx/*.jsfx, run through ysfx) with the JS DSP sample by sample.
// Needs the jsfx_render tool: `npm run jsfx:tools` (or JSFX_RENDER=/path/to/jsfx_render).
// Skipped automatically when the tool is not available (e.g. Cloudflare builds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compare, INSTRUMENTS, renderJs, renderJsfx, scenario } from '../scripts/jsfx-compare.js';
import { JSFX_FILES, withSliders } from '../scripts/gen-jsfx-sliders.js';
import { resolvePreset } from '../src/lib/presets.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { DRUM_PRESETS } from '../src/presets/drums.js';
import { DRUM_PARTS } from '../src/dsp/params.js';

const BIN = process.env.JSFX_RENDER || join(import.meta.dirname, '..', '.cache', 'jsfx_render');
const HAVE = existsSync(BIN);
const SR = 48000;
const MIN_SNR_DB = 100; // float32 output gives ~150 dB when the port is exact

test('JSFX slider blocks are in sync with params.js', () => {
  for (const [file, defs] of JSFX_FILES) {
    const text = readFileSync(join(import.meta.dirname, '..', 'jsfx', file), 'utf8');
    assert.equal(withSliders(text, defs), text, `${file}: run npm run gen:jsfx`);
  }
});

function check(name, params, events, seconds, label, sr = SR) {
  const inst = INSTRUMENTS[name];
  const frames = Math.round(sr * seconds);
  const r = compare(renderJs(inst, params, events, sr, frames), renderJsfx(BIN, inst, params, events, sr, frames));
  assert.ok(r.rms > 1e-4, `${label}: silent?`);
  assert.ok(r.snrDb > MIN_SNR_DB, `${label}: JSFX differs from JS (SNR ${r.snrDb.toFixed(1)} dB, max diff ${r.maxDiff})`);
}

// chord + bend + mod wheel + sustain pedal + glide-able legato line
const PERFORMANCE = [
  [0, 0x90, 57, 100], [300, 0x90, 61, 80], [600, 0x90, 64, 60],
  [6000, 0xe0, 0, 80], [9000, 0xb0, 1, 90], [12000, 0xb0, 64, 127],
  [14000, 0x80, 57, 0], [14000, 0x80, 61, 0], [14000, 0x80, 64, 0],
  [16000, 0x90, 69, 110], [18000, 0x90, 72, 100], [20000, 0x80, 69, 0],
  [22000, 0xb0, 64, 0], [22000, 0xe0, 0, 64], [26000, 0x80, 72, 0],
];

test('JSFX synth matches JS for every preset', { skip: !HAVE && 'jsfx_render not built' }, () => {
  for (const preset of SYNTH_PRESETS) {
    check('synth', resolvePreset(INSTRUMENTS.synth.defs, preset), PERFORMANCE, 0.7, `synth/${preset.name}`);
  }
});

test('JSFX synth matches JS with stress settings (unison, FM, sync, S&H, 19-EDO)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const p = scenario('synth', {
    unison_voices: 4, unison_stereo_width: 1, fm_index: 4, osc2_hard_sync: 1, osc2_env_pitch_cents: 1800,
    lfo_waveform: 4, lfo_rate_hz: 9, lfo_filter_oct: 1.5, lfo_pulse_width: 0.3, osc1_waveform: 1, filter_drive: 0.7,
    filter_mode: 3, sub_osc_level: 0.5, noise_level: 0.2, glide_ms: 120, tuning_divisions: 19, voice_count: 3,
  });
  check('synth', p, PERFORMANCE, 0.7, 'synth/stress');
});

test('JSFX physical model matches JS for every preset', { skip: !HAVE && 'jsfx_render not built' }, () => {
  for (const preset of PHYS_PRESETS) {
    check('phys', resolvePreset(INSTRUMENTS.phys.defs, preset), PERFORMANCE, 0.7, `phys/${preset.name}`);
  }
});

test('JSFX physical model matches JS with stress settings (vibrato, voice stealing, 44.1 kHz, every mesh shape)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  // more notes than the mesh has voices, repeated notes, and a bend while everything rings
  const busy = [...PERFORMANCE, ...[60, 62, 64, 65, 67, 69].map((n, i) => [2000 + i * 500, 0x90, n, 70 + i * 9]), [8000, 0x90, 60, 127]].sort((a, b) => a[0] - b[0]);
  const cases = [
    ['string+vibrato', { phys_model: 0, phys_vibrato_cents: 40, phys_vibrato_rate_hz: 7 }],
    ['bowed+vibrato', { phys_model: 2, phys_vibrato_cents: 30, bow_pressure: 0.9, bow_position: 0.3 }],
    ['clarinet', { phys_model: 3, wind_type: 0, wind_embouchure: 1, breath_pressure: 0, phys_vibrato_cents: 20 }],
    ['flute', { phys_model: 3, wind_type: 1, breath_noise: 1, wind_embouchure: 0, tuning_divisions: 19 }],
    ['circular mesh', { phys_model: 4, mesh_shape: 0, mesh_size: 16, mesh_high_damping: 1, mesh_hardness: 1 }],
    ['square mesh', { phys_model: 4, mesh_shape: 1, mesh_size: 7, mesh_strike_x: 0.9, mesh_strike_y: 0.1 }],
    ['stiff+vibrato', { phys_model: 5, piano_inharmonicity: 1, piano_unison_detune_cents: 10, phys_vibrato_cents: 25 }],
  ];
  for (const [label, over] of cases) {
    check('phys', scenario('phys', over), busy, 0.7, `phys/${label}`);
    check('phys', scenario('phys', over), busy, 0.4, `phys/${label} @44.1k`, 44100);
  }
});

test('JSFX drums match JS for every kit and part', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = DRUM_PARTS.map((part, i) => [i * 2400, 0x90, part.note, 60 + (i % 3) * 30]);
  hits.push([30000, 0x90, 46, 120], [31000, 0x90, 42, 100]); // choke
  for (const kit of DRUM_PRESETS) {
    check('drums', resolvePreset(INSTRUMENTS.drums.defs, kit), hits, 0.8, `drums/${kit.name}`);
  }
});
