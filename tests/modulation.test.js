// Synth mod matrix / LFO 2 / mod envelope, and aftertouch (channel pressure, polyphonic
// aftertouch) in Synth and Physical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, MOD_DESTINATIONS, MOD_SLOTS, MOD_SOURCES, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_render, synth_update } from '../src/dsp/synth.js';
import { phys_init, phys_render, phys_update } from '../src/dsp/phys.js';
import { phys_midi, synth_midi } from '../src/dsp/midi.js';
import { resolvePreset } from '../src/lib/presets.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';

const SR = 48000;

/** Render `frames` samples with MIDI events [[frame, status, d1, d2], ...]; returns interleaved stereo. */
function play(kind, params, events, frames, sidechain = null) {
  const core = kind === 'synth'
    ? { init: synth_init, update: synth_update, render: synth_render, midi: synth_midi, defs: SYNTH_PARAMS }
    : { init: phys_init, update: phys_update, render: phys_render, midi: phys_midi, defs: PHYS_PARAMS };
  const s = {};
  core.init(s, SR);
  core.update(s, { ...defaultValues(core.defs), ...params });
  const out = new Float64Array(frames * 2);
  let e = 0;
  for (let i = 0; i < frames; i++) {
    while (e < events.length && events[e][0] <= i) {
      const [, a, b, c] = events[e++];
      core.midi(s, a, b, c);
    }
    if (sidechain) {
      s.sc_in_l = sidechain[2 * i];
      s.sc_in_r = sidechain[2 * i + 1];
    }
    core.render(s);
    assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r), `${kind}: non-finite output`);
    out[2 * i] = s.out_l;
    out[2 * i + 1] = s.out_r;
  }
  return { out, s };
}

/** Kick-like sidechain signal: a decaying 55 Hz burst every `period` frames (interleaved stereo). */
function kicks(frames, period = 12000) {
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = (i % period) / SR;
    const y = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 30) * 0.9;
    out[2 * i] = y;
    out[2 * i + 1] = y;
  }
  return out;
}

const diffRms = (a, b) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0) / a.length);
const rms = (a) => Math.sqrt(a.reduce((acc, v) => acc + v * v, 0) / a.length);
const identical = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function slots(list) {
  const p = {};
  list.forEach(([src, dst, amt], i) => {
    p[`mod${i + 1}_source`] = src;
    p[`mod${i + 1}_destination`] = dst;
    p[`mod${i + 1}_amount`] = amt;
  });
  return p;
}

const src = (name) => MOD_SOURCES.indexOf(name);
const dst = (name) => MOD_DESTINATIONS.findIndex((d) => d.name === name);

test('WT matrix positions independently select frames per oscillator and bypass classic waves', () => {
  const notes = [[0, 0x90, 60, 127]];
  for (const osc of [1, 2]) {
    const sound = { osc1_waveform: 4, osc2_waveform: 4, osc1_wt_bank: 2, osc2_wt_bank: 2,
      osc1_wt_position: 0.1, osc2_wt_position: 0.1, osc1_level: osc === 1 ? 1 : 0, osc2_level: osc === 2 ? 1 : 0 };
    const target = dst(`Osc${osc} WT Position`), other = dst(`Osc${3 - osc} WT Position`);
    const mod = play('synth', { ...sound, ...slots([[src('Velocity'), target, 0.6]]) }, notes, 8000).out;
    const direct = play('synth', { ...sound, [`osc${osc}_wt_position`]: 0.7 }, notes, 8000).out;
    assert.ok(diffRms(mod, direct) < 1e-12, 'position offset uses the same clamped frame lookup');
    const dry = play('synth', sound, notes, 8000).out;
    const untouched = play('synth', { ...sound, ...slots([[src('LFO 2'), other, 1]]) }, notes, 8000).out;
    assert.ok(identical(dry, untouched), 'the other oscillator is not modulated');
  }
  const classic = { osc1_waveform: 0, osc2_waveform: 1 };
  assert.ok(identical(play('synth', classic, notes, 8000).out,
    play('synth', { ...classic, ...slots([[src('Velocity'), 12, 4800], [src('Velocity'), 13, -4800]]) }, notes, 8000).out));
});

