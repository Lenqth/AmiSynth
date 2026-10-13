import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, PHYS_PARAMS } from '../src/dsp/params.js';
import { phys_init, phys_pedal_enabled, phys_render, phys_update } from '../src/dsp/phys.js';
import { phys_midi } from '../src/dsp/midi.js';

const SR = 48000;
function make(overrides = {}) {
  const s = {};
  phys_init(s, SR);
  phys_update(s, { ...defaultValues(PHYS_PARAMS), phys_release_ms: 40, phys_room_mix: 0, ...overrides });
  phys_midi(s, 0x90, 60, 100);
  return s;
}
function render(s, frames) {
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { phys_render(s); out[i] = s.out_l; assert.ok(Number.isFinite(s.out_l)); }
  return out;
}
const pedal = (s, value) => phys_midi(s, 0xb0, 64, value);
const release = (s) => phys_midi(s, 0x80, 60, 0);

test('Physical Auto pedal covers ringing strings/piano/modal but excludes continuously driven instruments and membranes', () => {
  const p = defaultValues(PHYS_PARAMS);
  for (let model = 0; model <= 6; model++) {
    assert.equal(phys_pedal_enabled({ ...p, phys_model: model }), [0, 1, 5].includes(model));
    assert.equal(phys_pedal_enabled({ ...p, phys_model: model, phys_sustain_mode: 0 }), false);
    assert.equal(phys_pedal_enabled({ ...p, phys_model: model, phys_sustain_mode: 2 }), true);
  }
  assert.equal(phys_pedal_enabled({ ...p, phys_model: 1, modal_material: 5 }), false);
});

test('CC64 postpones release damping, keeps natural decay, and damps when the pedal rises', () => {
  for (const model of [0, 1, 5]) {
    const sustained = make({ phys_model: model });
    render(sustained, 4000); pedal(sustained, 64); release(sustained);
    assert.equal(sustained.voices[0].gate, 0);
    assert.equal(sustained.voices[0].sustained, 1);
    const actual = render(sustained, 4000);
    const held = make({ phys_model: model }); render(held, 4000);
    assert.deepEqual(actual, render(held, 4000), `model ${model}: pedal must not stop natural decay`);
    pedal(sustained, 63);
    assert.equal(sustained.voices[0].sustained, 0);
    const damped = render(sustained, SR / 2);
    const undamped = render(held, SR / 2);
    const energy = (a) => a.reduce((sum, v) => sum + v * v, 0);
    assert.ok(energy(damped) < energy(undamped) * 0.5, `model ${model}: pedal up should damp`);
  }
});

test('Auto ignores pedal for wind, brass, bowed and membranes; explicit On can sustain them', () => {
  for (const overrides of [{ phys_model: 2 }, { phys_model: 3 }, { phys_model: 4 }, { phys_model: 6 }, { phys_model: 1, modal_material: 5 }]) {
    const auto = make(overrides); pedal(auto, 127); release(auto);
    assert.equal(auto.voices[0].sustained, 0);
    const on = make({ ...overrides, phys_sustain_mode: 2 }); pedal(on, 127); release(on);
    assert.equal(on.voices[0].sustained, 1);
    pedal(on, 0); assert.equal(on.voices[0].sustained, 0);
  }
});

test('Retrigger and voice stealing cannot inherit a deferred note-off', () => {
  const s = make(); pedal(s, 127); release(s);
  phys_midi(s, 0x90, 60, 100); pedal(s, 0);
  assert.equal(s.voices[0].gate, 1);
  assert.equal(s.voices[0].sustained, 0);
  pedal(s, 127); release(s);
  for (let note = 61; note <= 68; note++) phys_midi(s, 0x90, note, 100);
  assert.ok(s.voices.every((v) => v.gate === 1 && v.sustained === 0));
  pedal(s, 0);
  assert.ok(s.voices.every((v) => v.gate === 1));
});

test('Zero-velocity note-on, panic/reset CCs and disabling/changing the model release pending notes', () => {
  for (const cc of [120, 121, 123]) {
    const s = make({ phys_model: 5 }); pedal(s, 127);
    phys_midi(s, 0x90, 60, 0);
    assert.equal(s.voices[0].sustained, 1);
    phys_midi(s, 0xb0, cc, 0);
    assert.equal(s.sustain_pedal, 0);
    assert.ok(s.voices.every((v) => !v.sustained));
  }
  for (const update of [{ phys_sustain_mode: 0 }, { phys_model: 3 }, { phys_model: 1, modal_material: 5 }]) {
    const s = make(); pedal(s, 127); release(s);
    const gain = s.voices[0].loop_gain;
    phys_update(s, { ...s.p, ...update });
    assert.equal(s.voices[0].sustained, 0);
    assert.ok(s.voices[0].loop_gain < gain, 'release uses previous string model before switching');
  }
  const held = make(); pedal(held, 127); phys_midi(held, 0xb0, 121, 0);
  assert.equal(held.voices[0].gate, 1, 'reset controller must preserve a physically held key');
});
