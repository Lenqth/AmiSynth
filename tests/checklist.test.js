// Items from the REAPER parameter review (2026-10): arpeggiator retrigger modes, the legato window,
// the guitar amp's auto level, the AmiSynth Tuning status sliders and the sustain pedal labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_off, synth_note_on, synth_render, synth_transport, synth_update } from '../src/dsp/synth.js';

const SR = 48000;

function makeSynth(overrides) {
  const s = {};
  synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...overrides });
  return s;
}

function run(s, n) {
  for (let i = 0; i < n; i++) synth_render(s);
}

/** lowest pitch whose key is down (the arpeggiator plays one note at a time) */
const playing = (s) => {
  const p = s.voices.filter((v) => v.active && v.gate).map((v) => v.pitch);
  return p.length ? Math.min(...p) : null;
};

/** Up arpeggio at `rate`; `events` is [[step, fn]]; returns the note heard a quarter into each step */
function arpSteps(retrigger, rate, stepSamples, steps, events, startBeat = 0) {
  const s = makeSynth({ arp_mode: 1, arp_rate: rate, arp_gate: 0.5, arp_retrigger: retrigger });
  synth_transport(s, 120, 1, startBeat);
  const seen = [];
  const at = new Map(events.map(([k, fn]) => [k, fn]));
  for (let k = 0; k < steps; k++) {
    at.get(k)?.(s);
    run(s, stepSamples / 4);
    seen.push(playing(s));
    at.get(k + 0.5)?.(s);
    run(s, (stepSamples * 3) / 4);
  }
  return seen;
}

const chord = (notes) => (s) => notes.forEach((n) => synth_note_on(s, n, 100));
const release = (notes) => (s) => notes.forEach((n) => synth_note_off(s, n));

test('arp retrigger: First Key keeps walking through a chord change; New Chord starts the new chord from the bottom', () => {
  const step = SR * 0.125; // 1/16 at 120 bpm
  // C major held, then D minor pressed half way through step 4 (overlapping), C released at once
  const events = [[0, chord([60, 64, 67])], [4.5, (s) => { chord([62, 65, 69])(s); release([60, 64, 67])(s); }]];
  assert.deepEqual(arpSteps(0, 4, step, 8, events), [60, 64, 67, 60, 64, 69, 62, 65]);
  assert.deepEqual(arpSteps(1, 4, step, 8, events), [60, 64, 67, 60, 64, 62, 65, 69]);
  // notes of one chord arriving a few ms apart do not restart it again
  const s = makeSynth({ arp_mode: 1, arp_rate: 4, arp_retrigger: 1 });
  synth_transport(s, 120, 1, 0);
  synth_note_on(s, 60, 100);
  run(s, step * 2.5);
  synth_note_on(s, 64, 100);
  run(s, SR * 0.01);
  synth_note_on(s, 67, 100); // 10 ms later: same chord
  run(s, step * 0.75);
  assert.equal(playing(s), 60, 'restarted once, from the bottom');
  run(s, step);
  assert.equal(playing(s), 64);
});

test('arp retrigger: Every Bar goes back to the first note at each bar line', () => {
  const step = SR * 0.25; // 1/8 at 120 bpm, 8 steps per 4/4 bar
  const events = [[0, chord([60, 64, 67])]];
  assert.deepEqual(arpSteps(0, 1, step, 10, events), [60, 64, 67, 60, 64, 67, 60, 64, 67, 60]);
  assert.deepEqual(arpSteps(2, 1, step, 10, events), [60, 64, 67, 60, 64, 67, 60, 64, 60, 64]);
  // 3/4 (synth_transport bar length 3 beats): 6 steps per bar
  const s = makeSynth({ arp_mode: 1, arp_rate: 1, arp_retrigger: 2 });
  synth_transport(s, 120, 1, 0, 3);
  chord([60, 64, 67, 71])(s);
  const seen = [];
  for (let k = 0; k < 8; k++) {
    run(s, step / 4);
    seen.push(playing(s));
    run(s, (step * 3) / 4);
  }
  assert.deepEqual(seen, [60, 64, 67, 71, 60, 64, 60, 64]);
});

test('arp retrigger: Free Run follows the host step count instead of starting at the bottom', () => {
  const step = SR * 0.125;
  const events = [[0, chord([60, 64, 67])]];
  // pressed at beat 1.25 = 1/16 step 5: 5 % 3 = 2 -> the top note first
  assert.deepEqual(arpSteps(3, 4, step, 4, events, 1.25), [67, 60, 64, 67]);
  assert.deepEqual(arpSteps(0, 4, step, 4, events, 1.25), [60, 64, 67, 60]);
  // released and pressed again: keeps its place in the song, not the bottom
  const again = [[0, chord([60, 64, 67])], [1.5, release([60, 64, 67])], [4, chord([60, 64, 67])]];
  assert.deepEqual(arpSteps(3, 4, step, 6, again), [60, 64, null, null, 64, 67]);
  assert.deepEqual(arpSteps(0, 4, step, 6, again), [60, 64, null, null, 60, 64]);
});