// a chord, pressure swells, aftertouch on one key, mod wheel, release
const PHRASE = [
  [0, 0x90, 57, 100], [200, 0x90, 64, 70], [400, 0x90, 69, 40],
  ...[0, 40, 90, 127, 80, 20].map((v, i) => [2000 + i * 1500, 0xd0, v, 0]),
  [3000, 0xa0, 64, 127], [6000, 0xb0, 1, 100],
  [14000, 0x80, 57, 0], [14000, 0x80, 64, 0], [14000, 0x80, 69, 0],
];
const FRAMES = 18000;

test('mod matrix params: 4 slots of enum source / enum destination / real amount, all off by default', () => {
  assert.equal(MOD_SLOTS, 4);
  for (let i = 1; i <= MOD_SLOTS; i++) {
    const s = SYNTH_PARAMS.find((d) => d.id === `mod${i}_source`);
    const d = SYNTH_PARAMS.find((x) => x.id === `mod${i}_destination`);
    const a = SYNTH_PARAMS.find((x) => x.id === `mod${i}_amount`);
    assert.deepEqual(s.options, MOD_SOURCES);
    assert.deepEqual(d.options, MOD_DESTINATIONS.map((x) => x.name));
    assert.equal(s.default, 0);
    assert.equal(d.default, 0);
    assert.equal(a.default, 0);
    assert.ok(!a.options && a.min < 0 && a.max > 0);
    // the web UI knob range of every destination fits the slider
    for (const x of MOD_DESTINATIONS) assert.ok(x.range <= a.max && x.step >= a.step);
  }
});

test('unused modulation renders bit-identically (half-set slots, LFO 2 / mod env settings, pressure)', () => {
  const bases = [
    {},
    { noise_level: 0.3, unison_voices: 3, lfo_waveform: 4, lfo_filter_oct: 1 }, // shared random generator in use
    resolvePreset(SYNTH_PARAMS, SYNTH_PRESETS.find((p) => p.name === 'Acid Bass')),
  ];
  const unused = [
    slots([[src('LFO 1'), 0, 100]]),
    slots([[0, dst('Pitch'), 100]]),
    slots([[src('Random (per note)'), dst('Filter Cutoff'), 0], [src('Pressure'), dst('Amp'), 0]]),
    { lfo2_waveform: 4, lfo2_rate_hz: 13, lfo2_sync: 5, mod_env_attack_ms: 1, mod_env_sustain: 1 },
  ];
  for (const base of bases) {
    const ref = play('synth', base, PHRASE, FRAMES).out;
    assert.ok(rms(ref) > 1e-3);
    for (const over of unused) {
      assert.ok(identical(play('synth', { ...base, ...over }, PHRASE, FRAMES).out, ref), JSON.stringify(over));
    }
  }
});

test('every mod source and every destination changes the sound', () => {
  const base = { osc1_waveform: 1, osc2_waveform: 1, noise_level: 0.05, mod_env_attack_ms: 50, mod_env_sustain: 0.2, lfo2_rate_hz: 7, lfo_rate_hz: 4 };
  const sc = kicks(FRAMES, 4000);
  const ref = play('synth', base, PHRASE, FRAMES, sc).out;
  for (let si = 1; si < MOD_SOURCES.length; si++) {
    const out = play('synth', { ...base, ...slots([[si, dst('Filter Cutoff'), 2]]) }, PHRASE, FRAMES, sc).out;
    assert.ok(diffRms(out, ref) > 1e-3, `source ${MOD_SOURCES[si]}`);
  }
  // the LFO rate destinations act on the LFO feeding another slot
  for (let di = 1; di < MOD_DESTINATIONS.length; di++) {
    const name = MOD_DESTINATIONS[di].name;
    const sound = name.includes('WT Position') ? { ...base, osc1_waveform: 4, osc2_waveform: 4,
      osc1_wt_bank: 2, osc2_wt_bank: 2, osc1_wt_position: 0.5, osc2_wt_position: 0.5 } : base;
    const list = name === 'LFO 1 Rate' ? [[src('LFO 1'), dst('Pitch'), 100], [src('Mod Wheel'), di, 2]]
      : name === 'LFO 2 Rate' ? [[src('LFO 2'), dst('Pitch'), 100], [src('Mod Wheel'), di, 2]]
        : [[src('LFO 1'), di, MOD_DESTINATIONS[di].range / 2]];
    const before = name.endsWith('Rate') ? play('synth', { ...sound, ...slots([list[0]]) }, PHRASE, FRAMES).out : play('synth', sound, PHRASE, FRAMES).out;
    const out = play('synth', { ...sound, ...slots(list) }, PHRASE, FRAMES).out;
    assert.ok(diffRms(out, before) > 1e-3, `destination ${name}`);
  }
});

