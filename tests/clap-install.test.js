import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

test('CLAP installer installs one combined plugin and safely retires standalone Modular', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amisynth-clap-cli-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    const script = join(dir, 'scripts', 'install-clap.mjs');
    cpSync(new URL('../scripts/install-clap.js', import.meta.url), script);
    const build = join(dir, '.cache', 'clap-build', process.platform === 'win32' ? 'Release' : '');
    mkdirSync(build, { recursive: true });
    const dest = join(dir, 'CLAP');
    const run = (...args) => execFileSync(process.execPath, [script, '--dest', dest, ...args], { encoding: 'utf8', stdio: 'pipe' });
    assert.throws(() => run(), /AmiSynth.clap is not built/);
    assert.equal(existsSync(dest), false);
    writeFileSync(join(build, 'AmiSynth.clap'), 'combined');
    assert.match(run('--dry-run'), /Would copy:.*AmiSynth.clap/);
    assert.equal(existsSync(dest), false);
    mkdirSync(dest);
    const legacy = join(dest, 'AmiSynthModular.clap');
    writeFileSync(legacy, 'legacy');
    writeFileSync(`${legacy}.disabled`, 'older backup');
    assert.match(run('--dry-run'), /Would retire standalone Modular/);
    assert.equal(readFileSync(legacy, 'utf8'), 'legacy', 'dry-run preserves the old plugin');
    run();
    assert.equal(readFileSync(join(dest, 'AmiSynth.clap'), 'utf8'), 'combined');
    assert.equal(existsSync(legacy), false);
    assert.equal(readFileSync(`${legacy}.disabled`, 'utf8'), 'older backup');
    assert.equal(readFileSync(`${legacy}.disabled-1`, 'utf8'), 'legacy');
    run('--modular');
    assert.equal(readFileSync(join(dest, 'AmiSynth.clap'), 'utf8'), 'combined');
    writeFileSync(join(build, 'AmiSynthModular.clap'), 'obsolete');
    assert.throws(() => run('--plugin', join(build, 'AmiSynthModular.clap')), /standalone.*obsolete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
