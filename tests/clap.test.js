// The CLAP plugin's host-facing parts (clap/tools/clap_check): descriptors, parameters, ports,
// state, presets, CLAP notes and Tuning pass-through. The sound itself is compared with the JS DSP
// by `npm run test:clap` (tests/jsfx.test.js through clap/tools/clap_render).
// Needs `npm run clap:build`; skipped when the plugin is not built (e.g. Cloudflare builds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RPL_FILES, rplPresetName, rplSkips } from '../scripts/gen-jsfx-sliders.js';
import { resolvePreset } from '../src/lib/presets.js';

const build = join(import.meta.dirname, '..', '.cache', 'clap-build');
const win = process.platform === 'win32';
const CHECK = join(build, win ? 'Release/clap_check.exe' : 'clap_check');
const PLUGIN = join(build, win ? 'Release/AmiSynth.clap' : 'AmiSynth.clap');
const HAVE = existsSync(CHECK) && existsSync(PLUGIN);
const automation = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'jsfx', 'generated', 'automation.json'), 'utf8'));

let cached;
function check() {
  if (!cached) {
    const home = mkdtempSync(join(tmpdir(), 'amisynth-clap-'));
    const out = execFileSync(CHECK, [PLUGIN, 'Bass: Acid Bass'], {
      encoding: 'utf8', env: { ...process.env, HOME: home, XDG_DATA_HOME: home, LOCALAPPDATA: home },
    });
    cached = JSON.parse(out);
  }
  return cached;
}

const KINDS = [['synth', 'AmiSynth Synth'], ['phys', 'AmiSynth Physical'], ['drums', 'AmiSynth Drums'], ['tuning', 'AmiSynth Tuning']];

test('CLAP: one plugin per JSFX, with the instruments and the Tuning note effect', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  const { plugins } = check();
  assert.deepEqual(plugins.map((p) => p.name), KINDS.map(([, name]) => name));
  for (const p of plugins.slice(0, 3)) assert.ok(p.features.includes('instrument'), p.name);
  assert.ok(plugins[3].features.includes('note-effect'));
  const version = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
  for (const p of plugins) assert.equal(p.version, version, `${p.name}: plugin version follows package.json`);
});

test('CLAP: every slider is a parameter with its id, group, range and default', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  const { plugins } = check();
  KINDS.forEach(([kind], k) => {
    const defs = automation.instruments[kind].parameters;
    const params = plugins[k].params;
    assert.equal(params.length, defs.length, kind);
    defs.forEach((d, i) => {
      const p = params[i];
      const at = `${kind}/${d.id}`;
      assert.equal(p.id, d.paramIndex, at);
      assert.equal(p.module, d.group, at);
      assert.ok(p.name.startsWith(d.name), `${at}: ${p.name}`);
      if (d.min !== undefined) assert.deepEqual([p.min, p.max], [d.min, d.max], at);
      if (d.default !== undefined) assert.equal(p.default, d.default, at);
      assert.equal(p.value, p.default, `${at}: starts at its default`);
      assert.equal(p.textValue, p.default, `${at}: value -> text -> value (${p.text})`);
      if (d.options) assert.equal(p.text, d.options[p.default], `${at}: enums show their names`);
    });
  });
});

test('CLAP: audio and note ports (sidechain input, drum group outputs, Tuning pass-through)', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  const [synth, phys, drums, tuning] = check().plugins;
  for (const p of [synth, phys]) {
    assert.deepEqual(p.audioPorts, { in: [{ name: 'Sidechain', channels: 2, main: false }], out: [{ name: 'Output', channels: 2, main: true }] });
    assert.deepEqual(p.notePorts, { in: 1, out: 0 });
  }
  assert.deepEqual(drums.audioPorts.out.map((o) => [o.name, o.channels, o.main]),
    [['Main', 2, true], ['Kick', 2, false], ['Snare/Clap/Rim', 2, false], ['Hats/Cymbals', 2, false], ['Toms/Perc', 2, false]]);
  assert.deepEqual(tuning.notePorts, { in: 1, out: 1 });
  assert.equal(check().tuningPassesNotes, 1);
  assert.equal(check().tuningPassesAudio, true);
});

test('CLAP: the state brings parameter values back in a new instance', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  assert.deepEqual(check().state, { saved: true, loaded: true, before: 2345, after: 2345 });
});

test('CLAP: presets are discovered with the same names as in REAPER and load their values', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  const c = check();
  assert.equal(c.presetLocations, 1);
  const ids = ['com.github.lenqth.amisynth.synth', 'com.github.lenqth.amisynth.physical', 'com.github.lenqth.amisynth.drums'];
  RPL_FILES.forEach(([, , presets], k) => {
    const found = c.presets.filter((p) => p.plugin === ids[k]);
    assert.deepEqual(found.map((p) => p.name), presets.map(rplPresetName));
    assert.deepEqual(found.map((p) => p.key), found.map((p) => p.name));
  });
  assert.ok(check().plugins.slice(0, 3).every((p) => p.presetLoad));
  assert.equal(c.presetLoaded, true);
  const [, defs, presets] = RPL_FILES[0];
  const values = resolvePreset(defs, presets.find((p) => rplPresetName(p) === 'Bass: Acid Bass'));
  defs.forEach((d, i) => {
    if (rplSkips(d)) assert.equal(c.presetValues[i], c.plugins[0].params[i].default, `${d.id}: presets leave the tuning alone`);
    else assert.ok(Math.abs(c.presetValues[i] - values[d.id]) < 1e-9, `${d.id}: ${c.presetValues[i]} vs ${values[d.id]}`);
  });
});

test('CLAP: a CLAP note sounds exactly like the same MIDI note', { skip: !HAVE && 'CLAP plugin not built' }, () => {
  const { clapNotes } = check();
  assert.ok(clapNotes.peak > 0.01, 'audible');
  assert.equal(clapNotes.maxDiff, 0);
});
