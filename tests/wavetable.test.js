// Wavetable oscillator: procedural, band-limited tables and their use in the synth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_on, synth_render, synth_update } from '../src/dsp/synth.js';
import { osc_init, osc_set_freq } from '../src/dsp/lib.js';
import {
  wt_build, wt_mip, wt_process, wt_table_value, WT_BANK_NAMES, WT_BANKS, WT_FRAMES, WT_MAX_HARM, WT_MIPS, WT_SIZE,
} from '../src/dsp/wavetable.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';

const SR = 48000;
const byId = Object.fromEntries(SYNTH_PARAMS.map((d) => [d.id, d]));

/** Magnitude of harmonic k of a table (plain DFT). */
function harmonic(bank, frame, mip, k) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < WT_SIZE; i++) {
    const v = wt_table_value(bank, frame, mip, i);
    re += v * Math.cos((2 * Math.PI * k * i) / WT_SIZE);
    im -= v * Math.sin((2 * Math.PI * k * i) / WT_SIZE);
  }
  return (2 * Math.hypot(re, im)) / WT_SIZE;
}

function render(overrides, note = 57, seconds = 0.3) {
  const s = {};
  synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...overrides });
  synth_note_on(s, note, 100);
  const n = Math.round(SR * seconds);
  const l = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    synth_render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    l[i] = s.out_l;
  }
  return l;
}
const rmsDiff = (a, b) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0) / a.length);

test('Wavetable is appended to the waveform list; new params default to a no-op', () => {
  for (const id of ['osc1_waveform', 'osc2_waveform']) {
    assert.deepEqual(byId[id].options, ['Saw', 'Pulse', 'Triangle', 'Sine', 'Wavetable']);
    assert.equal(byId[id].max, 4);
  }
  assert.deepEqual(byId.osc1_wt_bank.options, WT_BANK_NAMES);
  assert.equal(WT_BANK_NAMES.length, WT_BANKS);
  // appended after the last existing slider, so REAPER slider numbers do not move
  const ids = SYNTH_PARAMS.map((d) => d.id);
  assert.equal(ids.indexOf('osc1_wt_bank'), ids.indexOf('tuning_slot') + 1);
  for (const id of ['wt_position_lfo', 'wt_position_filter_env', 'wt_position_amp_env']) assert.equal(byId[id].default, 0);
  // presets with classic oscillators carry no wavetable settings; the wavetable ones exist
  const wt = SYNTH_PRESETS.filter((p) => p.params.osc1_waveform === 4 || p.params.osc2_waveform === 4);
  assert.ok(wt.length >= 3);
  for (const p of SYNTH_PRESETS.filter((p) => !wt.includes(p))) {
    for (const id of Object.keys(p.params)) assert.ok(!id.includes('wt_'), `${p.name}: ${id}`);
  }
});

test('wavetable params do nothing while both oscillators use the classic waveforms', () => {
  const plain = render({ osc1_waveform: 0, osc2_waveform: 1 });
  const moved = render({
    osc1_waveform: 0, osc2_waveform: 1, osc1_wt_bank: 3, osc1_wt_position: 0.7, osc2_wt_bank: 4,
    wt_position_lfo: 1, wt_position_filter_env: -1, wt_position_amp_env: 0.5,
  });
  assert.equal(rmsDiff(plain, moved), 0);
});

test('every table is band-limited to its mip level and every frame peaks at 1', () => {
  for (let bank = 0; bank < WT_BANKS; bank++) {
    wt_build(bank);
    for (const frame of [0, 3, WT_FRAMES - 1]) {
      let peak = 0;
      for (let i = 0; i < WT_SIZE; i++) peak = Math.max(peak, Math.abs(wt_table_value(bank, frame, 0, i)));
      assert.ok(Math.abs(peak - 1) < 1e-12, `bank ${bank} frame ${frame}: peak ${peak}`);
      for (const mip of [2, 6]) {
        const top = WT_MAX_HARM >> mip;
        // nothing above the level's top harmonic, nor at DC
        for (const k of [0, top + 1, top + 2, 2 * top, 3 * top + 1]) {
          assert.ok(harmonic(bank, frame, mip, k) < 1e-9, `bank ${bank} frame ${frame} mip ${mip} harmonic ${k}`);
        }
      }
    }
  }
});

test('the table picked for a pitch never puts a harmonic above Nyquist (and keeps as many as possible)', () => {
  for (const hz of [20, 47, 50, 110, 440, 1000, 3000, 7000, 12000, 20000]) {
    for (const sr of [44100, 48000, 96000]) {
      const inc = Math.min(hz / sr, 0.49);
      const m = wt_mip(inc);
      assert.ok(m >= 0 && m < WT_MIPS);
      const top = WT_MAX_HARM / 2 ** m;
      assert.ok(top * inc <= 0.5, `${hz} Hz @${sr}: harmonic ${top} aliases`);
      if (m > 0) assert.ok(2 * top * inc > 0.5, `${hz} Hz @${sr}: mip ${m} is darker than needed`);
    }
  }
});

