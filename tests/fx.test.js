// Synth effects after the voice sum: chorus -> delay -> reverb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELAY_SYNC_BEATS, defaultValues, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_off, synth_note_on, synth_render, synth_transport, synth_update } from '../src/dsp/synth.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';

const SR = 48000;

function makeSynth(overrides, bpm = 120) {
  const s = {};
  synth_init(s, SR);
  synth_transport(s, bpm, 1, 0); // tempo first, so a synced delay starts at its time instead of gliding there
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...overrides });
  return s;
}

/** A short blip (note on, off after `len` samples), then `n` samples in total. */
function blip(s, n, len = 600) {
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  synth_note_on(s, 69, 110);
  for (let i = 0; i < n; i++) {
    if (i === len) synth_note_off(s, 69);
    synth_render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    l[i] = s.out_l;
    r[i] = s.out_r;
  }
  return { l, r };
}

const PLUCK = { amp_attack_ms: 0.5, amp_decay_ms: 30, amp_sustain: 0, amp_release_ms: 5, filter_cutoff_hz: 5000 };
const energy = (a, from, to) => {
  let e = 0;
  for (let i = from; i < to; i++) e += a[i] * a[i];
  return e;
};

test('effects default Off and are a true bypass: their settings change nothing while Off', () => {
  for (const d of SYNTH_PARAMS.filter((d) => /^fx_.*_on$/.test(d.id))) assert.equal(d.default, 0, d.id);
  const off = blip(makeSynth(PLUCK), 8000);
  const tweaked = blip(makeSynth({
    ...PLUCK, fx_chorus_mix: 1, fx_chorus_depth_ms: 8, fx_delay_mix: 1, fx_delay_feedback: 0.9, fx_delay_sync: 0,
    fx_delay_time_ms: 5, fx_reverb_mix: 1, fx_reverb_decay_ms: 15000,
  }), 8000);
  assert.deepEqual(tweaked.l, off.l);
  assert.deepEqual(tweaked.r, off.r);
});

test('no built-in preset that predates the effects switches one on', () => {
  const first = SYNTH_PRESETS.findIndex((p) => p.name === 'Ambient Hall Pad');
  assert.ok(first > 0);
  for (const p of SYNTH_PRESETS.slice(0, first)) {
    assert.deepEqual(Object.keys(p.params).filter((k) => k.startsWith('fx_')), [], p.name);
  }
  // and the new ones each use at least one effect
  for (const p of SYNTH_PRESETS.slice(first)) {
    assert.ok(['fx_chorus_on', 'fx_delay_on', 'fx_reverb_on'].some((k) => p.params[k] === 1), p.name);
  }
});

/** first sample index after `from` where |x| exceeds `th` */
const onset = (a, from, th) => {
  for (let i = from; i < a.length; i++) if (Math.abs(a[i]) > th) return i;
  return -1;
};

test('delay synced to the tempo: a 1/4 echo comes one beat later and follows the BPM', () => {
  const quarter = DELAY_SYNC_BEATS.indexOf(1);
  for (const bpm of [120, 150]) {
    const beat = (60 / bpm) * SR;
    const { l } = blip(makeSynth({
      ...PLUCK, fx_delay_on: 1, fx_delay_sync: quarter, fx_delay_feedback: 0, fx_delay_mix: 0.5, fx_delay_high_cut_hz: 20000,
    }, bpm), Math.round(beat * 1.5));
    // the dry blip is over long before the echo: the echo starts one beat after the note
    const t = onset(l, 3000, 0.01) - onset(l, 0, 0.01);
    assert.ok(Math.abs(t - beat) < 4, `${bpm} bpm: echo after ${t} samples, expected ${beat}`);
  }
});

