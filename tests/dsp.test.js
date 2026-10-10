import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, DRUM_PARAMS, DRUM_PARTS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_off, synth_note_on, synth_render, synth_update } from '../src/dsp/synth.js';
import { drums_init, drums_note_on, drums_render, drums_update } from '../src/dsp/drums.js';
import { tuning_init, tuning_note_to_hz, tuning_set_edo, tuning_set_table } from '../src/dsp/lib.js';

const SR = 48000;

function stats(render, s, n) {
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r), 'finite output');
    peak = Math.max(peak, Math.abs(s.out_l), Math.abs(s.out_r));
    sum += s.out_l * s.out_l;
  }
  return { peak, rms: Math.sqrt(sum / n) };
}

test('param ids are unique and defaults within range', () => {
  for (const defs of [SYNTH_PARAMS, DRUM_PARAMS]) {
    const ids = new Set();
    for (const d of defs) {
      assert.ok(!ids.has(d.id), `duplicate ${d.id}`);
      ids.add(d.id);
      assert.match(d.id, /^[a-z][a-z0-9_]*$/);
      assert.ok(d.default >= d.min && d.default <= d.max, d.id);
    }
  }
});

test('tuning: 12-EDO, 19-EDO and custom table', () => {
  const t = {};
  tuning_init(t);
  assert.ok(Math.abs(tuning_note_to_hz(t, 69) - 440) < 1e-9);
  assert.ok(Math.abs(tuning_note_to_hz(t, 60) - 261.6256) < 1e-3);
  assert.ok(Math.abs(tuning_note_to_hz(t, 57) - 220) < 1e-9);
  tuning_set_edo(t, 19, 1200);
  assert.ok(Math.abs(tuning_note_to_hz(t, 69 + 19) - 880) < 1e-9);
  assert.ok(Math.abs(tuning_note_to_hz(t, 69 - 19) - 220) < 1e-9);
  // just intonation major triad-ish table: 386.3, 702, 1200
  tuning_set_table(t, [386.3137, 701.955, 1200], 3);
  assert.ok(Math.abs(tuning_note_to_hz(t, 71) - 660) < 0.01);
  assert.ok(Math.abs(tuning_note_to_hz(t, 68) - 330) < 0.01); // one period down, degree 2
});

test('synth renders bounded audio for a chord and releases', () => {
  const s = {};
  synth_init(s, SR);
  synth_update(s, defaultValues(SYNTH_PARAMS));
  for (const n of [60, 64, 67, 71, 74, 77, 81, 84, 88]) synth_note_on(s, n, 100); // 9 > 8 voices: stealing
  const on = stats(synth_render, s, SR / 2);
  assert.ok(on.rms > 0.02, `audible ${on.rms}`);
  assert.ok(on.peak <= 1);
  for (const n of [60, 64, 67, 71, 74, 77, 81, 84, 88]) synth_note_off(s, n);
  stats(synth_render, s, SR * 2);
  assert.equal(s.voices.filter((v) => v.active).length, 0);
});

test('synth all waveforms and 12/24 dB slopes stay finite with max resonance', () => {
  for (const w of [0, 1, 2]) for (const slope of [0, 1]) {
    const s = {};
    synth_init(s, SR);
    synth_update(s, { ...defaultValues(SYNTH_PARAMS), osc1_waveform: w, osc2_waveform: w, filter_slope: slope, filter_resonance: 1 });
    synth_note_on(s, 48, 127);
    const r = stats(synth_render, s, SR / 4);
    assert.ok(r.rms > 0.005, `w${w} s${slope} rms ${r.rms}`);
  }
});

test('every drum part makes sound and decays; closed hat chokes open hat', () => {
  for (const note of DRUM_PARTS.map((p) => p.note)) {
    const d = {};
    drums_init(d, SR);
    drums_update(d, defaultValues(DRUM_PARAMS));
    drums_note_on(d, note, 120);
    const r = stats(drums_render, d, SR / 10);
    assert.ok(r.rms > 0.005, `note ${note} rms ${r.rms}`);
    assert.ok(r.peak <= 1);
    const tail = stats(drums_render, d, SR * 4);
    const end = stats(drums_render, d, 1000);
    assert.ok(end.peak < 1e-3, `note ${note} decays (${end.peak}, tail ${tail.peak})`);
  }
  const d = {};
  drums_init(d, SR);
  drums_update(d, defaultValues(DRUM_PARAMS));
  drums_note_on(d, 46, 120);
  stats(drums_render, d, 2000);
  drums_note_on(d, 42, 120);
  stats(drums_render, d, SR * 0.03);
  assert.ok(d.open_hat.env.value < 1e-3, `open hat choked (${d.open_hat.env.value})`);
});

test('generated JSFX slider lines are well-formed', async () => {
  const { sliderLine } = await import('../scripts/gen-jsfx-sliders.js');
  for (const defs of [SYNTH_PARAMS, DRUM_PARAMS]) {
    assert.ok(defs.length <= 256, 'JSFX supports up to 256 sliders');
    defs.forEach((d, i) => {
      assert.match(sliderLine(i + 1, d), /^slider\d+:[a-z][a-z0-9_]*=-?[\d.]+<-?[\d.]+,-?[\d.]+,[\d.]+(\{[^}]+\}|:log)?>[^<>]+$/);
    });
  }
});
