import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileModularPatch } from '../src/dsp/modular.js';

const win = process.platform === 'win32';
const build = join(import.meta.dirname, '..', '.cache', 'clap-build', win ? 'Release' : '');
const host = join(build, win ? 'modular_check.exe' : 'modular_check');
const plugin = join(build, 'AmiSynthModular.clap');
const available = existsSync(host) && existsSync(plugin);
const webPatch = compileModularPatch({
  nodes: [
    { id: 'macro', type: 'macro' }, { id: 'memory', type: 'delay' },
    { id: 'sum', type: 'mix', params: { a: 1, b: 0.1 } }, { id: 'out', type: 'output' },
  ],
  cables: [
    { from: 'macro', port: 'out', to: 'sum', input: 'a' },
    { from: 'memory', port: 'out', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'out', input: 'audio' },
    { from: 'sum', port: 'out', to: 'memory', input: 'in' },
  ],
  macros: [0.15],
}).patch;

test('Modular CLAP loads Web patches, plays and automates at exact offsets, and restores variable-length state', {
  skip: !available && 'Modular CLAP build unavailable',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'amisynth-modular-'));
  try {
    const file = join(dir, 'patch.json'), state = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify(webPatch));
    execFileSync(host, [plugin, file, state], { stdio: 'pipe' });
    const restored = compileModularPatch(JSON.parse(readFileSync(state, 'utf8'))).patch;
    assert.deepEqual(restored, { ...webPatch, macros: webPatch.macros.with(0, 0.75) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
