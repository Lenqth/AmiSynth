// Compares the JSFX port (jsfx/*.jsfx, run through ysfx) with the JS DSP sample by sample.
// Needs the jsfx_render tool: `npm run jsfx:tools` (or JSFX_RENDER=/path/to/jsfx_render).
// Skipped automatically when the tool is not available (e.g. Cloudflare builds).
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
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
const METER_BIN = process.env.JSFX_METER_CHECK || join(import.meta.dirname, '..', '.cache', process.platform === 'win32' ? 'jsfx_meter_check.exe' : 'jsfx_meter_check');
const SR = 48000;
const MIN_SNR_DB = 100; // float32 output gives ~150 dB when the port is exact

test('JSFX meters compile and draw, measure output, match only on request and ignore silence',
  { skip: !existsSync(METER_BIN) && 'jsfx_meter_check not built (needs ysfx graphics)' }, () => {
    for (const kind of ['synth', 'phys', 'drums']) {
      const output = execFileSync(METER_BIN, [join(import.meta.dirname, '..', 'jsfx', INSTRUMENTS[kind].file), kind], { encoding: 'utf8' });
      assert.match(output, /checks passed/);
    }
  });

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

test('JSFX synth matches JS: wavetable oscillators (every bank, position modulation, sync / FM, mip levels, 44.1 kHz)',
  { skip: !HAVE && 'jsfx_render not built' }, () => {
    // a glide over 5 octaves crosses every mip level; high notes use the top levels
    const sweep = [[0, 0x90, 33, 100], [2000, 0x90, 93, 100], [9000, 0x80, 33, 0], [9000, 0x80, 93, 0],
      [10000, 0x90, 108, 90], [10000, 0x90, 45, 90], [16000, 0x80, 108, 0], [16000, 0x80, 45, 0], ...PERFORMANCE.slice(3)]
      .sort((a, b) => a[0] - b[0]);
    for (let bank = 0; bank < 5; bank++) {
      const p = scenario('synth', {
        osc1_waveform: 4, osc2_waveform: 4, osc1_wt_bank: bank, osc2_wt_bank: (bank + 2) % 5,
        osc1_wt_position: 0.3, osc2_wt_position: 0.8, wt_position_lfo: 0.4, wt_position_filter_env: 0.5,
        wt_position_amp_env: -0.3, lfo_rate_hz: 3, filter_cutoff_hz: 8000,
      });
      check('synth', p, PERFORMANCE, 0.7, `synth/wavetable bank ${bank}`);
    }
    const mixed = scenario('synth', {
      osc1_waveform: 4, osc1_wt_bank: 4, osc2_waveform: 0, unison_voices: 3, osc2_hard_sync: 1, fm_index: 3,
      osc2_env_pitch_cents: 1200, glide_ms: 300, voice_mode: 2, wt_position_lfo: -0.6, lfo_waveform: 4, lfo_sync: 13,
    });
    checkHost('synth', mixed, sweep, 0.7, 'synth/wavetable + unison, FM, sync, glide', { tempo: 128, playing: 1 });
    const osc2 = scenario('synth', { osc2_waveform: 4, osc2_wt_bank: 3, osc2_hard_sync: 1, osc2_transpose_cents: 1900, wt_position_amp_env: 1 });
    check('synth', osc2, sweep, 0.7, 'synth/wavetable osc2 synced');
    check('synth', osc2, sweep, 0.5, 'synth/wavetable osc2 synced @44.1k', 44100);
    // 192 kHz: the effects' delay lines make the mem_alloc heap large; the wavetable region must stay clear of it
    check('synth', scenario('synth', { osc1_waveform: 4, osc1_wt_bank: 0, osc1_wt_position: 0.6, fx_delay_on: 1, fx_reverb_on: 1 }), sweep, 0.3, 'synth/wavetable + fx @192k', 192000);
  });