test('delay: free time in ms when sync is Off, feedback repeats and the high cut darkens them', () => {
  const p = { ...PLUCK, fx_delay_on: 1, fx_delay_sync: 0, fx_delay_time_ms: 100, fx_delay_mix: 0.5, fx_delay_high_cut_hz: 20000 };
  const d = 0.1 * SR;
  const once = blip(makeSynth({ ...p, fx_delay_feedback: 0 }), 5 * d).l;
  const fb = blip(makeSynth({ ...p, fx_delay_feedback: 0.6 }), 5 * d).l;
  assert.ok(Math.abs(onset(once, 3000, 0.01) - onset(once, 0, 0.01) - d) < 4);
  // no repeat at 2 x time without feedback, a clear one with it
  assert.ok(energy(once, 2 * d - 100, 2 * d + 2000) < 1e-9);
  assert.ok(energy(fb, 2 * d - 100, 2 * d + 2000) > 0.01 * energy(fb, d - 100, d + 2000));
  // a low high cut takes the edge off the echoes (less high-frequency energy: first difference)
  const dark = blip(makeSynth({ ...p, fx_delay_feedback: 0.6, fx_delay_high_cut_hz: 500 }), 5 * d).l;
  const hf = (a) => { let e = 0; for (let i = 2 * d; i < 3 * d; i++) e += (a[i] - a[i - 1]) ** 2; return e / energy(a, 2 * d, 3 * d); };
  assert.ok(hf(dark) < hf(fb) * 0.5);
});

test('ping-pong: the first echo is on the left only, the second on the right', () => {
  const d = 0.1 * SR;
  const { l, r } = blip(makeSynth({
    ...PLUCK, unison_voices: 1, fx_delay_on: 1, fx_delay_sync: 0, fx_delay_time_ms: 100, fx_delay_feedback: 0.7,
    fx_delay_ping_pong: 1, fx_delay_mix: 1, fx_delay_high_cut_hz: 20000,
  }), 3 * d);
  const e1l = energy(l, d - 50, d + 2000);
  const e1r = energy(r, d - 50, d + 2000);
  const e2l = energy(l, 2 * d - 50, 2 * d + 2000);
  const e2r = energy(r, 2 * d - 50, 2 * d + 2000);
  assert.ok(e1l > 0 && e1r < e1l * 1e-6, `first echo L ${e1l} R ${e1r}`);
  assert.ok(e2r > 0 && e2l < e2r * 1e-6, `second echo L ${e2l} R ${e2r}`);
});

test('delay feedback at the maximum stays bounded', () => {
  const s = makeSynth({ fx_delay_on: 1, fx_delay_sync: 0, fx_delay_time_ms: 20, fx_delay_feedback: 0.95, fx_delay_high_cut_hz: 20000, fx_delay_mix: 1 });
  const { l } = blip(s, SR * 2, SR);
  assert.ok(l.every((x) => Math.abs(x) <= 1));
  assert.ok(energy(l, SR * 2 - 4800, SR * 2) < energy(l, SR - 4800, SR));
});

test('chorus makes a mono patch stereo; reverb leaves a tail whose length follows Decay', () => {
  const mono = blip(makeSynth({ unison_voices: 1 }), 12000, 12000);
  assert.deepEqual(mono.l, mono.r);
  const ch = blip(makeSynth({ unison_voices: 1, fx_chorus_on: 1, fx_chorus_depth_ms: 5 }), 12000, 12000);
  let diff = 0;
  for (let i = 0; i < ch.l.length; i++) diff += (ch.l[i] - ch.r[i]) ** 2;
  assert.ok(diff > 0.01 * energy(ch.l, 0, ch.l.length));

  const n = SR * 2;
  const tail = (decay) => blip(makeSynth({ ...PLUCK, fx_reverb_on: 1, fx_reverb_mix: 0.5, fx_reverb_decay_ms: decay }), n).l;
  const short = tail(500);
  const long = tail(5000);
  const dry = blip(makeSynth(PLUCK), n).l;
  assert.ok(energy(dry, SR / 2, SR) < 1e-12);
  assert.ok(energy(short, SR / 2, SR) > 0);
  assert.ok(energy(long, SR, n) > 100 * energy(short, SR, n));
});

test('switching an effect on starts from silence (no old tail comes back)', () => {
  const p = { ...PLUCK, fx_delay_sync: 0, fx_delay_time_ms: 300, fx_delay_feedback: 0.9 };
  const s = makeSynth({ ...p, fx_delay_on: 1, fx_reverb_on: 1, fx_chorus_on: 1 });
  blip(s, 4000);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...p }); // all off: the memory still holds echoes
  for (let i = 0; i < 4000; i++) synth_render(s);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...p, fx_delay_on: 1, fx_reverb_on: 1, fx_chorus_on: 1 });
  for (let i = 0; i < SR; i++) {
    synth_render(s);
    assert.equal(s.out_l, 0);
  }
});