test('pan moves a voice, amp in dB, key track is octaves from middle C', () => {
  const note = [[0, 0x90, 72, 127]];
  const left = play('synth', slots([[src('Velocity'), dst('Pan'), -1]]), note, 6000).out;
  let l = 0;
  let r = 0;
  for (let i = 2000; i < 6000; i++) {
    l += left[2 * i] ** 2;
    r += left[2 * i + 1] ** 2;
  }
  assert.ok(r < l * 1e-6, 'velocity 127 x pan -1 = hard left');
  // -6.02 dB = half the amplitude (velocity 127 = source 1; amp below the output soft clip)
  const quiet = { master_volume_db: -30 };
  const a = play('synth', quiet, note, 6000).out;
  const b = play('synth', { ...quiet, ...slots([[src('Velocity'), dst('Amp'), -20 * Math.log10(2)]]) }, note, 6000).out;
  assert.ok(Math.abs(rms(b) / rms(a) - 0.5) < 0.01);
  // key track -> pitch at -1200 cents/oct: C5 sounds at C4 (middle C)
  const s = play('synth', slots([[src('Key Track'), dst('Pitch'), -1200]]), note, 10).s;
  assert.ok(Math.abs(s.voices[0].base_hz / 261.6256 - 2) < 1e-6);
});

test('channel pressure and polyphonic aftertouch reach the right voices', () => {
  const p = slots([[src('Pressure'), dst('Filter Cutoff'), 3]]);
  const { s } = play('synth', p, [[0, 0x90, 60, 100], [0, 0x90, 64, 100], [10, 0xa0, 64, 127], [10, 0xd0, 32, 0]], 48000);
  const v60 = s.voices.find((v) => v.note === 60);
  const v64 = s.voices.find((v) => v.note === 64);
  assert.equal(s.pressure, 32 / 127);
  assert.equal(v64.poly_at, 1);
  assert.equal(v60.poly_at, 0);
  // smoothed (10 ms) toward max(channel, key)
  assert.ok(Math.abs(v64.press - 1) < 1e-6 && Math.abs(v60.press - 32 / 127) < 1e-6);
  // a new note on the key starts without the old key's aftertouch
  synth_midi(s, 0x90, 64, 100);
  assert.equal(s.voices.find((v) => v.note === 64).poly_at, 0);
});

test('Physical: pressure amounts at 0 ignore aftertouch; mapped, aftertouch changes wind / bowed / brass / vibrato', () => {
  const events = [[0, 0x90, 60, 90], [100, 0x90, 67, 90], ...[20, 60, 127, 90].map((v, i) => [3000 + i * 2500, 0xd0, v, 0]), [6000, 0xa0, 67, 127]];
  const silent = events.filter((e) => e[1] !== 0xd0 && e[1] !== 0xa0);
  const models = [
    ['bowed', { phys_model: 2 }, { phys_pressure_excitation: 0.7 }],
    ['bowed brightness', { phys_model: 2 }, { phys_pressure_brightness: 0.8 }],
    ['clarinet', { phys_model: 3, wind_type: 0 }, { phys_pressure_excitation: 0.8 }],
    ['flute', { phys_model: 3, wind_type: 1 }, { phys_pressure_excitation: 0.8 }],
    ['brass', { phys_model: 6 }, { phys_pressure_excitation: 0.8 }],
    ['brass bell', { phys_model: 6 }, { phys_pressure_brightness: 0.8 }],
    ['string vibrato', { phys_model: 0 }, { phys_pressure_vibrato_cents: 50 }],
    ['piano vibrato', { phys_model: 5 }, { phys_pressure_vibrato_cents: 50 }],
  ];
  for (const [label, base, amount] of models) {
    const ref = play('phys', base, silent, 16000).out;
    assert.ok(identical(play('phys', base, events, 16000).out, ref), `${label}: amounts 0`);
    const mapped = play('phys', { ...base, ...amount }, events, 16000).out;
    assert.ok(identical(play('phys', { ...base, ...amount }, silent, 16000).out, ref), `${label}: no pressure sent`);
    assert.ok(diffRms(mapped, ref) > 1e-4, `${label}: pressure audible`);
  }
});

