import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { phys_init, phys_note_on, phys_note_off, phys_render, phys_update, phys_set_scale } from '../src/dsp/phys.js';
import { synth_init, synth_note_on, synth_note_off, synth_render, synth_update } from '../src/dsp/synth.js';

const SR = 48000;
function string(overrides = {}) {
  const s = {}; phys_init(s, SR);
  phys_update(s, { ...defaultValues(PHYS_PARAMS), phys_model: 0, phys_room_mix: 0, phys_stereo_width: 0, ...overrides });
  return s;
}
test('sympathetic strings: driven stereo after-ring survives released voices and clears on bypass', () => {
  const s = string({ string_sympathetic_mix: 1, string_sympathetic_decay_ms: 4000, phys_release_ms: 10 });
  assert.equal(s.sympathetic.every(o => o.y1 === 0), true);
  phys_note_on(s, 60, 100); samples(s, phys_render, 0.8);
  assert.ok(s.sympathetic.some(o => Math.abs(o.y1) > 0.001));
  phys_note_off(s, 60); samples(s, phys_render, 0.7);
  assert.equal(s.voices.some(v => v.active), false);
  assert.ok(rms(samples(s, phys_render, 0.1)) > 1e-5, 'shared resonance rings without voices');
  assert.ok(Math.abs(s.out_l - s.out_r) > 1e-7, 'single note has stereo resonance');
  phys_update(s, { ...s.p, string_sympathetic_mix: 0 });
  assert.ok(s.sympathetic.every(o => o.y1 === 0 && o.y2 === 0));
});
test('sympathetic strings: custom scale retunes the fixed bank; unrelated slider edits preserve its tail', () => {
  const s = string({ string_sympathetic_mix: 1 });
  const old = s.sympathetic[1].a1;
  phys_set_scale(s, [240, 480, 720, 960, 1200], 5);
  assert.notEqual(s.sympathetic[1].a1, old);
  phys_note_on(s, 60, 100); samples(s, phys_render, 0.1);
  const tail = s.sympathetic[0].y1;
  phys_update(s, { ...s.p, phys_volume_db: -10 });
  assert.equal(s.sympathetic[0].y1, tail);
});
test('sympathetic strings: resonance has an appreciable contribution under the direct string', () => {
  for (const note of [48, 60, 64, 69, 76]) {
    const render = mix => {
      const s = string({ string_sawari: 0.65, string_damping: 0.08, string_decay_ms: 6000,
        string_brightness: 0.85, string_pick_position: 0.08,
        string_sympathetic_mix: mix, string_sympathetic_decay_ms: 4200, phys_volume_db: -12 });
      phys_note_on(s, note, 100);
      const out = new Float64Array(SR * 2);
      for (let i = 0; i < SR; i++) {
        phys_render(s); out[2 * i] = s.out_l; out[2 * i + 1] = s.out_r;
      }
      return out.subarray(SR / 5);
    };
    const dry = render(0), wet = render(0.7);
    const delta = wet.map((v, i) => v - dry[i]);
    assert.ok(rms(delta) > rms(dry) * 0.1, `note ${note}: resonance must not disappear beneath the string`);
    assert.ok(rms(delta) < rms(dry), `note ${note}: resonance must not dominate the string`);
  }
});
test('bachi: hard contact is shorter, body transient retriggers, extreme registers remain finite', () => {
  for (const note of [0, 40, 76, 127]) {
    const s = string({ string_plectrum: 1, string_body_mix: 1, string_plectrum_hardness: 1 });
    phys_note_on(s, note, 127);
    const v = s.voices[s.last_voice], hard = v.bachi_len;
    samples(s, phys_render, 0.1);
    assert.equal(v.bachi_t, hard);
    phys_note_on(s, note, 40);
    assert.equal(v.bachi_t, 0);
    assert.ok(v.bachi_len > hard);
    samples(s, phys_render, 0.1);
  }
});
test('bachi: body contact is not dominated by low wood-block resonances', () => {
  const render = mix => {
    const s = string({ string_plectrum: 0.45, string_plectrum_hardness: 0.95,
      string_body_mix: mix, string_sawari: 0.35, string_damping: 0.18, phys_volume_db: -12 });
    phys_note_on(s, 60, 100); return samples(s, phys_render, 0.05);
  };
  const dry = render(0), wet = render(0.45), delta = wet.map((v, i) => v - dry[i]);
  let low = 0, total = 0;
  for (const x of delta) total += x * x;
  for (let k = 0; k <= 75; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < delta.length; i++) {
      const phase = 2 * Math.PI * k * i / delta.length;
      re += delta[i] * Math.cos(phase); im += delta[i] * Math.sin(phase);
    }
    low += (re * re + im * im) * (k === 0 ? 1 : 2) / delta.length;
  }
  assert.ok(rms(delta) > 1e-5, 'contact remains present');
  assert.ok(low / total < 0.2, 'body transient energy below 1.5 kHz must not dominate');
});
const rms = (a) => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
function samples(s, render, seconds) {
  const out = new Float64Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    render(s); assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    assert.ok(Math.abs(s.out_l) <= 1 && Math.abs(s.out_r) <= 1);
    out[i] = s.out_l;
  }
  return out;
}