test('legato window: a small gap still slurs in Legato mode and glides with Glide Mode "Legato only"', () => {
  const legato = (window, gapMs) => {
    const s = makeSynth({ voice_mode: 2, amp_attack_ms: 50, amp_sustain: 1, amp_release_ms: 300, legato_window_ms: window });
    synth_note_on(s, 60, 100);
    run(s, SR * 0.2);
    synth_note_off(s, 60);
    run(s, Math.round((SR * gapMs) / 1000));
    const before = s.voices[0].amp_env.value;
    synth_note_on(s, 62, 100);
    const stage = s.voices[0].amp_env.stage;
    run(s, 50);
    return { stage, before, after: s.voices[0].amp_env.value, pitch: s.voices[0].pitch };
  };
  const off = legato(0, 5);
  assert.equal(off.stage, 1, 'window 0: a gap restarts the attack');
  const on = legato(10, 5);
  assert.equal(on.stage, 2, 'inside the window: no new attack');
  assert.equal(on.pitch, 62);
  assert.ok(on.after > on.before - 0.01 && on.after < 1.0001, 'the level goes back up to sustain, smoothly');
  assert.equal(legato(10, 15).stage, 1, 'a gap longer than the window restarts');
  // poly, Glide Mode Legato only
  const glide = (window) => {
    const s = makeSynth({ glide_ms: 100, glide_mode: 1, legato_window_ms: window });
    synth_note_on(s, 60, 100);
    run(s, 1000);
    synth_note_off(s, 60);
    run(s, SR * 0.004);
    synth_note_on(s, 67, 100);
    return s.voices.find((v) => v.active && v.gate).glide_oct;
  };
  assert.equal(glide(0), 0);
  assert.ok(glide(8) < -0.5, 'glides up from the previous note');
});

test('amp auto level: more Amp Gain no longer means much louder (within 3 dB of the dry guitar)', async () => {
  const { presetLoudness } = await import('../scripts/preset-loudness.js');
  const { PHYS_PRESETS } = await import('../src/presets/phys.js');
  const guitar = PHYS_PRESETS.find((p) => p.name === 'Distortion Power Chord');
  const lufs = (extra) => presetLoudness('phys', { ...guitar, params: { ...guitar.params, phys_volume_db: 0, ...extra } });
  const dry = lufs({ amp_type: 0 });
  const raw = lufs({ amp_type: 4, amp_gain: 1 });
  assert.ok(raw - dry > 10, `without auto level distortion is much louder (${(raw - dry).toFixed(1)} dB)`);
  for (const [amp_type, amp_gain] of [[1, 1], [2, 0.5], [3, 1], [4, 0], [4, 1]]) {
    const d = lufs({ amp_type, amp_gain, amp_auto_level: 1 }) - dry;
    assert.ok(Math.abs(d) < 3, `type ${amp_type} gain ${amp_gain}: ${d.toFixed(1)} dB from dry`);
  }
  // Amp Level still trims on top
  const trimmed = lufs({ amp_type: 4, amp_gain: 1, amp_auto_level: 1, amp_level_db: -6 }) - lufs({ amp_type: 4, amp_gain: 1, amp_auto_level: 1 });
  assert.ok(Math.abs(trimmed + 6) < 0.3, `Amp Level -6 dB: ${trimmed.toFixed(2)}`);
});

test('AmiSynth Tuning status sliders are read-only in the catalog; sustain pedal option says it follows CC64', async () => {
  const { TUNING_HOLDER_PARAMS } = await import('../src/dsp/params.js');
  const { createCatalog, validatePatch } = await import('../src/lib/reaper-catalog.js');
  const ids = TUNING_HOLDER_PARAMS.filter((d) => d.readonly).map((d) => d.id);
  assert.deepEqual(ids, ['scale_status', 'scale_loaded_notes']);
  const tuning = createCatalog().instruments.tuning;
  assert.equal(tuning.parameters.find((d) => d.id === 'scale_status').valueDomain, 'read-only');
  assert.throws(() => validatePatch(tuning, { scale_status: 1 }), /read-only/);
  assert.equal(validatePatch(tuning, { scale_size: 7 })[0].value, 7);
  const pedal = PHYS_PARAMS.find((d) => d.id === 'phys_sustain_mode');
  assert.equal(pedal.options[2], 'All models (CC64)');
  assert.ok(!pedal.options.some((o) => /^On\b/.test(o)), 'no option that reads like "always on"');
});