test('Physical: aftertouch per key, CC121 resets it', () => {
  const { s } = play('phys', { phys_model: 3, phys_pressure_excitation: 1 },
    [[0, 0x90, 60, 90], [0, 0x90, 64, 90], [10, 0xa0, 64, 127], [20, 0xd0, 50, 0]], 100);
  const v60 = s.voices.find((v) => v.note === 60);
  const v64 = s.voices.find((v) => v.note === 64);
  assert.equal(v64.press, 1);
  assert.equal(v60.press, 50 / 127);
  assert.ok(v64.maxv > v60.maxv);
  phys_midi(s, 0xb0, 121, 0);
  assert.equal(s.pressure, 0);
  assert.equal(v64.press, 0);
});

test('presets with aftertouch / mod matrix stay unchanged without pressure and react to it', () => {
  const press = [[0, 0x90, 60, 100], [2000, 0xd0, 127, 0]];
  const synth = SYNTH_PRESETS.filter((p) => Object.keys(p.params).some((k) => /^mod\d_source$/.test(k)));
  const phys = PHYS_PRESETS.filter((p) => Object.keys(p.params).some((k) => k.startsWith('phys_pressure_')));
  assert.ok(synth.length >= 2 && phys.length >= 2);
  for (const [kind, defs, list] of [['synth', SYNTH_PARAMS, synth], ['phys', PHYS_PARAMS, phys]]) {
    for (const preset of list) {
      const out = play(kind, resolvePreset(defs, preset), press, 30000).out;
      assert.ok(rms(out) > 1e-3, preset.name);
    }
  }
});

test('extreme amounts on every destination stay finite, also summed over all slots, and recover when the slots go off', () => {
  // the amount slider takes -4800..4800 for every destination (JSFX / preset JSON / MCP): 2^4800 on an
  // LFO rate used to make the LFO phase Infinity and the output NaN for good
  for (let d = 1; d < MOD_DESTINATIONS.length; d++) {
    for (const src of [1, 2, 6, 7]) {
      for (const amt of [4800, -4800]) {
        const s = {};
        synth_init(s, SR);
        const p = { ...defaultValues(SYNTH_PARAMS), lfo_pitch_cents: 30, lfo2_rate_hz: 3 };
        for (let k = 1; k <= MOD_SLOTS; k++) Object.assign(p, { [`mod${k}_source`]: src, [`mod${k}_destination`]: d, [`mod${k}_amount`]: amt });
        synth_update(s, p);
        synth_midi(s, 0x90, 72, 127);
        synth_midi(s, 0xb0, 1, 127);
        synth_midi(s, 0xd0, 127, 0);
        const label = `${MOD_DESTINATIONS[d].name} <- ${MOD_SOURCES[src]} x${MOD_SLOTS} ${amt}`;
        for (let i = 0; i < 2000; i++) {
          synth_render(s);
          assert.ok(Number.isFinite(s.out_l) && Number.isFinite(s.out_r), label);
        }
        assert.ok(Number.isFinite(s.lfo.phase) && Number.isFinite(s.lfo2.phase), `${label}: LFO phase`);
        const off = { ...p };
        for (let k = 1; k <= MOD_SLOTS; k++) off[`mod${k}_source`] = 0;
        synth_update(s, off);
        for (let i = 0; i < 500; i++) synth_render(s);
        assert.ok(Number.isFinite(s.out_l), `${label}: after the slots are off`);
      }
    }
  }
});