test('Basic Shapes starts as a pure sine and ends as a square; PWM Sweep starts as the same square', () => {
  for (let i = 0; i < WT_SIZE; i += 37) {
    assert.ok(Math.abs(wt_table_value(0, 0, 0, i) - Math.sin((2 * Math.PI * i) / WT_SIZE)) < 1e-12);
    assert.ok(Math.abs(wt_table_value(0, WT_FRAMES - 1, 0, i) - wt_table_value(1, 0, 0, i)) < 1e-12);
  }
  // square: odd harmonics only, falling as 1/k
  assert.ok(harmonic(0, WT_FRAMES - 1, 0, 2) < 1e-9);
  const h1 = harmonic(0, WT_FRAMES - 1, 0, 1);
  assert.ok(Math.abs(harmonic(0, WT_FRAMES - 1, 0, 3) / h1 - 1 / 3) < 1e-9);
  // the narrow pulse at the end of PWM Sweep is rich in even harmonics
  assert.ok(harmonic(1, WT_FRAMES - 1, 0, 2) > 0.5 * harmonic(1, WT_FRAMES - 1, 0, 1));
});

test('wavetable oscillator: frames crossfade linearly, phase / wrap behave like osc_process', () => {
  wt_build(0);
  const o = {};
  osc_init(o);
  osc_set_freq(o, 100, SR);
  // halfway between two frames = average of both
  const a = wt_process({ ...o }, 0, 1 / (WT_FRAMES - 1), 0);
  const b = wt_process({ ...o, phase: 0.3 }, 0, 0.5 / (WT_FRAMES - 1), 0);
  const b0 = wt_process({ ...o, phase: 0.3 }, 0, 0, 0);
  const b1 = wt_process({ ...o, phase: 0.3 }, 0, 1 / (WT_FRAMES - 1), 0);
  assert.ok(Math.abs(a) < 1e-12); // phase 0 of a sine-phase table
  assert.ok(Math.abs(b - (b0 + b1) / 2) < 1e-12);
  let wraps = 0;
  for (let i = 0; i < SR; i++) {
    wt_process(o, 0, 0.5, 0);
    wraps += o.wrapped;
  }
  assert.ok(Math.abs(wraps - 100) <= 1);
});

test('position follows the knob, the LFO and both envelopes', () => {
  const base = { osc1_waveform: 4, osc1_wt_bank: 0, osc2_level: 0, filter_cutoff_hz: 20000, filter_env_amount_oct: 0 };
  const sine = render({ ...base, osc1_wt_position: 0 });
  const square = render({ ...base, osc1_wt_position: 1 });
  assert.ok(rmsDiff(sine, square) > 0.01);
  // amp envelope at full sustain moves the position all the way: same as the knob at 1 once settled
  const env = render({ ...base, amp_attack_ms: 0.5, amp_sustain: 1, wt_position_amp_env: 1 });
  const settled = (x) => x.subarray(x.length - 4800);
  const sq = render({ ...base, amp_attack_ms: 0.5, amp_sustain: 1, osc1_wt_position: 1 });
  assert.ok(rmsDiff(settled(env), settled(sq)) < 1e-9);
  const fenv = render({ ...base, wt_position_filter_env: 1 });
  const lfo = render({ ...base, wt_position_lfo: 1, lfo_rate_hz: 4 });
  assert.ok(rmsDiff(fenv, sine) > 0.005);
  assert.ok(rmsDiff(lfo, sine) > 0.005);
  // negative amounts pull the position down from the knob
  const down = render({ ...base, amp_sustain: 1, osc1_wt_position: 1, wt_position_amp_env: -1, amp_attack_ms: 0.5 });
  const sine2 = render({ ...base, amp_sustain: 1, amp_attack_ms: 0.5 });
  assert.ok(rmsDiff(settled(down), settled(sine2)) < 1e-9);
});

test('wavetables work with unison, hard sync, FM and on osc2, in every bank', () => {
  for (let bank = 0; bank < WT_BANKS; bank++) {
    const out = render({
      osc1_waveform: 4, osc2_waveform: 4, osc1_wt_bank: bank, osc2_wt_bank: (bank + 1) % WT_BANKS, osc2_wt_position: 0.6,
      unison_voices: 3, osc2_hard_sync: 1, fm_index: 2, osc2_transpose_cents: 700, wt_position_lfo: 0.5,
    }, 84, 0.1);
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01 && peak <= 1, `bank ${bank}: peak ${peak}`);
  }
});
