import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampParam, defaultValues, PHYS_PARAMS } from '../src/dsp/params.js';
import { MATERIALS, MESH_MAX_VOICES, phys_init, phys_note_off, phys_note_on, phys_pitch_bend, phys_render, phys_snapshot, phys_update } from '../src/dsp/phys.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { resolvePreset } from '../src/lib/presets.js';

const SR = 48000;

function make(overrides) {
  const s = {};
  phys_init(s, SR);
  // the room is off unless a test asks for it (its tail would blur pitch / decay measurements)
  phys_update(s, { ...defaultValues(PHYS_PARAMS), phys_room_mix: 0, ...overrides });
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
    // tubular bells have no partial at the heard pitch: modes 2 : 3 : 4 imply it (strike tone)
    const k = m.ratios.includes(1) ? m.ratios.indexOf(1) : m.ratios.indexOf(2);
    const want = m.ratios[k] * 220;
    assert.ok(k >= 0 && Math.abs(v.mode_hz[k] - want) < 1e-6, `${m.name} has a mode at the note frequency (or its octave)`);
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

// --- bowed string, wind, 2D mesh, stiff string ---------------------------------------

const NEW_MODELS = [
  ['bowed', { phys_model: 2 }, [36, 48, 60, 72, 84]],
  ['clarinet', { phys_model: 3, wind_type: 0 }, [36, 48, 60, 72, 84]],
  ['flute', { phys_model: 3, wind_type: 1, breath_noise: 0 }, [48, 60, 72, 84]],
  ['saxophone', { phys_model: 3, wind_type: 2, breath_noise: 0 }, [36, 48, 60, 72, 84]],
  ['double reed', { phys_model: 3, wind_type: 3, breath_noise: 0 }, [36, 48, 60, 72, 84]],
  ['circular drum', { phys_model: 4, mesh_shape: 0 }, [48, 60, 72, 84]],
  ['square plate', { phys_model: 4, mesh_shape: 1 }, [48, 60, 72, 84]],
  // (with inharmonicity the stretched partials pull an autocorrelation estimate sharp; the
  // fundamental itself is checked from the loop phase in the inharmonicity test below)
  ['stiff string', { phys_model: 5, piano_inharmonicity: 0 }, [36, 48, 60, 72, 84]],
];

test('bowed / wind / mesh / stiff models are in tune', () => {
  for (const [name, params, notes] of NEW_MODELS) {
    for (const note of notes) {
      const s = make(params);
      phys_note_on(s, note, 100);
      render(s, SR * 0.4);
      const hz = 440 * 2 ** ((note - 69) / 12);
      const f = pitch(render(s, 8000), hz);
      assert.ok(Math.abs(cents(f, hz)) < 5, `${name} ${note}: ${f.toFixed(2)} Hz vs ${hz.toFixed(2)}`);
    }
  }
});

test('bowed and wind sustain while held and stop after release', () => {
  for (const params of [{ phys_model: 2 }, ...[0, 1, 2, 3].map((wind_type) => ({ phys_model: 3, wind_type }))]) {
    const s = make({ ...params, phys_release_ms: 150 });
    phys_note_on(s, 60, 100);
    render(s, SR * 0.5);
    const held = rms(render(s, SR * 0.5));
    assert.ok(held > 0.02, `${JSON.stringify(params)} sustains (${held})`);
    phys_note_off(s, 60);
    render(s, SR * 1.5);
    assert.equal(s.voices.filter((v) => v.active).length, 0, `${JSON.stringify(params)} frees its voice`);
  }
});

test('wind instruments speak over the whole pressure / embouchure range', () => {
  for (const wind_type of [0, 1, 2, 3]) {
    for (const breath_pressure of [0, 0.5, 1]) {
      for (const wind_embouchure of [0, 0.5, 1]) {
        const s = make({ phys_model: 3, wind_type, breath_pressure, wind_embouchure });
        phys_note_on(s, 64, 100);
        render(s, SR * 0.4);
        const r = rms(render(s, 4800));
        assert.ok(r > 0.01, `type ${wind_type} pressure ${breath_pressure} embouchure ${wind_embouchure}: ${r}`);
      }
    }
  }
});

test('2D mesh: every size and shape is stable, decays, and uses at most 3 voices', () => {
  for (const mesh_shape of [0, 1]) {
    for (const mesh_size of [6, 11, 16]) {
      // note 108 asks for more than the grid can carry: c^2 is clamped to stay stable
      const s = make({ phys_model: 4, mesh_shape, mesh_size, mesh_decay_ms: 300, mesh_high_damping: 0 });
      for (const n of [36, 60, 84, 108, 50, 70]) phys_note_on(s, n, 127);
      assert.ok(s.voices.filter((v) => v.active).length <= MESH_MAX_VOICES);
      const a = render(s, SR * 0.3);
      assert.ok(Math.max(...a.map(Math.abs)) <= 1);
      assert.ok(rms(a) > 0.005);
      render(s, SR * 2);
      assert.equal(s.voices.filter((v) => v.active).length, 0, `shape ${mesh_shape} size ${mesh_size} decays`);
    }
  }
});

test('stiff string: partials are stretched like a piano, the fundamental stays in tune', () => {
  const partials = (note, piano_inharmonicity) => {
    const s = make({ phys_model: 5, piano_inharmonicity, piano_unison_detune_cents: 0 });
    phys_note_on(s, note, 100);
    render(s, 100);
    return phys_snapshot(s).partials;
  };
  for (const note of [33, 48, 60, 72, 84, 96]) {
    const hz = 440 * 2 ** ((note - 69) / 12);
    const p = partials(note, 0.35);
    assert.ok(Math.abs(cents(p[0], hz)) < 0.5, `note ${note}: fundamental ${p[0]} vs ${hz}`);
    // partial 4 vs a string with B = 1.5e-4 * (1 + (f/262)^1.5): 4 f1 sqrt(1 + 16 B)
    const B = 1.5e-4 * (1 + (hz / 262) ** 1.5);
    if (p.length >= 4) {
      const want = 1200 * Math.log2(Math.sqrt(1 + 16 * B));
      const got = cents(p[3], 4 * p[0]);
      assert.ok(Math.abs(got - want) < Math.max(1, want * 0.35), `note ${note}: partial 4 +${got.toFixed(1)} cents, want +${want.toFixed(1)}`);
    }
  }
  const plain = partials(40, 0);
  const stretched = partials(40, 1);
  assert.ok(Math.abs(plain[7] / plain[0] - 8) < 0.02, `harmonic ${plain[7] / plain[0]}`);
  assert.ok(stretched[7] / stretched[0] > 8.2, `stretched ${stretched[7] / stretched[0]}`);
});

test('vibrato modulates the delay-line models and is exactly off at 0 cents', () => {
  // (one after the other: phys_init re-seeds the shared noise generator)
  const run = (over) => {
    const s = make({ phys_model: 5, ...over });
    phys_note_on(s, 60, 100);
    return render(s, 4000);
  };
  assert.deepEqual(run({}), run({ phys_vibrato_cents: 0, phys_vibrato_rate_hz: 9 }));
  const s = make({ phys_model: 2, phys_vibrato_cents: 50, phys_vibrato_rate_hz: 5 });
  phys_note_on(s, 57, 100);
  render(s, SR * 0.4);
  // a quarter vibrato cycle apart the pitch differs by up to 50 cents
  const fs = [];
  for (let k = 0; k < 4; k++) fs.push(pitch(render(s, 2400), 220));
  const spread = cents(Math.max(...fs), Math.min(...fs));
  assert.ok(spread > 20, `vibrato spread ${spread} cents`);
});

test('snapshots of the new models', () => {
  const snap = (params) => {
    const s = make(params);
    phys_note_on(s, 57, 100);
    render(s, 2000);
    return phys_snapshot(s);
  };
  const b = snap({ phys_model: 2 });
  assert.equal(b.model, 'bowed');
  assert.ok(b.nut.length > 10 && b.bridge.length > 2 && b.slip >= 0 && b.slip <= 1);
  const w = snap({ phys_model: 3, wind_type: 1 });
  assert.equal(w.model, 'wind');
  assert.ok(w.flute && w.wave.length > 10);
  const m = snap({ phys_model: 4, mesh_size: 10 });
  assert.equal(m.model, 'mesh');
  assert.equal(m.grid.length, 100);
  assert.ok(m.mask.some((x) => x === 0) && m.grid.some((x) => x !== 0));
  const p = snap({ phys_model: 5 });
  assert.equal(p.model, 'stiff');
  assert.ok(p.partials.length >= 8 && Math.abs(p.f1 - 220) < 1);
});

test('room: adds a decaying stereo tail and is bypassed at 0', () => {
  const tail = (phys_room_mix) => {
    const s = make({ phys_model: 1, modal_decay_ms: 60, phys_release_ms: 60, phys_room_mix, phys_room_decay_ms: 1500 });
    phys_note_on(s, 60, 120);
    phys_note_off(s, 60);
    render(s, SR * 0.4);
    const l = [];
    const r = [];
    for (let i = 0; i < SR * 0.2; i++) {
      phys_render(s);
      l.push(s.out_l);
      r.push(s.out_r);
    }
    return { l, r, s };
  };
  const dry = tail(0);
  const wet = tail(1);
  assert.ok(rms(dry.l) < 1e-4, `dry tail ${rms(dry.l)}`);
  assert.ok(rms(wet.l) > 1e-3 && rms(wet.r) > 1e-3, `room tail ${rms(wet.l)}`);
  // decorrelated left / right
  assert.ok(wet.l.some((x, i) => Math.abs(x - wet.r[i]) > 1e-4));
  // and it dies away (T60 1.5 s -> well below -60 dB after 4 s)
  render(wet.s, SR * 4);
  assert.ok(rms(render(wet.s, 4800)) < rms(wet.l) * 1e-3);
});

test('piano: harder notes are brighter (felt hammer), and the soundboard is bypassed at 0', () => {
  // upper partials (3rd .. 8th) relative to the fundamental, over the first 100 ms
  const centroid = (velocity, over = {}) => {
    const s = make({ phys_model: 5, ...over });
    phys_note_on(s, 60, velocity);
    const x = render(s, 4800);
    const amp = (f) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < x.length; i++) {
        re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
        im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
      }
      return Math.hypot(re, im);
    };
    let up = 0;
    for (let k = 3; k <= 8; k++) up += amp(261.63 * k);
    return up / amp(261.63);
  };
  const pp = centroid(30);
  const ff = centroid(127);
  assert.ok(ff > pp * 2, `upper partials ff ${ff.toFixed(3)} vs pp ${pp.toFixed(3)}`);
  // same velocity amount 0: the level no longer follows velocity, the timbre still does
  assert.ok(centroid(127, { phys_velocity_amount: 0 }) > centroid(30, { phys_velocity_amount: 0 }) * 2);
  const a = make({ phys_model: 5, piano_soundboard: 0 });
  const b = make({ phys_model: 5, piano_soundboard: 0.8 });
  phys_note_on(a, 60, 100);
  phys_note_on(b, 60, 100);
  const xa = render(a, 4800);
  const xb = render(b, 4800);
  assert.ok(xa.some((x, i) => Math.abs(x - xb[i]) > 1e-4), 'soundboard changes the sound');
});