test('JSFX synth matches JS: wavetable mip crossfade during slow bends and glides across level boundaries',
  { skip: !HAVE && 'jsfx_render not built' }, () => {
    // a 2-octave bend up and back down in small steps from A4 crosses the 750 / 1500 Hz (48 kHz)
    // boundaries and sits inside the crossfade regions for long stretches
    const bend = [[0, 0x90, 69, 100]];
    for (let i = 0; i <= 256; i++) {
      const b = 8192 + Math.round(((i <= 128 ? i : 256 - i) / 128) * 8191);
      bend.push([200 + i * 100, 0xe0, b & 127, b >> 7]);
    }
    bend.push([26000, 0x80, 69, 0]);
    for (const [bank, pos] of [[0, 1], [1, 0.7], [4, 0.4]]) {
      const p = scenario('synth', {
        osc1_waveform: 4, osc1_wt_bank: bank, osc1_wt_position: pos, osc2_level: 0, pitch_bend_range_cents: 2400,
        filter_cutoff_hz: 20000,
      });
      check('synth', p, bend, 0.6, `synth/wavetable bend across mip boundaries bank ${bank}`);
    }
    // legato glide over 4 octaves (crosses four boundaries)
    const glide = [[0, 0x90, 40, 100], [1000, 0x90, 88, 100], [16000, 0x90, 52, 100], [16100, 0x80, 40, 0],
      [16100, 0x80, 88, 0], [27000, 0x80, 52, 0]];
    const g = scenario('synth', { osc1_waveform: 4, osc1_wt_bank: 2, osc1_wt_position: 0.5, glide_ms: 250, voice_mode: 2 });
    check('synth', g, glide, 0.6, 'synth/wavetable glide across mip boundaries');
  });

test('JSFX physical model matches JS for every preset', { skip: !HAVE && 'jsfx_render not built' }, () => {
  for (const preset of PHYS_PRESETS) {
    check('phys', resolvePreset(INSTRUMENTS.phys.defs, preset), PERFORMANCE, 0.7, `phys/${preset.name}`);
  }
});

test('JSFX Physical matches JS for CC64 Auto/Off/On, retrigger, stealing and reset controllers',
  { skip: !HAVE && 'jsfx_render not built' }, () => {
    const events = [
      [0, 0x90, 60, 100], [1000, 0xb0, 64, 63], [2000, 0xb0, 64, 64],
      [4000, 0x80, 60, 0], [6000, 0x90, 60, 100], [8000, 0xb0, 64, 0],
      [9000, 0xb0, 64, 127], [10000, 0x90, 60, 0],
      ...[61, 62, 63, 64, 65, 66, 67, 68].map((note, i) => [11000 + i * 128, 0x90, note, 100]),
      [15000, 0x80, 61, 0], [15500, 0xb0, 64, 0], [16000, 0xb0, 64, 127],
      [17000, 0x80, 62, 0], [18000, 0xb0, 123, 0],
      [20000, 0x90, 60, 100], [21000, 0xb0, 64, 127], [22000, 0x80, 60, 0], [23000, 0xb0, 121, 0],
      [25000, 0x90, 60, 100], [26000, 0xb0, 64, 127], [27000, 0x80, 60, 0], [28000, 0xb0, 120, 0],
    ];
    for (let model = 0; model <= 7; model++) {
      for (let mode = 0; mode <= 2; mode++) {
        check('phys', scenario('phys', { phys_model: model, phys_sustain_mode: mode, phys_release_ms: 40 }),
          events, 0.7, `phys/sustain model ${model} mode ${mode}`);
      }
    }
    check('phys', scenario('phys', { phys_model: 1, modal_material: 5 }), events, 0.7, 'phys/Auto excludes membrane');
  });

