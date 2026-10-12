// Compares the JSFX port (jsfx/*.jsfx, run through ysfx) with the JS DSP sample by sample.
// Needs the jsfx_render tool: `npm run jsfx:tools` (or JSFX_RENDER=/path/to/jsfx_render).
// Skipped automatically when the tool is not available (e.g. Cloudflare builds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, INSTRUMENTS, renderJs, renderJsfx, scenario } from '../scripts/jsfx-compare.js';
import { JSFX_FILES, withSliders } from '../scripts/gen-jsfx-sliders.js';
import { resolvePreset } from '../src/lib/presets.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { DRUM_PRESETS } from '../src/presets/drums.js';
import { DRUM_PARTS } from '../src/dsp/params.js';
import { parseScale } from '../src/lib/tuning.js';

const BIN = process.env.JSFX_RENDER || join(import.meta.dirname, '..', '.cache', process.platform === 'win32' ? 'jsfx_render.exe' : 'jsfx_render');
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
    ['brass+vibrato', { phys_model: 6, brass_pressure: 1, brass_lip: 1, brass_bell: 0, phys_vibrato_cents: 30, tuning_divisions: 19 }],
    ['brass soft', { phys_model: 6, brass_pressure: 0, brass_lip: 0, brass_attack_ms: 3 }],
  ];
  for (const [label, over] of cases) {
    check('phys', scenario('phys', over), busy, 0.7, `phys/${label}`);
    check('phys', scenario('phys', over), busy, 0.4, `phys/${label} @44.1k`, 44100);
  }
});

test('JSFX piano matches JS up to the top of the MIDI range', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const top = [96, 103, 108, 112, 116, 120, 124, 127].map((n, i) => [i * 2400, 0x90, n, 60 + i * 8]);
  check('phys', scenario('phys', { phys_model: 5 }), top, 0.5, 'phys/piano top notes');
  check('phys', scenario('phys', { phys_model: 5, piano_inharmonicity: 1, piano_hammer_hardness: 1 }), top, 0.5, 'phys/piano top notes, hard', 44100);
});

test('JSFX drums match JS for every kit and part', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = DRUM_PARTS.map((part, i) => [i * 2400, 0x90, part.note, 60 + (i % 3) * 30]);
  hits.push([30000, 0x90, 46, 120], [31000, 0x90, 42, 100]); // choke
  for (const kit of DRUM_PRESETS) {
    check('drums', resolvePreset(INSTRUMENTS.drums.defs, kit), hits, 0.8, `drums/${kit.name}`);
  }
});

function checkHost(name, params, events, seconds, label, host) {
  const inst = INSTRUMENTS[name];
  const frames = Math.round(SR * seconds);
  const r = compare(renderJs(inst, params, events, SR, frames, host), renderJsfx(BIN, inst, params, events, SR, frames, host));
  assert.ok(r.rms > 1e-4, `${label}: silent?`);
  assert.ok(r.snrDb > MIN_SNR_DB, `${label}: JSFX differs from JS (SNR ${r.snrDb.toFixed(1)} dB, max diff ${r.maxDiff})`);
}

// a chord held over several steps, a key added and released while it runs, then a second chord
const ARP_PLAY = [
  [0, 0x90, 60, 100], [0, 0x90, 64, 90], [0, 0x90, 67, 80],
  [9000, 0x90, 71, 70], [15000, 0x80, 71, 0],
  [21000, 0x80, 60, 0], [21000, 0x80, 64, 0], [21000, 0x80, 67, 0],
  [23500, 0x90, 57, 110], [23500, 0x90, 62, 100], [30000, 0x80, 57, 0], [30000, 0x80, 62, 0],
];

test('JSFX synth matches JS: arpeggiator in every mode, synced to the host tempo', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const pluck = { amp_attack_ms: 1, amp_decay_ms: 200, amp_sustain: 0.3, amp_release_ms: 60 };
  for (let mode = 1; mode <= 6; mode++) {
    const p = scenario('synth', { ...pluck, arp_mode: mode, arp_octaves: 2, arp_rate: 4 });
    checkHost('synth', p, ARP_PLAY, 0.75, `synth/arp mode ${mode} playing`, { tempo: 155, playing: 1 });
    checkHost('synth', p, ARP_PLAY, 0.75, `synth/arp mode ${mode} stopped`, { tempo: 128, playing: 0 });
  }
  // swing, rhythm gate, gate 1 + legato glide, transpose, 1/8 triplets
  const p = scenario('synth', {
    ...pluck, arp_mode: 3, arp_octaves: 3, arp_rate: 5, arp_swing_percent: 62, arp_steps: 5, arp_step_2: 0, arp_step_4: 0,
    arp_gate: 1, voice_mode: 2, glide_ms: 40, glide_mode: 1, transpose_semitones: 5,
  });
  checkHost('synth', p, ARP_PLAY, 0.75, 'synth/arp swing + pattern + legato', { tempo: 140, playing: 1 });
  const chord = scenario('synth', { ...pluck, arp_mode: 6, arp_rate: 2, arp_gate: 0.3, arp_steps: 3, arp_step_3: 0, tuning_divisions: 19 });
  checkHost('synth', chord, ARP_PLAY, 0.75, 'synth/arp chord stabs 19-EDO', { tempo: 155, playing: 1 });
});