test('brass: in tune from the trombone range to the trumpet top, over the pressure / lip range', () => {
  for (const [brass_pressure, brass_lip] of [[0.6, 0.5], [0.1, 0], [1, 1]]) {
    for (const note of [36, 43, 50, 57, 64, 71, 78, 85, 92]) {
      const s = make({ phys_model: 6, brass_pressure, brass_lip });
      phys_note_on(s, note, 100);
      render(s, SR * 0.4);
      const x = render(s, 8000);
      assert.ok(rms(x) > 0.0005, `p ${brass_pressure} lip ${brass_lip} note ${note} speaks (${rms(x)})`);
      const hz = 440 * 2 ** ((note - 69) / 12);
      const f = pitch(x, hz);
      assert.ok(Math.abs(cents(f, hz)) < 25, `p ${brass_pressure} lip ${brass_lip} note ${note}: ${cents(f, hz).toFixed(1)} cents`);
    }
  }
});

test('brass: louder is brighter, it sustains while held and frees its voice after release', () => {
  const tone = (velocity) => {
    const s = make({ phys_model: 6, phys_release_ms: 100 });
    phys_note_on(s, 60, velocity);
    render(s, SR * 0.4);
    return { s, x: render(s, 9600) };
  };
  const bright = (x) => {
    const amp = (k) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < x.length; i++) {
        re += x[i] * Math.cos((2 * Math.PI * 261.63 * k * i) / SR);
        im += x[i] * Math.sin((2 * Math.PI * 261.63 * k * i) / SR);
      }
      return Math.hypot(re, im);
    };
    return (amp(3) + amp(4) + amp(5)) / amp(1);
  };
  const soft = tone(40);
  const loud = tone(127);
  assert.ok(rms(loud.x) > 2 * rms(soft.x), 'louder');
  assert.ok(bright(loud.x) > bright(soft.x), `brighter ${bright(loud.x).toFixed(3)} vs ${bright(soft.x).toFixed(3)}`);
  phys_note_off(loud.s, 60);
  render(loud.s, SR);
  assert.equal(loud.s.voices.filter((v) => v.active).length, 0);
  const snap = (() => {
    const s = make({ phys_model: 6 });
    phys_note_on(s, 60, 100);
    render(s, 2000);
    return phys_snapshot(s);
  })();
  assert.equal(snap.model, 'brass');
  assert.ok(snap.wave.length > 10 && snap.valve >= 0 && snap.valve <= 1);
});

