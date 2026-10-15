import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audition, auditionPhrase, auditionMidi, compareAuditions } from '../scripts/preset-audition.js';
import { parseMidi } from '../src/lib/midifile.js';
import { createCatalog } from '../src/lib/reaper-catalog.js';
import { MOD_DESTINATIONS, SYNTH_PARAMS } from '../src/dsp/params.js';
import { modAmountDisplayText } from '../scripts/gen-jsfx-sliders.js';

test('audition metrics use measured samples and replay the saved request/settings deterministically', () => {
  const a = audition('phys', { phys_model: 7, phys_release_ms: 10 }), b = audition('phys', a.report.params, a.report.request);
  assert.deepEqual(a.left, b.left);
  const peak = Math.max(...a.left.subarray(0, 50000).map(Math.abs));
  assert.ok(a.report.metrics.samplePeak >= peak);
  let sum = 0; for (let i = 0; i < a.left.length; i++) sum += a.left[i] ** 2 + a.right[i] ** 2;
  assert.ok(Math.abs(a.report.metrics.rmsDbfs - 10 * Math.log10(sum / (2 * a.left.length))) < 1e-10);
  assert.equal(a.report.metrics.maxActiveVoices, 2, 'active includes the previous voice release tail');
  assert.ok(a.report.metrics.maxReleasedVoices > 0);
  assert.equal(a.report.metrics.voiceSteals, 0);
  assert.equal(a.report.levelSuggestion.applied, false);
  assert.deepEqual(compareAuditions(a.report, b.report), { samplePeakDbfs: 0, rmsDbfs: 0, integratedLufs: 0 });
  const other = audition('phys', {}, { ...auditionPhrase(), bpm: 121 });
  assert.throws(() => compareAuditions(a.report, other.report), /different MIDI/);
  assert.throws(() => compareAuditions(a.report, { ...b.report, request: { ...b.report.request, bpm: 121 } }), /fingerprint/);
  const midi = parseMidi(auditionMidi(a.report.request));
  assert.deepEqual(midi.notes.map(n => [n.note, n.vel]), [[60, 100], [64, 100], [67, 100], [72, 100]]);
});

test('audition counts actual voice replacement and handles silence without NaN JSON', () => {
  const request = { ...auditionPhrase(), seconds: 1, events: Array.from({ length: 9 }, (_, i) => [i * 0.01, 0x90, 50 + i, 100]) };
  const result = audition('synth', { amp_sustain: 1 }, request).report;
  assert.equal(result.metrics.maxActiveVoices, 8);
  assert.equal(result.metrics.voiceSteals, 1);
  assert.equal(audition('synth', { voice_mode: 1 }, request).report.metrics.voiceSteals, 0);
  const silent = audition('synth', {}, { ...request, events: [] }).report;
  assert.equal(silent.metrics.integratedLufs, null);
  assert.equal(silent.levelSuggestion.correctionDb, null);
  assert.ok(!JSON.stringify(silent).includes('NaN'));
  assert.throws(() => audition('synth', { mod1_destination: 14 }), /expected/);
  assert.throws(() => audition('synth', {}, { ...request, events: [[-1, 0x90, 60, 100]] }), /Invalid MIDI/);
});

test('MCP catalog includes amount units/ranges/steps and preset playing guides; generated gfx stays synchronized', () => {
  const inst = createCatalog().instruments.synth;
  const amount = inst.parameters.find(d => d.id === 'mod1_amount');
  assert.equal(amount.min, -4800); assert.equal(amount.max, 4800);
  assert.equal(amount.modulation.destinationParameter, 'mod1_destination');
  assert.deepEqual(amount.modulation.destinations, MOD_DESTINATIONS);
  assert.equal(amount.modulation.destinations[6].unit, 'rad');
  assert.equal(amount.modulation.destinations[12].step, 0.001);
  assert.equal(SYNTH_PARAMS.findIndex(d => d.id === 'mod1_amount'), 117);
  assert.ok(inst.presets.find(p => p.name === 'Formant Half-time Bass').playingGuide);
  assert.equal(readFileSync(new URL('../jsfx/amisynth_modulation.jsfx-inc', import.meta.url), 'utf8'), modAmountDisplayText());
});

test('audition CLI exports a reusable report, preset, request, WAV and demo MIDI', () => {
  const out = mkdtempSync(join(tmpdir(), 'amisynth-audition-'));
  const script = new URL('../scripts/preset-audition.js', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(script), 'synth', '--preset', 'Formant Half-time Bass', '--guide', '--out', out]);
  for (const name of ['report.json', 'sound.json', 'request.json', 'audition.wav', 'phrase.mid']) assert.ok(existsSync(join(out, name)));
  const report = JSON.parse(readFileSync(join(out, 'report.json')));
  assert.equal(report.preset, 'Formant Half-time Bass');
  assert.equal(report.metrics.maxActiveVoices, 1);
  assert.deepEqual(parseMidi(readFileSync(join(out, 'phrase.mid'))).notes.map(n => n.note), [38, 38, 41, 36]);
});
