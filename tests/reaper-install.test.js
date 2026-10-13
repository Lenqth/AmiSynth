import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { install, installPlan } from '../scripts/install-reaper.js';

test('REAPER installation dry-run is read-only; installed layout preserves dependencies and custom scripts', () => {
  const resource = mkdtempSync(join(tmpdir(), 'amisynth-install-'));
  const plan = install(resource, true);
  assert.equal(plan.length, 13);
  assert.deepEqual(readdirSync(resource), []);
  mkdirSync(join(resource, 'Scripts', 'AmiSynth'), { recursive: true });
  const custom = join(resource, 'Scripts', 'AmiSynth', 'Apply My Patch.lua');
  writeFileSync(custom, '-- user wrapper');
  install(resource);
  for (const { source, destination } of plan) assert.deepEqual(readFileSync(destination), readFileSync(source));
  const toolkit = join(resource, 'Scripts', 'AmiSynth', 'reaper', 'toolkit.lua');
  assert.ok(existsSync(join(resource, 'Scripts', 'AmiSynth', 'generated', 'catalog.lua')));
  writeFileSync(toolkit, '-- old bundled version');
  install(resource);
  assert.match(readFileSync(toolkit, 'utf8'), /@description AmiSynth toolkit/);
  assert.equal(readFileSync(custom, 'utf8'), '-- user wrapper');
  assert.ok(plan.every((p) => !p.source.includes('制作レポート')));
  assert.throws(() => installPlan(join(resource, 'missing')), /existing REAPER resource directory/);
});

test('all installed Lua scripts have discovery metadata describing executable actions vs libraries', () => {
  for (const p of installPlan(mkdtempSync(join(tmpdir(), 'amisynth-metadata-'))).filter((p) => p.source.endsWith('.lua'))) {
    const text = readFileSync(p.source, 'utf8');
    assert.match(text, /^-- @description AmiSynth[^\n]+/);
    assert.match(text, /^-- @about .+/m);
  }
});