test('piano: no click at the start of treble notes (the hammer pulse below the fundamental is removed)', () => {
  for (const note of [72, 84, 96]) {
    const s = make({ phys_model: 5 });
    phys_note_on(s, note, 100);
    const x = render(s, SR * 0.15);
    const peak = (a, b) => Math.max(...x.slice(a, b).map(Math.abs));
    const head = 20 * Math.log10(peak(0, 240) / peak(SR * 0.05, SR * 0.15));
    assert.ok(head < 8, `note ${note}: first 5 ms ${head.toFixed(1)} dB above the tone`);
  }
});

test('piano: the top octaves ring (no lone click), stay in tune and at an even level', () => {
  const levels = [];
  for (const note of [100, 108, 116, 124]) {
    const s = make({ phys_model: 5, piano_unison_detune_cents: 0 });
    phys_note_on(s, note, 100);
    const x = render(s, SR * 0.15);
    const peak = (a, b) => Math.max(...x.slice(a, b).map(Math.abs));
    const head = 20 * Math.log10(peak(0, 240) / peak(SR * 0.05, SR * 0.15));
    assert.ok(head < 9, `note ${note}: first 5 ms ${head.toFixed(1)} dB above the tone`);
    levels.push(20 * Math.log10(peak(0, SR * 0.15)));
    const f1 = phys_snapshot(s).f1;
    const hz = 440 * 2 ** ((note - 69) / 12);
    assert.ok(Math.abs(cents(f1, hz)) < 1, `note ${note}: loop tuned to ${f1} Hz vs ${hz}`);
  }
  assert.ok(Math.max(...levels) - Math.min(...levels) < 12, `levels ${levels.map((l) => l.toFixed(0)).join(' ')}`);
});

