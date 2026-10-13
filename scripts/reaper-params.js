// Generate explicit real/normalized payloads for MCP and verify real-value readback.
import { readFileSync } from 'node:fs';
import { createCatalog, macroPatch, validatePatch, verifyReadback } from '../src/lib/reaper-catalog.js';

try {
  const [kind, ...args] = process.argv.slice(2);
  const catalog = createCatalog();
  const inst = catalog.instruments[kind];
  if (!inst) throw new Error('Usage: node scripts/reaper-params.js synth|phys|drums|tuning [--preset name] [--macro name amount(0..1)] [--set id value] [--readback file.json]');
  let params = {}, readback;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--preset') {
      const name = args[++i];
      const preset = inst.presets.find((p) => p.name === name);
      if (!preset) throw new Error(`Unknown preset: ${name}`);
      params = { ...params, ...preset.params };
    } else if (option === '--macro') {
      const name = args[++i], amount = Number(args[++i]);
      params = { ...params, ...macroPatch(inst, name, amount) };
    } else if (option === '--set') {
      const id = args[++i], value = Number(args[++i]);
      params[id] = value;
    } else if (option === '--readback') readback = JSON.parse(readFileSync(args[++i], 'utf8'));
    else throw new Error(`Unknown option: ${option}`);
  }
  const writes = validatePatch(inst, params);
  if (readback !== undefined && !writes.length) throw new Error('Readback verification requires --preset, --macro or --set');
  const result = writes.length ? { kind, valueDomain: 'real', writes,
    ...(readback === undefined ? {} : { mismatches: verifyReadback(inst, params, readback) }) } : inst;
  console.log(JSON.stringify(result, null, 2));
  if (result.mismatches?.length) process.exitCode = 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