test('JSFX physical model matches JS with stress settings (vibrato, voice stealing, 44.1 kHz, every mesh shape)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  // more notes than the mesh has voices, repeated notes, and a bend while everything rings
  const busy = [...PERFORMANCE, ...[60, 62, 64, 65, 67, 69].map((n, i) => [2000 + i * 500, 0x90, n, 70 + i * 9]), [8000, 0x90, 60, 127]].sort((a, b) => a[0] - b[0]);
  const cases = [
    ['string+vibrato', { phys_model: 0, phys_vibrato_cents: 40, phys_vibrato_rate_hz: 7 }],
    ['bowed+vibrato', { phys_model: 2, phys_vibrato_cents: 30, bow_pressure: 0.9, bow_position: 0.3 }],
    ['clarinet', { phys_model: 3, wind_type: 0, wind_embouchure: 1, breath_pressure: 0, phys_vibrato_cents: 20 }],
    ['flute', { phys_model: 3, wind_type: 1, breath_noise: 1, wind_embouchure: 0, tuning_divisions: 19 }],
    ['saxophone', { phys_model: 3, wind_type: 2, breath_noise: 0.5, breath_pressure: 1, phys_vibrato_cents: 20 }],
    ['double reed', { phys_model: 3, wind_type: 3, wind_embouchure: 0, tuning_divisions: 19 }],
    ['free reed', { phys_model: 3, wind_type: 4, breath_noise: 0.4, phys_vibrato_cents: 15 }],
    ['musette', { phys_model: 3, wind_type: 4, free_reed_detune_cents: 18, wind_embouchure: 1, tuning_divisions: 19 }],
    ['circular mesh', { phys_model: 4, mesh_shape: 0, mesh_size: 16, mesh_high_damping: 1, mesh_hardness: 1 }],
    ['square mesh', { phys_model: 4, mesh_shape: 1, mesh_size: 7, mesh_strike_x: 0.9, mesh_strike_y: 0.1 }],
    ['stiff+vibrato', { phys_model: 5, piano_inharmonicity: 1, piano_unison_detune_cents: 10, phys_vibrato_cents: 25 }],
    ['brass+vibrato', { phys_model: 6, brass_pressure: 1, brass_lip: 1, brass_bell: 0, phys_vibrato_cents: 30, tuning_divisions: 19 }],
    ['brass soft', { phys_model: 6, brass_pressure: 0, brass_lip: 0, brass_attack_ms: 3 }],
    ['organ+rotary', { phys_model: 7, organ_percussion: 2, organ_click: 1, rotary_mode: 1, organ_drawbar_4: 6, organ_drawbar_1: 8, phys_vibrato_cents: 20 }],
    ['organ fast rotary+amp', { phys_model: 7, organ_percussion: 1, rotary_mode: 2, rotary_mix: 0.6, amp_type: 3, phys_room_mix: 0.3, tuning_divisions: 19 }],
    ['vibes+rotary', { phys_model: 1, modal_material: 1, rotary_mode: 1 }],
  ];
  for (const [label, over] of cases) {
    check('phys', scenario('phys', over), busy, 0.7, `phys/${label}`);
    check('phys', scenario('phys', over), busy, 0.4, `phys/${label} @44.1k`, 44100);
  }
});

test('JSFX rotary speaker follows the mod wheel like JS', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const ev = [[0, 0x90, 60, 100], [0, 0x90, 67, 100], [6000, 0xb0, 1, 127], [20000, 0xb0, 1, 0], [26000, 0x90, 72, 90]];
  check('phys', scenario('phys', { phys_model: 7, rotary_mode: 1, organ_drawbar_2: 8 }), ev, 0.7, 'phys/organ mod wheel');
});

test('JSFX piano matches JS up to the top of the MIDI range', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const top = [96, 103, 108, 112, 116, 120, 124, 127].map((n, i) => [i * 2400, 0x90, n, 60 + i * 8]);
  check('phys', scenario('phys', { phys_model: 5 }), top, 0.5, 'phys/piano top notes');
  check('phys', scenario('phys', { phys_model: 5, piano_inharmonicity: 1, piano_hammer_hardness: 1 }), top, 0.5, 'phys/piano top notes, hard', 44100);
});

test('JSFX drums match JS for every kit and part', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = DRUM_PARTS.map((part, i) => [i * 2400, 0x90, part.note, 60 + (i % 3) * 30]);
  hits.push([30000, 0x90, 46, 120], [31000, 0x90, 42, 100]); // choke
  hits.sort((a, b) => a[0] - b[0]);
  for (const kit of DRUM_PRESETS) {
    check('drums', resolvePreset(INSTRUMENTS.drums.defs, kit), hits, 1, `drums/${kit.name}`);
  }
});

