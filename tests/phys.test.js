import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampParam, defaultValues, PHYS_PARAMS } from '../src/dsp/params.js';
import { MATERIALS, phys_init, phys_note_off, phys_note_on, phys_pitch_bend, phys_render, phys_snapshot, phys_update } from '../src/dsp/phys.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { resolvePreset } from '../src/lib/presets.js';

const SR = 48000;

function make(overrides) {
  const s = {};
  phys_init(s, SR);
  phys_update(s, { ...defaultValues(PHYS_PARAMS), ...overrides });
  return s;
}

function render(s, n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phys_render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    out[i] = s.out_l;
  }
  return out;
}

/** autocorrelation pitch with parabolic refinement, searching around the expected period */
function pitch(buf, expectHz) {
  const p0 = SR / expectHz;
  const corr = (lag) => {
    let c = 0;
    for (let i = 0; i < buf.length - lag; i++) c += buf[i] * buf[i + lag];
    return c;
  };
  let best = -Infinity;
  let lag = 0;
  for (let L = Math.floor(p0 * 0.9); L <= Math.ceil(p0 * 1.1); L++) {
    const c = corr(L);
    if (c > best) {
      best = c;
      lag = L;
    }
  }
  const a = corr(lag - 1);
  const b = corr(lag);
  const c = corr(lag + 1);
  return SR / (lag + (0.5 * (a - c)) / (a - 2 * b + c));
}

const rms = (a) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length);
const cents = (f, ref) => 1200 * Math.log2(f / ref);

test('string model is in tune across the range (loop filter delay compensated)', () => {
  for (const note of [40, 57, 69, 81]) {
    const s = make({ phys_model: 0 });
    phys_note_on(s, note, 100);
    render(s, SR * 0.1);
    const hz = 440 * 2 ** ((note - 69) / 12);
    const f = pitch(render(s, 8000), hz);
    assert.ok(Math.abs(cents(f, hz)) < 3, `note ${note}: ${f.toFixed(2)} Hz vs ${hz.toFixed(2)}`);
  }
});

test('string: decays, and note-off damps it faster', () => {
  const held = make({ phys_model: 0, string_decay_ms: 3000, phys_release_ms: 100 });
  const released = make({ phys_model: 0, string_decay_ms: 3000, phys_release_ms: 100 });
  phys_note_on(held, 57, 100);
  phys_note_on(released, 57, 100);
  render(held, SR * 0.05);
  render(released, SR * 0.05);
  phys_note_off(released, 57);
  render(held, SR * 0.1);
  render(released, SR * 0.1);
  // 0.1 s after release: the damped string (T60 = 100 ms) is ~60 dB down, the held one is not
  const a = rms(render(held, SR * 0.2));
  const b = rms(render(released, SR * 0.2));
  assert.ok(a > 0.01, `held audible ${a}`);
  assert.ok(b < a * 0.01, `released damped (${b} vs ${a})`);
});

test('pitch bend retunes the string', () => {
  const s = make({ phys_model: 0, phys_pitch_bend_range_cents: 200 });
  phys_note_on(s, 57, 100);
  render(s, SR * 0.05);
  phys_pitch_bend(s, 1); // +200 cents
  render(s, 2000);
  const f = pitch(render(s, 8000), 220 * 2 ** (2 / 12));
  assert.ok(Math.abs(cents(f, 220 * 2 ** (2 / 12))) < 4, `bent ${f}`);
});

test('modal model: every material sounds, is bounded and rings at the fundamental', () => {
  MATERIALS.forEach((m, i) => {
    const s = make({ phys_model: 1, modal_material: i });
    phys_note_on(s, 57, 110);
    const out = render(s, SR * 0.5);
    assert.ok(rms(out) > 0.005, `${m.name} audible`);
    assert.ok(Math.max(...out.map(Math.abs)) <= 1, `${m.name} bounded`);
    const v = s.voices[s.last_voice];
    const k = m.ratios.indexOf(1);
    assert.ok(Math.abs(v.mode_hz[k] - 220) < 1e-6, `${m.name} has a mode at the note frequency`);
  });
});

test('every physical preset is valid and audible', () => {
  for (const preset of PHYS_PRESETS) {
    for (const [id, v] of Object.entries(preset.params)) {
      const d = PHYS_PARAMS.find((x) => x.id === id);
      assert.ok(d, `${preset.name}: unknown param ${id}`);
      assert.equal(clampParam(d, v), v, `${preset.name}: ${id} out of range`);
    }
    const s = make(resolvePreset(PHYS_PARAMS, preset));
    for (const n of [48, 60, 64, 67]) phys_note_on(s, n, 100);
    const out = render(s, SR * 0.5);
    assert.ok(rms(out) > 0.005, `${preset.name} audible (${rms(out)})`);
    assert.ok(Math.max(...out.map(Math.abs)) <= 1);
  }
});

test('visualisation snapshots describe the last voice', () => {
  const s = make({ phys_model: 0 });
  assert.equal(phys_snapshot(s).active, false);
  phys_note_on(s, 57, 100);
  render(s, 500);
  const a = phys_snapshot(s);
  assert.equal(a.model, 'string');
  assert.ok(a.wave.length > 50 && Math.abs(a.delaySamples - SR / 220) < 2);
  const m = make({ phys_model: 1 });
  phys_note_on(m, 57, 100);
  render(m, 500);
  const b = phys_snapshot(m);
  assert.equal(b.model, 'modal');
  assert.equal(b.modes.length, 8);
  assert.ok(b.modes[0].amp > 0);
});

test('voices free themselves after decaying', () => {
  const s = make({ phys_model: 1, modal_decay_ms: 100, phys_release_ms: 50 });
  phys_note_on(s, 60, 100);
  phys_note_off(s, 60);
  render(s, SR * 1.5);
  assert.equal(s.voices.filter((v) => v.active).length, 0);
});
