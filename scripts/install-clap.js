// Copies AmiSynth.clap into the per-user CLAP folder (no admin rights needed). The JSFX are embedded
// in the plugin, so nothing else is installed. See docs/OTHER_HOSTS.md.
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, '.cache', 'clap-build');

// The user-level folders from the CLAP standard search path (clap/entry.h).
export function defaultClapDir(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is not set; pass --dest');
    return join(env.LOCALAPPDATA, 'Programs', 'Common', 'CLAP');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Audio', 'Plug-Ins', 'CLAP');
  return join(home, '.clap');
}

export function builtPlugin(platform = process.platform) {
  return join(build, platform === 'win32' ? 'Release' : '', 'AmiSynth.clap');
}

export function clapInstallPlan({ plugin, dest, platform = process.platform, env = process.env, home = homedir() } = {}) {
  const source = resolve(plugin ?? builtPlugin(platform));
  if (!existsSync(source)) {
    throw new Error(plugin ? `Missing plugin: ${source}`
      : `AmiSynth.clap is not built yet (${source}). Run with --build, or pass --plugin <downloaded AmiSynth.clap>.`);
  }
  // On macOS the plugin is a bundle (a folder); elsewhere it is one file.
  return { source, destination: join(resolve(dest ?? defaultClapDir(platform, env, home)), 'AmiSynth.clap'), bundle: statSync(source).isDirectory() };
}

export function installClap(options = {}, dryRun = false) {
  const plan = clapInstallPlan(options);
  if (dryRun) return plan;
  mkdirSync(dirname(plan.destination), { recursive: true });
  // Replace an older bundle as a whole so no stale files are left inside it.
  if (plan.bundle) rmSync(plan.destination, { recursive: true, force: true });
  try {
    cpSync(plan.source, plan.destination, { recursive: true });
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error(`Cannot write ${plan.destination} (${e.code}). Close the DAW and try again.`);
    throw e;
  }
  // Downloaded builds are not signed; clear the quarantine flag so macOS lets the DAW load them.
  if ((options.platform ?? process.platform) === 'darwin') spawnSync('xattr', ['-dr', 'com.apple.quarantine', plan.destination]);
  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    let dryRun = false, doBuild = false;
    const value = (i, flag) => {
      if (!args[i] || args[i].startsWith('--')) throw new Error(`${flag} requires a path`);
      return args[i];
    };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--plugin') options.plugin = value(++i, '--plugin');
      else if (args[i] === '--dest') options.dest = value(++i, '--dest');
      else if (args[i] === '--build') doBuild = true;
      else if (args[i] === '--dry-run') dryRun = true;
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    if (doBuild && !options.plugin) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const r = spawnSync(npm, ['run', 'clap:build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status !== 0) throw new Error('npm run clap:build failed (needs cmake and a C++ compiler; NASM on Windows)');
    }
    const plan = installClap(options, dryRun);
    console.log(`${dryRun ? 'Would copy' : 'Copied'}: ${plan.source} -> ${plan.destination}`);
    console.log('Next: rescan plugins in your DAW and add AmiSynth Synth / Physical / Drums to an instrument track.');
  } catch (e) {
    console.error(e.message);
    console.error('Usage: npm run install:clap -- [--build] [--plugin <AmiSynth.clap>] [--dest <CLAP folder>] [--dry-run]');
    process.exitCode = 1;
  }
}