test('JSFX drums match JS on every GM percussion note (parts and their variants)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = [];
  for (let note = 35; note <= 81; note++) hits.push([(note - 35) * 1200, 0x90, note, 50 + (note % 4) * 25]);
  hits.push([57000, 0x90, 81, 110], [60000, 0x90, 80, 110], [61000, 0x90, 55, 100], [61500, 0x90, 53, 100]);
  check('drums', scenario('drums', {}), hits, 1.4, 'drums/GM notes');
  check('drums', scenario('drums', { conga_tone: 1, timbale_tone: 0, claves_tone: 1, triangle_tone: 0, agogo_tone: 1 }), hits, 1.4, 'drums/GM notes, tones', 44100);
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

test('JSFX synth matches JS: chorus, delay (ms / synced / ping-pong) and reverb, at 48 and 44.1 kHz', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const cases = [
    ['chorus', { fx_chorus_on: 1, fx_chorus_mix: 0.7, fx_chorus_depth_ms: 8, fx_chorus_rate_hz: 3 }],
    ['delay ms + feedback', { fx_delay_on: 1, fx_delay_sync: 0, fx_delay_time_ms: 90, fx_delay_feedback: 0.8, fx_delay_mix: 0.5 }],
    ['delay 1/16 ping-pong dark', { fx_delay_on: 1, fx_delay_sync: 11, fx_delay_ping_pong: 1, fx_delay_feedback: 0.6, fx_delay_high_cut_hz: 1500 }],
    ['reverb hall', { fx_reverb_on: 1, fx_reverb_mix: 0.6, fx_reverb_size: 1, fx_reverb_damping: 0.1, fx_reverb_decay_ms: 9000 }],
    ['chain', { unison_voices: 3, fx_chorus_on: 1, fx_delay_on: 1, fx_delay_sync: 13, fx_reverb_on: 1, fx_reverb_size: 0 }],
  ];
  for (const [label, over] of cases) {
    checkHost('synth', scenario('synth', over), PERFORMANCE, 0.7, `synth/fx ${label}`, { tempo: 137, playing: 1 });
  }
  // the synced delay at another sample rate and with the transport stopped
  check('synth', scenario('synth', cases[2][1]), PERFORMANCE, 0.5, 'synth/fx delay @44.1k', 44100);
  check('synth', scenario('synth', cases[3][1]), PERFORMANCE, 0.5, 'synth/fx reverb @44.1k', 44100);
});


// PERFORMANCE plus channel pressure swells and polyphonic aftertouch on single keys
const PRESSURE_PLAY = [
  ...PERFORMANCE,
  ...[0, 30, 70, 110, 127, 90, 40, 0].map((v, i) => [1000 + i * 700, 0xd0, v, 0]),
  [3000, 0xa0, 61, 120], [5000, 0xa0, 64, 60], [7000, 0xa0, 61, 0],
  [17000, 0xd0, 100, 0], [19000, 0xa0, 72, 127], [21000, 0xd0, 20, 0], [24000, 0xa0, 72, 30],
].sort((a, b) => a[0] - b[0]);

/** mod matrix slots as params: [[source, destination, amount], ...] */
function slots(list) {
  const p = {};
  list.forEach(([src, dst, amt], i) => {
    p[`mod${i + 1}_source`] = src;
    p[`mod${i + 1}_destination`] = dst;
    p[`mod${i + 1}_amount`] = amt;
  });
  return p;
}

