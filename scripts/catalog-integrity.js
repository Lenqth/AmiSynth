import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPlan } from './install-reaper.js';
import { createCatalog } from '../src/lib/reaper-catalog.js';

const root = fileURLToPath(new URL('..', import.meta.url));
// Bundled files are text. Ignore checkout-specific CRLF conversion on Windows.
const hash = data => createHash('sha256').update(data.toString().replaceAll('\r\n', '\n')).digest('hex');
export function writeManifest() {
  const files = installPlan(root).filter(p => !p.source.endsWith('manifest.json')).map(p => ({
    source: relative(root, p.source).replaceAll('\\', '/'),
    installedPath: relative(root, p.destination).replaceAll('\\', '/'), sha256: hash(readFileSync(p.source)),
  }));
  const presets = Object.fromEntries(Object.entries(createCatalog().instruments).map(([k, v]) => [k, v.presets.map(p => p.name)]));
  writeFileSync(resolve(root, 'jsfx/generated/manifest.json'), JSON.stringify({ schemaVersion: 1, contentId: hash(JSON.stringify(files)), presets, files }, null, 2) + '\n');
}
export function checkCatalogs(resource = null) {
  // Paths always come from this checkout, never an installed manifest.
  const manifest = JSON.parse(readFileSync(resolve(root, 'jsfx/generated/manifest.json'), 'utf8'));
  const failures = [];
  for (const f of manifest.files) {
    const path = resolve(resource ?? root, resource ? f.installedPath : f.source);
    try { if (hash(readFileSync(path)) !== f.sha256) failures.push(`Different: ${path}`); }
    catch { failures.push(`Missing: ${path}`); }
  }
  if (resource) {
    try { if (JSON.parse(readFileSync(resolve(resource, 'Scripts/AmiSynth/generated/manifest.json'), 'utf8')).contentId !== manifest.contentId) failures.push('Installed manifest differs from this checkout'); }
    catch { failures.push('Installed manifest missing'); }
  }
  const dir = resource ? resolve(resource, 'Scripts/AmiSynth/generated') : resolve(root, 'jsfx/generated');
  const full = JSON.parse(readFileSync(resolve(dir, 'presets.json'), 'utf8'));
  const automation = JSON.parse(readFileSync(resolve(dir, 'automation.json'), 'utf8'));
  if (JSON.stringify(automation) !== JSON.stringify(createCatalog())) failures.push('Automation catalog differs from current parameter/preset sources');
  for (const kind of ['synth', 'phys', 'drums']) {
    const names = automation.instruments[kind].presets.map(p => p.name);
    if (JSON.stringify(names) !== JSON.stringify(full[kind].map(p => p.name)) || JSON.stringify(names) !== JSON.stringify(manifest.presets[kind])) failures.push(`Preset list differs: ${kind}`);
  }
  return { contentId: manifest.contentId, counts: Object.fromEntries(Object.entries(manifest.presets).map(([k, v]) => [k, v.length])), failures };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--resource')) throw new Error('Usage: npm run check:catalogs -- [--resource PATH]');
    const result = checkCatalogs(args[1]); console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
