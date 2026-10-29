import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clapInstallPlan, defaultClapDir, installClap } from '../scripts/install-clap.js';

test('CLAP install goes to the per-user CLAP folder of each OS', () => {
  assert.equal(defaultClapDir('win32', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Users\\a'),
    join('C:\\Users\\a\\AppData\\Local', 'Programs', 'Common', 'CLAP'));
  assert.equal(defaultClapDir('darwin', {}, '/Users/a'), join('/Users/a', 'Library', 'Audio', 'Plug-Ins', 'CLAP'));
  assert.equal(defaultClapDir('linux', {}, '/home/a'), join('/home/a', '.clap'));
  assert.throws(() => defaultClapDir('win32', {}, 'C:\\Users\\a'), /--dest/);
});

test('CLAP install: dry-run writes nothing; a file or a macOS bundle is copied and replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amisynth-clap-install-'));
  const file = join(dir, 'src', 'AmiSynth.clap');
  mkdirSync(join(dir, 'src'));
  writeFileSync(file, 'plugin v1');
  const dest = join(dir, 'CLAP');
  const plan = installClap({ plugin: file, dest, platform: 'linux' }, true);
  assert.equal(plan.destination, join(dest, 'AmiSynth.clap'));
  assert.equal(existsSync(dest), false);
  installClap({ plugin: file, dest, platform: 'linux' });
  writeFileSync(file, 'plugin v2');
  installClap({ plugin: file, dest, platform: 'linux' });
  assert.equal(readFileSync(plan.destination, 'utf8'), 'plugin v2');

  const bundle = join(dir, 'mac', 'AmiSynth.clap');
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(bundle, 'Contents', 'MacOS', 'AmiSynth'), 'binary');
  const macDest = join(dir, 'MacCLAP');
  mkdirSync(join(macDest, 'AmiSynth.clap', 'Contents'), { recursive: true });
  writeFileSync(join(macDest, 'AmiSynth.clap', 'Contents', 'stale'), 'old');
  installClap({ plugin: bundle, dest: macDest, platform: 'linux' });
  assert.deepEqual(readdirSync(join(macDest, 'AmiSynth.clap', 'Contents')), ['MacOS']);
  assert.equal(readFileSync(join(macDest, 'AmiSynth.clap', 'Contents', 'MacOS', 'AmiSynth'), 'utf8'), 'binary');
});

test('CLAP install explains how to get the plugin when it is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amisynth-clap-install-'));
  assert.throws(() => clapInstallPlan({ plugin: join(dir, 'nope.clap'), dest: dir }), /Missing plugin/);
});