test('JSFX synth matches JS: LFO 2, mod envelope, mod matrix and aftertouch', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const cases = [
    // LFO2 S&H (free) -> pitch and pan, mod env -> cutoff, pressure -> cutoff
    ['lfo2 S&H + mod env + pressure', {
      lfo2_waveform: 4, lfo2_rate_hz: 11, mod_env_attack_ms: 40, mod_env_decay_ms: 120, mod_env_sustain: 0.3,
      ...slots([[2, 1, 35], [3, 2, 3], [7, 2, 2.5], [2, 8, 0.8]]),
    }],
    // synced LFO2 -> amp, velocity -> FM, key track -> osc2 pitch, random -> PW (pulse waves)
    ['lfo2 synced + vel/key/random', {
      osc1_waveform: 1, osc2_waveform: 1, lfo2_waveform: 5, lfo2_sync: 10,
      ...slots([[2, 7, -9], [4, 6, 3], [5, 5, -300], [8, 4, 0.3]]),
    }],
    // LFO rates modulated by the mod wheel, pressure and LFO 2; LFO 1 -> resonance, mod env -> noise
    ['rate mods + resonance + noise', {
      lfo_waveform: 1, lfo_rate_hz: 3, lfo_pitch_cents: 20, lfo2_rate_hz: 2, noise_type: 1,
      mod_env_sustain: 0.5, ...slots([[6, 9, 2], [7, 10, 3], [1, 3, 0.4], [3, 11, 0.6]]),
    }],
    // pressure per voice in mono legato + unison stereo, pressure -> pitch and pan
    // extreme amounts on the LFO rates (summed over slots): limited to +/- 6 oct, never Infinity / NaN
    ['lfo rates at the slider ends', {
      lfo_rate_hz: 7, lfo_pitch_cents: 30, lfo2_rate_hz: 2, ...slots([[6, 9, 4800], [7, 9, 4800], [1, 10, -4800], [7, 10, 4800]]),
    }],
    ['legato unison pressure', {
      voice_mode: 2, glide_ms: 40, unison_voices: 3, ...slots([[7, 1, 50], [7, 8, -1], [2, 10, 1]]),
    }],
  ];
  for (const [label, over] of cases) {
    checkHost('synth', scenario('synth', over), PRESSURE_PLAY, 0.7, `synth/${label}`, { tempo: 133, playing: 1 });
  }
});

test('JSFX physical model matches JS with aftertouch mapped to breath, bow, brightness and vibrato',
  { skip: !HAVE && 'jsfx_render not built' }, () => {
    const press = { phys_pressure_excitation: 0.6, phys_pressure_vibrato_cents: 40, phys_pressure_brightness: 0.5 };
    const cases = [
      ['bowed', { phys_model: 2, ...press }],
      ['clarinet', { phys_model: 3, wind_type: 0, ...press }],
      ['flute', { phys_model: 3, wind_type: 1, phys_vibrato_cents: 10, ...press }],
      ['saxophone', { phys_model: 3, wind_type: 2, ...press }],
      ['free reed', { phys_model: 3, wind_type: 4, ...press }],
      ['brass', { phys_model: 6, ...press }],
      ['string vibrato only', { phys_model: 0, phys_pressure_vibrato_cents: 60 }],
      ['stiff vibrato only', { phys_model: 5, phys_pressure_vibrato_cents: 30 }],
      ['bowed bow only', { phys_model: 2, phys_pressure_excitation: 1 }],
    ];
    const reset = [...PRESSURE_PLAY, [27000, 0xb0, 121, 0]].sort((a, b) => a[0] - b[0]);
    for (const [label, over] of cases) {
      check('phys', scenario('phys', over), reset, 0.7, `phys/pressure ${label}`);
    }
  });

test('JSFX drums match JS with groups left out of the main mix (separate outputs)', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const hits = DRUM_PARTS.map((part, i) => [i * 2400, 0x90, part.note, 100]);
  check('drums', scenario('drums', { kick_bus_in_main: 0, hats_bus_in_main: 0, perc_bus_in_main: 0 }), hits, 1, 'drums/buses off');
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

test('JSFX physical model matches JS through every guitar amp type', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const chords = [[0, 0x90, 40, 127], [0, 0x90, 47, 120], [0, 0x90, 52, 110], [12000, 0x80, 40, 0], [12000, 0x80, 47, 0],
    [12000, 0x80, 52, 0], [14000, 0x90, 64, 60], [20000, 0xe0, 0, 100], [26000, 0x80, 64, 0]];
  for (let t = 1; t <= 4; t++) {
    for (const [gain, tone] of [[0, 1], [1, 0]]) {
      const p = scenario('phys', { phys_model: 0, amp_type: t, amp_gain: gain, amp_tone: tone, amp_level_db: -6, phys_room_mix: 0.2 });
      check('phys', p, chords, 0.7, `phys/amp ${t} gain ${gain}`);
      check('phys', p, chords, 0.4, `phys/amp ${t} gain ${gain} @44.1k`, 44100);
    }
  }
});

// ---- shared scales: an AmiSynth Tuning instance runs before the instrument (jsfx_render "pre")

