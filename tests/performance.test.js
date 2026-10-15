import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTuning } from '../src/lib/tuning.js';
import { tuningMap, map12TetNotes } from '../src/lib/tuning-map.js';
import { defaultValues, PHYS_PARAMS } from '../src/dsp/params.js';
import { audition, compareAuditions } from '../scripts/preset-audition.js';
import { performanceExamples } from '../scripts/performance-check.js';
import { createCatalog } from '../src/lib/reaper-catalog.js';
import { install } from '../scripts/install-reaper.js';
import { checkCatalogs } from '../scripts/catalog-integrity.js';

test('24 EDO maps conventional notes to twice the reference-relative steps', () => {
  const tuning = makeTuning({ ...defaultValues(PHYS_PARAMS), tuning_divisions: 24 }, null);
  const notes = [60, 62, 64, 65, 67, 69, 71, 72];
  const mapped = map12TetNotes(notes, tuning);
  assert.deepEqual(mapped.map(r => r.targetNote), notes.map(n => 69 + 2 * (n - 69)));
  assert.ok(mapped.every(r => Math.abs(r.errorCents) < 1e-9));
  const rows = tuningMap(tuning, 68, 70);
  assert.equal(rows[0].centsFromReference, -50);
  assert.equal(rows[1].predictedHz, 440);
  assert.throws(() => map12TetNotes([0], tuning), /収まりません/);
  assert.throws(() => tuningMap(tuning, 70, 60));
});

test('performance curves affect the render, preserve initial patch and participate in fingerprints', () => {
  const preset = createCatalog().instruments.phys.presets.find(p => p.name === 'Clarinet');
  const req = { sampleRate: 44100, seconds: .4, bpm: 120, events: [[0, 144, 60, 100]], eventUnit: 'seconds' };
  const plain = audition('phys', preset.params, req);
  const moved = audition('phys', preset.params, { ...req, curves: [{ id: 'breath_pressure', interpolation: 'linear', points: [[0, .1], [.3, .8]] }] });
  assert.equal(moved.report.params.breath_pressure, preset.params.breath_pressure);
  assert.notEqual(moved.report.metrics.rmsDbfs, plain.report.metrics.rmsDbfs);
  assert.throws(() => compareAuditions(moved.report, plain.report), /different/);
  for (const curves of [ [{ id: 'phys_model', interpolation: 'linear', points: [[0, 1]] }], [{ id: 'breath_pressure', interpolation: 'linear', points: [[.2, .5], [.1, .6]] }], [{ id: 'breath_pressure', interpolation: 'linear', points: [[0, 2]] }] ]) assert.throws(() => audition('phys', preset.params, { ...req, curves }));
});

test('pedal cases share MIDI and expose dry-window energy and actual pedal state', () => {
  const cases = performanceExamples().filter(e => e.id.endsWith('-dry'));
  const preset = createCatalog().instruments.phys.presets.find(p => p.name === 'Harp');
  const rendered = cases.map(e => audition('phys', { ...preset.params, ...e.patch }, e.request).report);
  assert.equal(rendered[0].phraseHash, rendered[1].phraseHash);
  assert.ok(rendered[1].metrics.windows[0].rmsDbfs > rendered[0].metrics.windows[0].rmsDbfs);
  assert.equal(rendered[1].performance.pedalTrace[0].pedalDown, true);
  assert.equal(rendered[1].performance.finalPedalDown, false);
  assert.equal(rendered[0].performance.pedalApplicable, false);
});

test('catalog audit detects a stale installed preset file without modifying it', () => {
  assert.deepEqual(checkCatalogs().failures, []);
  const resource = mkdtempSync(join(tmpdir(), 'amisynth-audit-'));
  install(resource);
  assert.deepEqual(checkCatalogs(resource).failures, []);
  const automation = join(resource, 'Scripts/AmiSynth/generated/automation.json');
  writeFileSync(automation, readFileSync(automation, 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  assert.deepEqual(checkCatalogs(resource).failures, []);
  for (const name of ['presets.json', 'automation.json']) {
    const path = join(resource, 'Scripts/AmiSynth/generated', name);
    for (const contents of ['{}', '{invalid JSON', '{"synth":[null],"phys":[],"drums":[]}', 'null']) {
      install(resource);
      writeFileSync(path, contents);
      const result = checkCatalogs(resource);
      assert.ok(result.failures.some(f => f.includes(`${name} is unreadable or incomplete`)));
      assert.equal(readFileSync(path, 'utf8'), contents);
    }
    install(resource);
    unlinkSync(path);
    assert.ok(checkCatalogs(resource).failures.some(f => f.includes(`${name} is unreadable or incomplete`)));
  }
});
