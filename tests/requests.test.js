// Features added after composing a song with AmiSynth over MCP: arpeggiator + rhythm gate,
// transpose, mono / legato, wide unison, tempo-synced LFO with a duck shape, drum outputs,
// and JSFX sliders that take real values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, DRUM_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_note_off, synth_note_on, synth_render, synth_transport, synth_update } from '../src/dsp/synth.js';
import { drums_init, drums_note_on, drums_render, drums_update } from '../src/dsp/drums.js';
import { sliderLine } from '../scripts/gen-jsfx-sliders.js';

const SR = 48000;

function makeSynth(overrides) {
  const s = {};
  synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...overrides });
  return s;
}

function run(s, n, onSample = () => {}) {
  for (let i = 0; i < n; i++) {
    synth_render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r));
    onSample(i);
  }
}

/** pitches of the voices whose key is down */
const gated = (s) => s.voices.filter((v) => v.active && v.gate).map((v) => v.pitch).sort((a, b) => a - b);

test('arpeggiator: Up over 2 octaves at 1/16, 120 bpm, starts on the key press and walks the chord', () => {
  const s = makeSynth({ arp_mode: 1, arp_octaves: 2, arp_rate: 4, arp_gate: 0.5 });
  synth_transport(s, 120, 1, 0);
  for (const n of [64, 60, 67]) synth_note_on(s, n, 100);
  const step = SR * 0.125; // a 1/16 at 120 bpm
  const seen = [];
  for (let k = 0; k < 8; k++) {
    run(s, step / 4); // inside the gate
    seen.push(gated(s));
    run(s, (step * 3) / 4);
  }
  assert.deepEqual(seen, [[60], [64], [67], [72], [76], [79], [60], [64]]);
});

test('arpeggiator: Down, Up-Down and As Played orders', () => {
  const orders = { 2: [67, 64, 60, 67, 64], 3: [60, 64, 67, 64, 60], 5: [64, 60, 67, 64, 60] };
  for (const [mode, want] of Object.entries(orders)) {
    const s = makeSynth({ arp_mode: Number(mode), arp_rate: 4 });
    synth_transport(s, 120, 1, 0);
    for (const n of [64, 60, 67]) synth_note_on(s, n, 100);
    const seen = [];
    for (let k = 0; k < 5; k++) {
      run(s, 100);
      seen.push(gated(s)[0]);
      run(s, SR * 0.125 - 100);
    }
    assert.deepEqual(seen, want, `mode ${mode}`);
  }
});

test('arpeggiator: Chord mode + rhythm gate makes stabs; rests are silent and notes are released', () => {
  // 1/8 stabs, pattern on-off-on-on
  const s = makeSynth({ arp_mode: 6, arp_rate: 1, arp_gate: 0.4, arp_steps: 4, arp_step_2: 0 });
  synth_transport(s, 120, 1, 0);
  for (const n of [60, 63, 67]) synth_note_on(s, n, 100);
  const step = SR * 0.25;
  const seen = [];
  for (let k = 0; k < 5; k++) {
    run(s, step * 0.2);
    seen.push(gated(s).length);
    run(s, step * 0.8);
  }
  assert.deepEqual(seen, [3, 0, 3, 3, 3]);
  run(s, step * 0.5); // past the 40 % gate
  assert.equal(gated(s).length, 0);
});

test('arpeggiator: steps follow the host beat grid, and swing delays every second step', () => {
  const s = makeSynth({ arp_mode: 1, arp_rate: 1, arp_gate: 0.5, arp_swing_percent: 66.66666666666667 }); // 1/8, triplet shuffle
  synth_transport(s, 120, 1, 0);
  synth_note_on(s, 60, 100);
  synth_note_on(s, 62, 100);
  const starts = [];
  let down = false;
  run(s, SR, (i) => {
    const now = gated(s).length > 0;
    if (now && !down) starts.push(i);
    down = now;
  });
  // 1/8 = 0.25 s = 12000 samples: even steps on the grid, odd ones a third of a step late
  assert.deepEqual(starts.slice(0, 4), [0, 16000, 24000, 40000]);
});

test('arpeggiator: gate 1 with Legato voice mode slurs (no envelope restart)', () => {
  const s = makeSynth({ arp_mode: 1, arp_rate: 4, arp_gate: 1, voice_mode: 2, amp_attack_ms: 50, amp_sustain: 1 });
  synth_transport(s, 120, 1, 0);
  synth_note_on(s, 60, 100);
  synth_note_on(s, 67, 100);
  let drops = 0;
  let prev = 0;
  const pitches = new Set();
  run(s, SR * 0.6, () => {
    const v = s.voices[0].amp_env.value;
    if (v < prev - 1e-9) drops++;
    prev = v;
    pitches.add(s.voices[0].pitch);
  });
  assert.equal(drops, 0);
  assert.deepEqual([...pitches].sort(), [60, 67]);
});

test('arpeggiator: the host jumping back (loop) does not leave a note hanging', () => {
  const s = makeSynth({ arp_mode: 1, arp_rate: 4, arp_gate: 0.5 });
  synth_transport(s, 120, 1, 16);
  synth_note_on(s, 60, 100);
  run(s, 1000);
  synth_note_off(s, 60);
  synth_transport(s, 120, 1, 0); // loop back to the start
  run(s, 10);
  assert.deepEqual(gated(s), []);
});