test('JSFX instruments follow a shared AmiSynth Tuning slot, also when it changes mid-song', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const cents = [175.4, 351, 498, 702, 877.4, 1053, 1200];
  const changed = [175.4, 351, 520, 702, 877.4, 1053, 1200];
  const sliders = { tuning_slot: 2, scale_size: 7, scale_ref_note: 60, scale_ref_hz: 261.6256 };
  cents.forEach((c, i) => (sliders[`scale_degree_${i + 1}`] = c));
  const pre = { sliders, timed: [[12800, 'scale_degree_3', 520], [12800, 'scale_ref_hz', 270]] };
  // the instrument's own reference and EDO sliders must be ignored while it follows the slot
  const own = { tuning_source: 2, tuning_slot: 2, tuning_divisions: 19, tuning_ref_note: 69, tuning_ref_hz: 440 };
  const inst = INSTRUMENTS.synth;
  const frames = Math.round(SR * 0.7);
  const host = {
    tempo: 120, playing: 0,
    onBlock(s, frame) {
      if (frame === 0) inst.scale(s, cents, cents.length);
      if (frame === 12800) {
        s.p = { ...s.p, tuning_ref_hz: 270 };
        inst.scale(s, changed, changed.length);
      }
    },
  };
  const js = renderJs(inst, scenario('synth', { ...own, tuning_ref_note: 60, tuning_ref_hz: 261.6256 }), PERFORMANCE, SR, frames, host);
  const jsfx = renderJsfx(BIN, inst, scenario('synth', own), PERFORMANCE, SR, frames, { tempo: 120, playing: 0, pre });
  const r = compare(js, jsfx);
  assert.ok(r.rms > 1e-4 && r.snrDb > MIN_SNR_DB, `shared slot: SNR ${r.snrDb.toFixed(1)} dB`);
  // it really is the shared scale (not the 19-EDO sliders)
  const edo = renderJsfx(BIN, inst, scenario('synth', { tuning_divisions: 19 }), PERFORMANCE, SR, frames);
  assert.ok(compare(jsfx, edo).snrDb < 20, 'the slot had no effect');
});

test('JSFX AmiSynth Tuning reads a Scala file chosen by name, and an empty slot falls back to EDO', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'amidata-'));
  mkdirSync(join(dataRoot, 'AmiSynth'));
  writeFileSync(join(dataRoot, 'AmiSynth', 'a_other.txt'), 'other\n 2\n 600.0\n 2/1\n');
  writeFileSync(join(dataRoot, 'AmiSynth', 'slendro7.txt'), SCALA_7);
  const { cents } = parseScale(SCALA_7);
  // files are listed alphabetically: 0 = a_other.txt, 1 = slendro7.txt
  const pre = { sliders: { tuning_slot: 3, scale_source: 1, scale_file: 1, scale_ref_note: 62, scale_ref_hz: 293.6648, scale_size: 2 } };
  const own = { tuning_source: 2, tuning_slot: 3, phys_model: 1, modal_material: 9 };
  const host = { tempo: 120, playing: 0, scale: { cents, dataRoot }, pre };
  const inst = INSTRUMENTS.phys;
  const frames = Math.round(SR * 0.7);
  const r = compare(renderJs(inst, scenario('phys', { ...own, tuning_ref_note: 62, tuning_ref_hz: 293.6648 }), PERFORMANCE, SR, frames, host),
    renderJsfx(BIN, inst, scenario('phys', own), PERFORMANCE, SR, frames, host));
  assert.ok(r.rms > 1e-4 && r.snrDb > MIN_SNR_DB, `scale file via AmiSynth Tuning: SNR ${r.snrDb.toFixed(1)} dB`);
  // following slot 5, which nobody publishes: the instrument's own EDO sliders
  const empty = compare(renderJs(INSTRUMENTS.synth, scenario('synth', { tuning_divisions: 19 }), PERFORMANCE, SR, frames),
    renderJsfx(BIN, INSTRUMENTS.synth, scenario('synth', { tuning_source: 2, tuning_slot: 5, tuning_divisions: 19 }), PERFORMANCE, SR, frames, { pre }));
  assert.ok(empty.snrDb > MIN_SNR_DB, `empty slot fallback: SNR ${empty.snrDb.toFixed(1)} dB`);
});
