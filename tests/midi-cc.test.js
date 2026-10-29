// CC7 Volume / CC10 Pan / CC11 Expression, CC66 Sostenuto, CC67 Soft Pedal and CC121 on the
// three instruments (JS DSP), and the same events through the JSFX ports when jsfx_render is built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultValues, DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { synth_init, synth_render, synth_update } from '../src/dsp/synth.js';
import { phys_init, phys_render, phys_update } from '../src/dsp/phys.js';
import { drums_init, drums_render, drums_update } from '../src/dsp/drums.js';
import { drums_midi, phys_midi, synth_midi } from '../src/dsp/midi.js';
import { compare, INSTRUMENTS, renderJs, renderJsfx, scenario } from '../scripts/jsfx-compare.js';

const SR = 48000;
const KINDS = {
  synth: { defs: SYNTH_PARAMS, init: synth_init, update: synth_update, render: synth_render, midi: synth_midi },
  phys: { defs: PHYS_PARAMS, init: phys_init, update: phys_update, render: phys_render, midi: phys_midi },
  drums: { defs: DRUM_PARAMS, init: drums_init, update: drums_update, render: drums_render, midi: drums_midi },
};

function make(kind, overrides = {}) {
  const k = KINDS[kind];
  const s = {};
  k.init(s, SR);
  k.update(s, { ...defaultValues(k.defs), ...overrides });
  return s;
}
const send = (kind, s, a, b, c) => KINDS[kind].midi(s, a, b, c);
/** RMS of left and right over `frames` samples */
function rms(kind, s, frames) {
  let l = 0;
  let r = 0;
  for (let i = 0; i < frames; i++) {
    KINDS[kind].render(s);
    l += s.out_l * s.out_l;
    r += s.out_r * s.out_r;
  }
  return [Math.sqrt(l / frames), Math.sqrt(r / frames)];
}
const NOTE = { synth: 60, phys: 60, drums: 38 };
// quiet enough that the output soft clipper stays linear
const QUIET = { synth: { master_volume_db: -18 }, phys: {}, drums: {} };

/**
 * Fresh instance, events at frame 0, then RMS of L / R over the frames after `skip` (well past the 20 ms
 * glide). One instance at a time: the noise generator is shared and reseeded by init.
 */
function level(kind, overrides, events, skip = 9600, frames = 2400) {
  const s = make(kind, overrides);
  for (const [a, b, c] of events) send(kind, s, a, b, c);
  rms(kind, s, skip);
  return [...rms(kind, s, frames), s];
}

test('CC7 / CC11 follow the GM curve on every instrument, CC10 balances, and Off ignores them', () => {
  for (const kind of ['synth', 'phys', 'drums']) {
    const note = [0x90, NOTE[kind], 100];
    const [a] = level(kind, QUIET[kind], [note]);
    const [b] = level(kind, QUIET[kind], [[0xb0, 7, 64], note]);
    const [c] = level(kind, { ...QUIET[kind], midi_volume_pan: 0 }, [[0xb0, 7, 64], [0xb0, 10, 0], note]);
    const db = 20 * Math.log10(b / a);
    assert.ok(Math.abs(db - 40 * Math.log10(64 / 127)) < 0.5, `${kind}: CC7 64 should be about -11.9 dB, got ${db.toFixed(2)}`);
    assert.ok(Math.abs(c / a - 1) < 1e-9, `${kind}: Off must ignore CC7 / CC10`);

    const [m, , muted] = level(kind, {}, [[0xb0, 11, 0], note]);
    assert.ok(m < a * 1e-3, `${kind}: CC11 0 silences (below -60 dB once the glide has settled)`);
    send(kind, muted, 0xb0, 121, 0); // Reset All Controllers: expression back to full
    assert.equal(muted.mix.expr, 1);

    const [ll, lr] = level(kind, {}, [[0xb0, 10, 0], note]);
    assert.ok(ll > 1e-4 && lr < ll * 1e-3, `${kind}: CC10 0 = hard left (L ${ll}, R ${lr})`);
  }
});

test('CC66 sostenuto holds only the keys down when it is pressed, until it is released', () => {
  for (const kind of ['synth', 'phys']) {
    const s = make(kind, kind === 'synth' ? { amp_release_ms: 5 } : { phys_release_ms: 20 });
    send(kind, s, 0x90, 60, 100);
    send(kind, s, 0xb0, 66, 127);
    send(kind, s, 0x90, 64, 100); // after the pedal: not held
    rms(kind, s, 480);
    send(kind, s, 0x80, 60, 0);
    send(kind, s, 0x80, 64, 0);
    const v60 = s.voices.find((v) => v.note === 60);
    const v64 = s.voices.find((v) => v.note === 64);
    assert.equal(v60.sustained, 1, `${kind}: key 60 held by sostenuto`);
    assert.equal(v64.sustained, 0, `${kind}: key 64 released`);
    // CC64 up while the sostenuto is down keeps its notes
    send(kind, s, 0xb0, 64, 127);
    send(kind, s, 0xb0, 64, 0);
    assert.equal(v60.sustained, 1, `${kind}: CC64 up does not drop sostenuto notes`);
    send(kind, s, 0xb0, 66, 0);
    assert.equal(v60.sustained, 0, `${kind}: released with the pedal`);
    assert.equal(v60.sost, 0);
  }
});

