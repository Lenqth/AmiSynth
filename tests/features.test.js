import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampParam, defaultValues, DRUM_PARAMS, DRUM_PARTS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_on, synth_render, synth_update } from '../src/dsp/synth.js';
import { drums_init, drums_note_on, drums_render, drums_update } from '../src/dsp/drums.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { DRUM_PRESETS } from '../src/presets/drums.js';
import { diffFromDefaults, parsePresetJson, resolvePreset } from '../src/lib/presets.js';

const SR = 48000;

function makeSynth(overrides) {
  const s = {};
  synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...overrides });
  return s;
}

function render(s, n) {
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    synth_render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    l[i] = s.out_l;
    r[i] = s.out_r;
  }
  return { l, r };
}

const rms = (a) => Math.sqrt(a.reduce((acc, v) => acc + v * v, 0) / a.length);
const diffRms = (a, b) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0) / a.length);
/** frequency estimate from rising zero crossings */
function freq(a) {
  let n = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < a.length; i++) {
    if (a[i - 1] < 0 && a[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      n++;
    }
  }
  return n > 1 ? ((n - 1) * SR) / (last - first) : 0;
}

const PURE_SINE = {
  osc1_waveform: 3, osc2_level: 0, filter_cutoff_hz: 20000, filter_resonance: 0, filter_env_amount_oct: 0,
  filter_key_tracking: 0, amp_attack_ms: 0.5, amp_sustain: 1, master_volume_db: -20,
};

test('glide slides from the previous note', () => {
  const s = makeSynth({ ...PURE_SINE, glide_ms: 300, voice_count: 1 });
  synth_note_on(s, 48, 100);
  render(s, SR * 0.2);
  synth_note_on(s, 60, 100); // 130.8 Hz -> 261.6 Hz
  const early = freq(render(s, SR * 0.03).l);
  render(s, SR * 0.6);
  const late = freq(render(s, SR * 0.05).l);
  assert.ok(early < 200, `early ${early}`);
  assert.ok(Math.abs(late - 261.63) < 3, `late ${late}`);
});

test('unison spreads to stereo, single voice stays mono', () => {
  const mono = makeSynth({ unison_voices: 1 });
  synth_note_on(mono, 57, 100);
  const m = render(mono, SR * 0.2);
  assert.equal(diffRms(m.l, m.r), 0);
  const wide = makeSynth({ unison_voices: 4, unison_stereo_width: 1 });
  synth_note_on(wide, 57, 100);
  const w = render(wide, SR * 0.2);
  assert.ok(diffRms(w.l, w.r) > 0.01, 'L and R differ');
  assert.ok(rms(w.l) > 0.02);
});

test('sync, FM, PWM, drive and sub each change the sound', () => {
  const base = { osc2_waveform: 0, osc2_transpose_cents: 700, filter_cutoff_hz: 8000 };
  const ref = makeSynth(base);
  synth_note_on(ref, 50, 100);
  const a = render(ref, SR * 0.1).l;
  for (const [name, ov] of [
    ['sync', { osc2_hard_sync: 1 }],
    ['fm', { fm_index: 3 }],
    ['pulse width', { osc1_waveform: 1, osc1_pulse_width: 0.1 }],
    ['drive', { filter_drive: 1 }],
    ['sub', { sub_osc_level: 1 }],
    ['osc2 env pitch', { osc2_env_pitch_cents: 2400 }],
  ]) {
    const s = makeSynth({ ...base, ...ov });
    synth_note_on(s, 50, 100);
    const b = render(s, SR * 0.1).l;
    assert.ok(diffRms(a, b) > 0.005, `${name} has an audible effect`);
    assert.ok(Math.max(...b.map(Math.abs)) <= 1, `${name} bounded`);
  }
});

test('all filter modes and LFO shapes are audible and bounded', () => {
  for (const mode of [0, 1, 2, 3]) for (const lfo of [0, 1, 2, 3, 4]) {
    const s = makeSynth({ filter_mode: mode, lfo_waveform: lfo, lfo_filter_oct: 1, lfo_amp: 0.5, lfo_pitch_cents: 30 });
    synth_note_on(s, 45, 110);
    const { l } = render(s, SR * 0.15);
    assert.ok(rms(l) > 0.005, `mode ${mode} lfo ${lfo} rms ${rms(l)}`);
  }
});

test('every synth preset is valid, audible and bounded', () => {
  const names = new Set();
  for (const preset of SYNTH_PRESETS) {
    assert.ok(!names.has(preset.name), `duplicate ${preset.name}`);
    names.add(preset.name);
    for (const [id, v] of Object.entries(preset.params)) {
      const d = SYNTH_PARAMS.find((x) => x.id === id);
      assert.ok(d, `${preset.name}: unknown param ${id}`);
      assert.ok(!id.startsWith('tuning_'), `${preset.name}: presets must not change tuning`);
      assert.equal(clampParam(d, v), v, `${preset.name}: ${id}=${v} out of range`);
    }
    const s = makeSynth(resolvePreset(SYNTH_PARAMS, preset));
    for (const n of [48, 55, 60, 64]) synth_note_on(s, n, 100);
    const { l, r } = render(s, SR);
    const peak = Math.max(...l.map(Math.abs), ...r.map(Math.abs));
    assert.ok(Math.max(rms(l), rms(r)) > 0.01, `${preset.name} audible (${rms(l)})`);
    assert.ok(peak <= 1, `${preset.name} bounded`);
  }
});

test('every drum kit plays every part', () => {
  for (const kit of DRUM_PRESETS) {
    for (const [id, v] of Object.entries(kit.params)) {
      const d = DRUM_PARAMS.find((x) => x.id === id);
      assert.ok(d, `${kit.name}: unknown param ${id}`);
      assert.equal(clampParam(d, v), v, `${kit.name}: ${id}=${v} out of range`);
    }
    for (const part of DRUM_PARTS) {
      const d = {};
      drums_init(d, SR);
      drums_update(d, resolvePreset(DRUM_PARAMS, kit));
      drums_note_on(d, part.note, 110);
      let e = 0;
      for (let i = 0; i < SR * 0.1; i++) {
        drums_render(d);
        assert.ok(Math.abs(d.out_l) <= 1 && Math.abs(d.out_r) <= 1);
        e += d.out_l ** 2 + d.out_r ** 2;
      }
      assert.ok(e > 0.3, `${kit.name} / ${part.name} audible (${e})`);
    }
  }
});

test('preset JSON round trip, clamping and unknown ids', () => {
  const values = { ...defaultValues(SYNTH_PARAMS), filter_cutoff_hz: 900, unison_voices: 3, tuning_divisions: 19 };
  const diff = diffFromDefaults(SYNTH_PARAMS, values);
  assert.deepEqual(diff, { filter_cutoff_hz: 900, unison_voices: 3 }); // tuning excluded
  const parsed = parsePresetJson(JSON.stringify({ name: 'X', params: { ...diff, filter_resonance: 5, bogus: 1 } }), SYNTH_PARAMS);
  assert.equal(parsed.name, 'X');
  assert.equal(parsed.params.filter_resonance, 1);
  assert.equal(parsed.params.filter_cutoff_hz, 900);
  assert.equal(parsed.warnings.length, 2);
  assert.throws(() => parsePresetJson('{"nope": 1}', SYNTH_PARAMS));
  assert.throws(() => parsePresetJson('not json', SYNTH_PARAMS));
});
