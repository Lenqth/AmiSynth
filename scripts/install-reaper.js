// Explicit resource path only: supports portable REAPER and never scans user folders.
// --jsfx-only installs just Effects/AmiSynth, for JSFX hosts other than REAPER (ysfx-s, see docs/OTHER_HOSTS.md).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function installPlan(resourcePath, { jsfxOnly = false } = {}) {
  const resource = resolve(resourcePath);
  if (!existsSync(resource) || !statSync(resource).isDirectory()) throw new Error('Resource path must be an existing REAPER resource directory');
  const files = [
    ...['AmiSynth Synth.jsfx', 'AmiSynth Physical.jsfx', 'AmiSynth Drums.jsfx', 'AmiSynth Tuning.jsfx',
      'AmiSynth Synth.jsfx.rpl', 'AmiSynth Physical.jsfx.rpl', 'AmiSynth Drums.jsfx.rpl',
      'amisynth_lib.jsfx-inc', 'amisynth_meter.jsfx-inc', 'amisynth_modulation.jsfx-inc'].map((name) => [`jsfx/${name}`, `Effects/AmiSynth/${name}`]),
    ...['AmiSynth Companion.lua', 'AmiSynth Drums - Create routed tracks.lua', 'AmiSynth - MCP guide.lua',
      'AmiSynth - Apply sound.lua', 'AmiSynth - Read sound.lua', 'AmiSynth - Run.lua', 'toolkit.lua', 'README.md'].map((name) => [`jsfx/reaper/${name}`, `Scripts/AmiSynth/reaper/${name}`]),
    ...['catalog.lua', 'automation.json', 'presets.json', 'manifest.json'].map((name) => [`jsfx/generated/${name}`, `Scripts/AmiSynth/generated/${name}`]),
  ];
  return files.filter(([, dest]) => !jsfxOnly || dest.startsWith('Effects/'))
    .map(([src, dest]) => ({ source: join(root, src), destination: join(resource, dest) }));
}

export function install(resource, dryRun = false, options = {}) {
  const plan = installPlan(resource, options);
  // Check all sources before writing anything.
  for (const { source } of plan) if (!statSync(source).isFile()) throw new Error(`Missing source: ${source}`);
  if (!dryRun) for (const { source, destination } of plan) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let resource, dryRun = false, jsfxOnly = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--resource') {
        resource = args[++i];
        if (!resource || resource.startsWith('--')) throw new Error('--resource requires a path');
      } else if (args[i] === '--dry-run') dryRun = true;
      else if (args[i] === '--jsfx-only') jsfxOnly = true;
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    if (!resource) throw new Error('Usage: npm run install:reaper -- --resource "REAPER resource path" [--dry-run] [--jsfx-only]');
    for (const p of install(resource, dryRun, { jsfxOnly })) console.log(`${dryRun ? 'Would copy' : 'Copied'}: ${p.destination}`);
    console.log(jsfxOnly ? 'Next: load Effects/AmiSynth/*.jsfx in your JSFX host (see docs/OTHER_HOSTS.md).'
      : 'Next: Actions > New action > Load ReaScript, or MCP script_list(filter="AmiSynth").');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
