import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { install, installPlan } from '../scripts/install-reaper.js';
import { createCatalog } from '../src/lib/reaper-catalog.js';
import { parsePresetJson } from '../src/lib/presets.js';
import { SYNTH_PARAMS, PHYS_PARAMS, DRUM_PARAMS } from '../src/dsp/params.js';

const hasLua = spawnSync('lua', ['-v']).status === 0;

test('REAPER installation dry-run is read-only; installed layout preserves dependencies and custom scripts', () => {
  const resource = mkdtempSync(join(tmpdir(), 'amisynth-install-'));
  const plan = install(resource, true);
  assert.equal(plan.length, 22);
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

test('MCP sound actions are installed beside toolkit.lua and document the request key they actually read', () => {
  const plan = installPlan(mkdtempSync(join(tmpdir(), 'amisynth-sound-')));
  for (const [file, key, mutates] of [['AmiSynth - Apply sound.lua', 'apply_sound', true], ['AmiSynth - Read sound.lua', 'read_sound', false],
    ['AmiSynth - Run.lua', 'run', true], ['AmiSynth Drums - Create routed tracks.lua', 'create_drum_tracks', true]]) {
    const entry = plan.find((p) => p.destination.endsWith(join('Scripts', 'AmiSynth', 'reaper', file)));
    assert.ok(entry, `${file} is not installed`);
    const text = readFileSync(entry.source, 'utf8');
    assert.match(text, new RegExp(`api\\.run_action\\('${key}'`));
    assert.match(text, new RegExp(`ExtState AmiSynthMCP/${key}`));
    assert.match(text, new RegExp(`Scripts/AmiSynth/${key}\\.json`));
    assert.match(text, /reaper_mcp_script_result\/last_result/);
    assert.match(mutates ? text.split('\n').slice(0, 2).join('\n') : text.split('\n')[1], mutates ? /[Mm]odif(y|ies) the (active )?project/ : /No project changes/);
  }
  const guide = readFileSync(new URL('../jsfx/reaper/README.md', import.meta.url), 'utf8');
  for (const word of ['AmiSynth - Apply sound.lua', 'AmiSynth - Read sound.lua', 'AmiSynth - Run.lua', 'apply_sound', 'read_sound', '"base"', '```amisynth run']) assert.ok(guide.includes(word), word);
  assert.match(readFileSync(new URL('../jsfx/generated/catalog.lua', import.meta.url), 'utf8').split('\n')[1], /Apply sound/);
});

test('Lua host-contract tests pass (tests/reaper-toolkit.test.lua)', { skip: !hasLua && 'lua is not installed' }, () => {
  const r = spawnSync('lua', ['tests/reaper-toolkit.test.lua'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /MCP sound actions/);
});

test('Lua validate_diff clamps, rounds and rejects exactly like the web JSON paste', { skip: !hasLua && 'lua is not installed' }, () => {
  const catalog = createCatalog();
  const defs = { synth: SYNTH_PARAMS, phys: PHYS_PARAMS, drums: DRUM_PARAMS };
  // Deterministic pseudo-random diffs, including out-of-range, fractional enum and unknown ids.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cases = [];
  for (const kind of Object.keys(defs)) {
    for (let n = 0; n < 8; n++) {
      const params = { not_a_param: 1 };
      for (const d of catalog.instruments[kind].parameters) {
        if (rand() < 0.3) params[d.id] = d.min + (d.max - d.min) * (rand() * 1.4 - 0.2);
      }
      cases.push({ kind, params });
    }
  }
  const script = `
    reaper = {}
    local api = dofile('jsfx/reaper/toolkit.lua')
    local cases = api.json_decode(io.read('a'))
    local out = api.array()
    for i, c in ipairs(cases) do
      local clean, clamped, rejected = api.validate_diff(c.kind, c.params)
      local ids = api.array()
      for _, r in ipairs(rejected) do ids[#ids + 1] = r.id end
      out[i] = { clean = clean, clamped = #clamped, rejected = ids }
    end
    io.write(api.json_encode(out))`;
  const r = spawnSync('lua', ['-e', script], { cwd: new URL('..', import.meta.url), input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lua = JSON.parse(r.stdout);
  cases.forEach(({ kind, params }, i) => {
    const web = parsePresetJson(JSON.stringify({ params }), defs[kind]);
    assert.deepEqual(lua[i].clean, web.params, `${kind} case ${i}`);
    assert.equal(lua[i].clamped, web.warnings.filter((w) => w.includes('丸めました')).length);
    assert.deepEqual(lua[i].rejected.sort(), Object.keys(params).filter((id) => !(id in web.params)).sort());
  });
});