test('free reed: breath noise does not overwhelm low reeds, including musette', () => {
  for (const detune of [0, 12]) for (const note of [28, 36, 48, 60, 72]) {
    const p = { ...defaultValues(PHYS_PARAMS), phys_model: 3, wind_type: 4, phys_room_mix: 0,
      breath_pressure: 0.6, wind_embouchure: 0.5, free_reed_detune_cents: detune };
    const render = (noise) => {
      const s = {}; phys_init(s, SR); phys_update(s, { ...p, breath_noise: noise });
      phys_note_on(s, note, 100);
      return samples(s, phys_render, 1.5).subarray(SR / 2);
    };
    const tone = render(0), breath = render(1);
    const delta = breath.map((v, i) => v - tone[i]);
    assert.ok(rms(tone) > 0.005, `note ${note}: reed speaks`);
    assert.ok(rms(delta) < rms(tone) * 0.3, `note ${note}, detune ${detune}: noise must stay below the reed`);
    assert.ok(rms(delta) > 1e-5, `note ${note}: Breath Noise still adds a component`);
  }
});

function fx(type, overrides = {}) {
  const s = {}; synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), osc1_level: 0, osc2_level: 0, noise_level: 1,
    noise_type: type, filter_cutoff_hz: 12000, filter_resonance: 0, filter_env_amount_oct: 0,
    filter_key_tracking: 0, amp_attack_ms: 1, amp_sustain: 1, amp_velocity_amount: 0, ...overrides });
  return s;
}

test('FX noise: rotor has repeated pressure pulses; crowd claps have irregular transients', () => {
  const rotor = fx(4); synth_note_on(rotor, 60, 100);
  const out = samples(rotor, synth_render, 3), early = [], late = [];
  for (let i = SR; i < out.length; i++) {
    const ph = (i * 11 / SR) % 1;
    if (ph < 0.15) early.push(out[i]);
    if (ph > 0.65 && ph < 0.9) late.push(out[i]);
  }
  assert.ok(rms(early) > rms(late) * 2, 'distinct blade impulses rather than steady hiss');
  const crowd = fx(5); synth_note_on(crowd, 60, 100);
  const claps = samples(crowd, synth_render, 3);
  const levels = [];
  for (let i = SR; i < claps.length; i += SR / 100) levels.push(rms(claps.subarray(i, i + SR / 100)));
  assert.ok(Math.max(...levels) > Math.min(...levels) * 4, 'individual clap bursts rather than a continuous noise bed');
});

test('FX noise: shot stops while held, fires again on note-on, and all sources release', () => {
  const shot = fx(6); synth_note_on(shot, 60, 100);
  const hit = samples(shot, synth_render, 0.7);
  assert.ok(rms(hit.subarray(0, SR / 10)) > 0.01);
  assert.ok(rms(hit.subarray(SR / 2)) < 0.0001, 'held key does not prolong the crack');
  synth_note_on(shot, 60, 100);
  assert.ok(rms(samples(shot, synth_render, .1)) > 0.01, 'same-key retrigger fires again');
  for (const type of [4, 5, 6, 7]) for (const speed of [-4, 4]) {
    const s = fx(type, { noise_clock_oct: speed, amp_release_ms: 60 });
    synth_note_on(s, 28, 100); samples(s, synth_render, .25);
    synth_note_off(s, 28); samples(s, synth_render, 1);
    assert.equal(s.voices.filter(v => v.active).length, 0);
  }
});

test('FX noise sources do not change character with MIDI pitch when key tracking is off', () => {
  for (const type of [4, 5, 6, 7]) {
    const low = fx(type); synth_note_on(low, 28, 100); const a = samples(low, synth_render, .5);
    const high = fx(type); synth_note_on(high, 96, 100); const b = samples(high, synth_render, .5);
    assert.deepEqual(a, b, `noise type ${type}`);
  }
});

test('FX noise: unmuting Noise Level does not fire a shot from an old note', () => {
  const s = fx(6, { noise_level: 0 }); synth_note_on(s, 60, 100);
  samples(s, synth_render, 1);
  synth_update(s, { ...s.p, noise_level: 1 });
  assert.ok(rms(samples(s, synth_render, .2)) < .0001);
  synth_note_on(s, 60, 100);
  assert.ok(rms(samples(s, synth_render, .1)) > .01, 'only a new note fires again');
});

test('Rain: continuous wash with irregular short impacts, and Noise Clock controls their density', () => {
  const s = fx(7); synth_note_on(s, 60, 100);
  const rain = samples(s, synth_render, 3), levels = [];
  for (let i = SR; i < rain.length; i += SR / 100) levels.push(rms(rain.subarray(i, i + SR / 100)));
  assert.ok(Math.min(...levels) > .01, 'rain wash remains between drops');
  assert.ok(Math.max(...levels) > Math.min(...levels) * 1.3, 'drops add varying local impacts');
  // Density must alter the signal, rather than shifting MIDI pitch or imposing a periodic LFO.
  const light = fx(7, { noise_clock_oct: -2 }); synth_note_on(light, 60, 100);
  const dense = fx(7, { noise_clock_oct: 2 }); synth_note_on(dense, 60, 100);
  const a = samples(light, synth_render, 2), b = samples(dense, synth_render, 2);
  assert.ok(rms(b.subarray(SR)) > rms(a.subarray(SR)) * 1.1, 'more overlapping drops at higher density');
});

test('Gunshot: the initial crack is not dominated by a pitched bass thump', () => {
  const s = fx(6); synth_note_on(s, 60, 100);
  const out = samples(s, synth_render, .2);
  let total = 0, low = 0;
  for (const x of out) total += x * x;
  // Rectangular-window DFT: energy below 300 Hz over the whole 200 ms impact.
  for (let k = 0; k <= 60; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < out.length; i++) {
      const phase = 2 * Math.PI * k * i / out.length;
      re += out[i] * Math.cos(phase); im += out[i] * Math.sin(phase);
    }
    low += (re * re + im * im) * (k === 0 ? 1 : 2) / out.length;
  }
  assert.ok(low / total < .05, `0–300 Hz share ${(100 * low / total).toFixed(2)}%`);
});