test('brass: speaks within ~100 ms whatever the velocity (tongue release), soft and loud alike', () => {
  for (const note of [55, 67, 79]) {
    const onset = (velocity) => {
      const s = make({ phys_model: 6, brass_attack_ms: 25, phys_vibrato_cents: 0 });
      phys_note_on(s, note, velocity);
      const x = render(s, SR * 0.6);
      let m = 0;
      const env = x.map((v) => (m = Math.max(m * 0.999, Math.abs(v))));
      const steady = Math.max(...env.slice(-4800));
      return env.findIndex((v) => v >= steady * 0.7) / (SR / 1000);
    };
    const soft = onset(30);
    const loud = onset(127);
    assert.ok(soft < 100 && loud < 100, `note ${note}: ${soft.toFixed(0)} ms (pp) / ${loud.toFixed(0)} ms (ff)`);
    assert.ok(Math.abs(soft - loud) < 30, `note ${note}: velocity changes the onset by ${Math.abs(soft - loud).toFixed(0)} ms`);
  }
});

/** frequency of a near-pure tone from its upward zero crossings (autocorrelation is biased on a sine) */
function zcPitch(buf) {
  let first = -1;
  let last = 0;
  let n = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      const t = i - 1 + buf[i - 1] / (buf[i - 1] - buf[i]);
      if (first < 0) first = t;
      last = t;
      n++;
    }
  }
  return ((n - 1) * SR) / (last - first);
}

test('organ model: drawbars set the partials, in tune, single-trigger percussion, rotary moves', () => {
  const only8 = { phys_model: 7, organ_drawbar_16: 0, organ_drawbar_5_13: 0, organ_drawbar_8: 8, organ_click: 0 };
  for (const note of [36, 57, 81]) {
    const s = make(only8);
    phys_note_on(s, note, 100);
    const out = render(s, SR * 0.3).slice(2400);
    const hz = 440 * 2 ** ((note - 69) / 12);
    assert.ok(Math.abs(cents(zcPitch(out), hz)) < 0.5, `organ ${note} in tune: ${zcPitch(out)}`);
  }
  // 16' alone sounds an octave below the note
  const sub = make({ ...only8, organ_drawbar_16: 8, organ_drawbar_8: 0 });
  phys_note_on(sub, 69, 100);
  assert.ok(Math.abs(cents(zcPitch(render(sub, SR * 0.3).slice(2400)), 220)) < 0.5, '16 foot = sub-octave');
  // percussion only on a note played with no other key down
  const s = make({ ...only8, organ_percussion: 2 });
  phys_note_on(s, 60, 100);
  render(s, 100);
  assert.ok(s.voices[s.last_voice].org_perc > 0.9, 'first note strikes');
  phys_note_on(s, 64, 100);
  assert.equal(s.voices[s.last_voice].org_perc, 0, 'legato note does not');
  // the rotary speaker makes the level of a steady tone swirl; without it the tone is steady
  const swing = (over) => {
    const r = make({ ...only8, organ_drawbar_8: 0, organ_drawbar_1: 8, ...over });
    phys_note_on(r, 69, 100);
    render(r, SR * 0.2);
    const out = render(r, SR * 0.5);
    const blocks = [];
    for (let i = 0; i + 1200 <= out.length; i += 1200) blocks.push(rms(out.slice(i, i + 1200)));
    return Math.max(...blocks) / Math.min(...blocks);
  };
  assert.ok(swing({}) < 1.05, 'steady without the rotary');
  assert.ok(swing({ rotary_mode: 2 }) > 1.3, 'rotary swirls');
});