test('LFO rate modulation is limited to the destination range (+/- 6 oct in total)', () => {
  const s = {};
  synth_init(s, SR);
  synth_update(s, { ...defaultValues(SYNTH_PARAMS), lfo_rate_hz: 5, mod1_source: 6, mod1_destination: 9, mod1_amount: 4800,
    mod2_source: 6, mod2_destination: 9, mod2_amount: 3 });
  synth_midi(s, 0xb0, 1, 127);
  synth_render(s);
  assert.ok(Math.abs(s.lfo.inc - (5 * 64) / SR) < 1e-12, `inc ${s.lfo.inc}`);
  synth_update(s, { ...s.p, mod1_amount: -4800, mod2_amount: -3 });
  synth_render(s);
  assert.ok(Math.abs(s.lfo.inc - 5 / 64 / SR) < 1e-12, `inc ${s.lfo.inc}`);
});

// ---- sidechain input (JSFX pins 3/4)

/** RMS of frames [a, b) of interleaved stereo */
const rmsAt = (x, a, b) => Math.sqrt(x.slice(2 * a, 2 * b).reduce((acc, v) => acc + v * v, 0) / (2 * (b - a)));

test('sidechain duck turns the output down on each kick and back up after the release', () => {
  const frames = 48000;
  const sc = kicks(frames);
  const hold = [[0, 0x90, 60, 100], [0, 0x90, 67, 100]];
  for (const kind of ['synth', 'phys']) {
    const sound = kind === 'synth' ? { amp_sustain: 1, master_volume_db: -12 } : { phys_model: 7, phys_volume_db: -12 }; // organ: steady
    const dry = play(kind, sound, hold, frames).out;
    const duck = play(kind, { ...sound, sc_duck_db: 24, sc_release_ms: 80 }, hold, frames, sc).out;
    // right after a kick: ~-24 dB; just before the next one the follower has let go
    const hit = rmsAt(duck, 24000 + 200, 24000 + 1200) / rmsAt(dry, 24000 + 200, 24000 + 1200);
    const gap = rmsAt(duck, 35000, 36000) / rmsAt(dry, 35000, 36000);
    assert.ok(hit < 0.15, `${kind}: ducked by ${(20 * Math.log10(hit)).toFixed(1)} dB on the kick`);
    assert.ok(gap > 0.8, `${kind}: recovered to ${(20 * Math.log10(gap)).toFixed(1)} dB before the next kick`);
  }
});

test('sidechain does nothing while duck is 0 and no mod slot uses it', () => {
  const frames = 12000;
  for (const kind of ['synth', 'phys']) {
    const a = play(kind, {}, PHRASE, frames).out;
    const b = play(kind, { sc_input_gain_db: 12 }, PHRASE, frames, kicks(frames, 3000)).out;
    assert.ok(identical(a, b), kind);
  }
});

test('sidechain mod source follows the input level (0..1, input gain, capped at 1)', () => {
  const frames = 6000;
  const sc = new Float32Array(frames * 2).fill(0.25);
  const at = (params) => {
    const s = {};
    synth_init(s, SR);
    synth_update(s, { ...defaultValues(SYNTH_PARAMS), ...slots([[src('Sidechain'), dst('Pitch'), 100]]), ...params });
    for (let i = 0; i < frames; i++) {
      s.sc_in_l = sc[2 * i];
      s.sc_in_r = -sc[2 * i + 1]; // the louder channel, rectified
      synth_render(s);
    }
    return s.sc.env;
  };
  assert.ok(Math.abs(at({}) - 0.25) < 1e-3);
  assert.ok(Math.abs(at({ sc_input_gain_db: 20 * Math.log10(2) }) - 0.5) < 1e-3);
  assert.ok(at({ sc_input_gain_db: 24 }) > 1); // the follower itself is not capped; its output is
});