test('CC67 soft pedal lowers the velocity of new notes by Soft Pedal Depth', () => {
  const s = make('synth', { soft_pedal_depth: 0.5 });
  send('synth', s, 0xb0, 67, 127);
  send('synth', s, 0x90, 60, 100);
  assert.equal(s.voices.find((v) => v.note === 60).velocity, 50 / 127);
  send('synth', s, 0xb0, 67, 0);
  send('synth', s, 0x90, 62, 100);
  assert.equal(s.voices.find((v) => v.note === 62).velocity, 100 / 127);

  const p = make('phys', { soft_pedal_depth: 0.5 });
  send('phys', p, 0xb0, 67, 127);
  send('phys', p, 0x90, 60, 100);
  assert.equal(p.voices.find((v) => v.note === 60).vel_raw, 50 / 127);
});

test('Synth CC121 resets pedals, bend, mod wheel and pressure but keeps volume and pan', () => {
  const s = make('synth');
  send('synth', s, 0xb0, 7, 90);
  send('synth', s, 0xb0, 10, 20);
  send('synth', s, 0xb0, 11, 30);
  send('synth', s, 0xb0, 64, 127);
  send('synth', s, 0xb0, 67, 127);
  send('synth', s, 0xb0, 1, 100);
  send('synth', s, 0xe0, 0, 100);
  send('synth', s, 0xd0, 90, 0);
  send('synth', s, 0xb0, 121, 0);
  assert.equal(s.sustain_pedal, 0);
  assert.equal(s.soft_pedal, 0);
  assert.equal(s.bend, 0);
  assert.equal(s.modwheel, 0);
  assert.equal(s.pressure, 0);
  assert.equal(s.mix.expr, 1);
  assert.equal(s.mix.vol, (90 / 127) ** 2);
  assert.equal(s.mix.pan, (20 - 64) / 63);
});

// ---- JSFX ports
const BIN = process.env.JSFX_RENDER || join(import.meta.dirname, '..', '.cache', process.platform === 'win32' ? 'jsfx_render.exe' : 'jsfx_render');
const HAVE = existsSync(BIN);

function check(kind, params, events, seconds, label) {
  const inst = INSTRUMENTS[kind];
  const frames = Math.round(SR * seconds);
  const r = compare(renderJs(inst, params, events, SR, frames), renderJsfx(BIN, inst, params, events, SR, frames));
  assert.ok(r.rms > 1e-4, `${label}: silent?`);
  assert.ok(r.snrDb > 100, `${label}: JSFX differs from JS (SNR ${r.snrDb.toFixed(1)} dB, max diff ${r.maxDiff})`);
}

// volume / expression swell, pan sweep, sostenuto over a chord change, soft pedal, CC121
const PEDALS = [
  [0, 0x90, 48, 110], [0, 0x90, 55, 100], [400, 0xb0, 66, 127], [500, 0x90, 64, 90],
  [2000, 0xb0, 7, 100], [3000, 0xb0, 11, 40], [4000, 0xb0, 11, 127], [5000, 0xb0, 10, 10],
  [6000, 0x80, 48, 0], [6000, 0x80, 55, 0], [6000, 0x80, 64, 0],
  [7000, 0xb0, 67, 127], [7000, 0x90, 67, 120], [8000, 0xb0, 64, 127], [9000, 0x80, 67, 0],
  [10000, 0xb0, 64, 0], [12000, 0xb0, 66, 0], [13000, 0xb0, 10, 100], [14000, 0xb0, 121, 0],
  [14500, 0x90, 72, 100], [18000, 0x80, 72, 0],
];

test('JSFX Synth matches JS with CC7/10/11/66/67/121', { skip: !HAVE && 'jsfx_render not built' }, () => {
  check('synth', scenario('synth', { amp_release_ms: 60 }), PEDALS, 0.5, 'synth pedals');
  check('synth', scenario('synth', { voice_mode: 1 }), PEDALS, 0.5, 'synth mono pedals');
});

test('JSFX Physical matches JS with CC7/10/11/66/67/121', { skip: !HAVE && 'jsfx_render not built' }, () => {
  for (const model of [0, 1, 2, 5]) {
    check('phys', scenario('phys', { phys_model: model, phys_release_ms: 80, phys_sustain_mode: 2 }), PEDALS, 0.5, `phys model ${model}`);
  }
});

test('JSFX Drums match JS with CC7/10/11/121', { skip: !HAVE && 'jsfx_render not built' }, () => {
  const ev = [
    [0, 0x90, 36, 120], [0, 0x90, 42, 90], [1000, 0xb0, 7, 80], [3000, 0xb0, 10, 0], [4000, 0x90, 38, 110],
    [6000, 0xb0, 11, 20], [8000, 0x90, 36, 100], [9000, 0xb0, 121, 0], [10000, 0x90, 38, 100],
  ];
  check('drums', scenario('drums'), ev, 0.4, 'drums mixer');
  check('drums', scenario('drums', { midi_volume_pan: 0 }), ev, 0.4, 'drums mixer off');
});