test('transpose: shifts new notes, and changing it while a note sounds never leaves it hanging', () => {
  const s = makeSynth({ transpose_semitones: 2 });
  synth_note_on(s, 60, 100);
  assert.deepEqual(gated(s), [62]);
  run(s, 1000);
  synth_update(s, { ...s.p, transpose_semitones: 3 }); // automation mid-note
  synth_note_off(s, 60);
  assert.deepEqual(gated(s), []);
  synth_note_on(s, 60, 100);
  assert.deepEqual(gated(s), [63]);
});

test('mono: last note wins and returns to a key still held; legato does not restart the envelope', () => {
  for (const [mode, restarts] of [[1, true], [2, false]]) {
    const s = makeSynth({ voice_mode: mode, amp_attack_ms: 20, amp_sustain: 0.5, amp_decay_ms: 50 });
    synth_note_on(s, 48, 100);
    run(s, SR * 0.2); // in sustain
    synth_note_on(s, 55, 100);
    assert.deepEqual(gated(s), [55]);
    assert.equal(s.voices[0].amp_env.stage === 1, restarts, `mode ${mode}`);
    run(s, SR * 0.2);
    synth_note_off(s, 55);
    assert.deepEqual(gated(s), [48]);
    synth_note_off(s, 48);
    assert.deepEqual(gated(s), []);
    assert.equal(s.voices.filter((v) => v.active).length, 1); // only voice 0 is ever used
  }
});

test('glide "Legato only" glides between overlapping notes but not detached ones', () => {
  const s = makeSynth({ voice_mode: 1, glide_ms: 200, glide_mode: 1 });
  synth_note_on(s, 48, 100);
  run(s, 2000);
  synth_note_off(s, 48);
  run(s, 2000);
  synth_note_on(s, 60, 100); // detached
  assert.equal(s.voices[0].glide_oct, 0);
  synth_note_on(s, 64, 100); // overlapping
  assert.ok(s.voices[0].glide_oct < -0.3);
});

test('unison: up to 9 copies; side level and detune curve shape the spread', () => {
  const s = makeSynth({ unison_voices: 9, unison_detune_cents: 50, unison_detune_curve: 1, unison_side_level: 0.5 });
  assert.equal(s.unison_n, 9);
  assert.equal(s.unison_w[4], 1); // centre copy
  assert.equal(s.unison_w[0], 0.5);
  const cents = s.unison_ratio.map((r) => 1200 * Math.log2(r));
  assert.ok(Math.abs(cents[0] + 25) < 1e-9 && Math.abs(cents[8] - 25) < 1e-9); // outer copies keep the full spread
  assert.ok(Math.abs(cents[5]) < 1); // inner copies bunched near the centre (6.25 cents when even)
  synth_note_on(s, 60, 100);
  run(s, 4800);
});

test('synced Duck LFO pumps the level on every beat (no sidechain needed)', () => {
  const s = makeSynth({ lfo_waveform: 5, lfo_sync: 7, lfo_amp: 1, osc1_waveform: 3, osc2_level: 0, amp_sustain: 1 });
  synth_transport(s, 120, 1, 0);
  synth_note_on(s, 57, 127);
  run(s, SR); // settle
  synth_transport(s, 120, 1, 2); // exactly on beat 2
  const beat = SR / 2;
  const env = [];
  let peak = 0;
  run(s, beat, (i) => {
    peak = Math.max(peak, Math.abs(s.out_l));
    if ((i + 1) % (beat / 20) === 0) {
      env.push(peak);
      peak = 0;
    }
  });
  // peak level per 1/20 of the beat: deep dip right after the beat, then it recovers
  assert.ok(env[1] < 0.3 * env[19], `ducked after the beat: ${env.map((x) => x.toFixed(3))}`);
  assert.ok(env[1] < env[4] && env[4] < env[10] && env[10] <= env[19] + 1e-9);
});

test('drums: each group comes out on its own bus and can be left out of the main mix', () => {
  const d = {};
  drums_init(d, SR);
  drums_update(d, { ...defaultValues(DRUM_PARAMS), kick_bus_in_main: 0 });
  drums_note_on(d, 36, 120);
  drums_note_on(d, 42, 120);
  let kick = 0;
  let snare = 0;
  let hats = 0;
  let maxDiff = 0;
  for (let i = 0; i < 4800; i++) {
    drums_render(d);
    kick += Math.abs(d.bus_l[0]);
    snare += Math.abs(d.bus_l[1]);
    hats += Math.abs(d.bus_l[2]);
    maxDiff = Math.max(maxDiff, Math.abs(d.out_l - d.bus_l[2]));
  }
  assert.ok(kick > 1 && hats > 1);
  assert.equal(snare, 0);
  assert.equal(maxDiff, 0, 'main mix without the kick = the hats bus alone');
});

test('JSFX sliders take real values (no :log shape): the cutoff is written in Hz', () => {
  const cutoff = SYNTH_PARAMS.find((d) => d.id === 'filter_cutoff_hz');
  const idx = SYNTH_PARAMS.indexOf(cutoff) + 1;
  assert.equal(sliderLine(idx, cutoff), `slider${idx}:filter_cutoff_hz=1800<20,20000,1>Filter Cutoff [Hz]`);
});

test('new sliders come after the old ones, so saved REAPER projects keep their slider numbers', () => {
  assert.equal(SYNTH_PARAMS.findIndex((d) => d.id === 'master_volume_db'), 48); // slider49, as before
  assert.equal(DRUM_PARAMS.findIndex((d) => d.id === 'drum_master_volume_db'), 73); // slider74
});