test('JSFX synth matches JS: mono / legato, transpose, 9-voice unison, synced LFO', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const lines = [
    ['mono', { voice_mode: 1, glide_ms: 60 }],
    ['legato + glide legato only', { voice_mode: 2, glide_ms: 80, glide_mode: 1, transpose_semitones: -12 }],
    ['poly glide legato only', { glide_ms: 50, glide_mode: 1, transpose_semitones: 7 }],
    ['unison 9 curved', { unison_voices: 9, unison_detune_cents: 40, unison_detune_curve: 0.8, unison_side_level: 0.6 }],
    ['unison 6 mono-width', { unison_voices: 6, unison_stereo_width: 0, unison_side_level: 0.3 }],
    ['duck 1/4', { lfo_waveform: 5, lfo_sync: 7, lfo_amp: 0.9 }],
    ['S&H 1/16 synced', { lfo_waveform: 4, lfo_sync: 13, lfo_filter_oct: 2 }],
    ['triangle 1/8 dotted vibrato', { lfo_waveform: 1, lfo_sync: 11, lfo_pitch_cents: 40 }],
  ];
  for (const [label, over] of lines) {
    checkHost('synth', scenario('synth', over), PERFORMANCE, 0.7, `synth/${label}`, { tempo: 155, playing: 1 });
  }
  checkHost('synth', scenario('synth', { lfo_waveform: 5, lfo_sync: 4, lfo_amp: 1 }), PERFORMANCE, 0.7, 'synth/duck stopped', { tempo: 90, playing: 0 });
});

test('JSFX drums match JS with groups left out of the main mix (separate outputs)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = DRUM_PARTS.map((part, i) => [i * 2400, 0x90, part.note, 100]);
  check('drums', scenario('drums', { kick_bus_in_main: 0, hats_bus_in_main: 0 }), hits, 0.8, 'drums/buses off');
});

// a Scala file the way people write them: comments, a blank-ish description, ratios, cents, a whole number
const SCALA_7 = `! slendro-ish 7 note test scale
!
Test scale for AmiSynth
 7
!
 9/8
 233.5 cents
 6/5
 498.04
 3/2
 813.686
 2
`;

test('JSFX reads the shared Scala scale file (Data/AmiSynth/tuning.txt) like the web scale loader', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'amidata-'));
  mkdirSync(join(dataRoot, 'AmiSynth'));
  writeFileSync(join(dataRoot, 'AmiSynth', 'tuning.txt'), SCALA_7.replace(/\n/g, '\r\n'));
  const { cents } = parseScale(SCALA_7);
  const host = { tempo: 120, playing: 0, scale: { cents, dataRoot } };
  checkHost('synth', scenario('synth', { tuning_source: 1, tuning_ref_note: 60, tuning_ref_hz: 261.6256 }), PERFORMANCE, 0.7, 'synth/scale file', host);
  checkHost('phys', scenario('phys', { tuning_source: 1, phys_model: 1, modal_material: 9 }), PERFORMANCE, 0.7, 'phys/scale file', host);
  // the file really changes the pitch: compare against the 12-EDO render
  const inst = INSTRUMENTS.synth;
  const frames = SR * 0.3;
  const withFile = renderJsfx(BIN, inst, scenario('synth', { tuning_source: 1 }), PERFORMANCE, SR, frames, host);
  const edo = renderJsfx(BIN, inst, scenario('synth'), PERFORMANCE, SR, frames, host);
  assert.ok(compare(withFile, edo).snrDb < 20, 'scale file had no effect');
  // missing file: falls back to the EDO sliders
  const missing = { tempo: 120, playing: 0, scale: { cents, dataRoot: join(dataRoot, 'nowhere') } };
  const r = compare(renderJs(inst, scenario('synth', { tuning_divisions: 19 }), PERFORMANCE, SR, frames),
    renderJsfx(BIN, inst, scenario('synth', { tuning_source: 1, tuning_divisions: 19 }), PERFORMANCE, SR, frames, missing));
  assert.ok(r.snrDb > MIN_SNR_DB, `fallback differs (SNR ${r.snrDb.toFixed(1)} dB)`);
});

test('JSFX synth matches JS: chip / S&H noise, noise filter, cutoff CC', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const sweep = [...PERFORMANCE, [3000, 0xb0, 74, 0], [8000, 0xb0, 74, 127], [15000, 0xb0, 74, 90], [21000, 0xb0, 71, 10]]
    .sort((a, b) => a[0] - b[0]);
  const cases = [
    ['chip long', { noise_type: 1, noise_level: 0.8, osc1_level: 0, osc2_level: 0 }],
    ['chip short + band-pass', { noise_type: 2, noise_level: 0.8, noise_clock_oct: -1, noise_filter_mode: 3, noise_filter_hz: 2500 }],
    ['S&H + high-pass, glide', { noise_type: 3, noise_level: 0.6, noise_clock_oct: 2, noise_filter_mode: 2, glide_ms: 80 }],
    ['white + low-pass', { noise_level: 0.5, noise_filter_mode: 1, noise_filter_hz: 800 }],
    ['cutoff CC74', { cc_cutoff_depth_oct: 6 }],
    ['cutoff CC71', { cc_cutoff_number: 71, filter_resonance: 0.8 }],
  ];
  for (const [label, over] of cases) check('synth', scenario('synth', over), sweep, 0.7, `synth/${label}`);
});

test('JSFX physical model matches JS for the gong materials', { skip: !HAVE && 'jsfx_render not built' }, () => {
  for (const m of [8, 9, 10]) {
    check('phys', scenario('phys', { phys_model: 1, modal_material: m, modal_decay_ms: 6000 }), PERFORMANCE, 0.7, `phys/material ${m}`);
  }
});
