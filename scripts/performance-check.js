// Small reproducible physical-model examples; never changes a REAPER project.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { audition, auditionMidi } from './preset-audition.js';
import { createCatalog } from '../src/lib/reaper-catalog.js';
import { encodeWav } from '../src/lib/audiofile.js';

const base = { sampleRate: 48000, seconds: 4, bpm: 120, eventUnit: 'seconds' };
const held = [[0, 0x90, 60, 100], [3, 0x80, 60, 0]];
export function performanceExamples() {
  const curve = (id, points) => ({ id, interpolation: 'linear', points });
  const examples = [
    { id: 'violin-bow', preset: 'Violin', request: { ...base, events: held, curves: [curve('bow_pressure', [[0, .25], [.8, .65], [1.4, .18], [1.55, .55], [2.7, .35], [3, .1]])] } },
    { id: 'clarinet-breath', preset: 'Clarinet', request: { ...base, events: held, curves: [curve('breath_pressure', [[0, .2], [.3, .65], [1.3, .55], [1.45, 0], [1.6, .6], [2.7, .7], [3, 0]])] } },
    { id: 'flute-24edo', preset: 'Pure Flute', patch: { tuning_divisions: 24 }, request: { ...base, events: [51, 55, 59, 61, 65, 69, 73, 75].flatMap((note, i) => [[i * .4, 0x90, note, 100], [i * .4 + .3, 0x80, note, 0]]) } },
  ];
  for (const example of [...examples].filter(e => e.request.curves)) examples.push({ ...example, id: example.id + '-static', request: { ...base, events: held } });
  for (const room of [0, .25]) for (const mode of [0, 1]) examples.push({
    id: `harp-${mode ? 'auto' : 'off'}-${room ? 'room' : 'dry'}`, preset: 'Harp',
    patch: { phys_sustain_mode: mode, phys_room_mix: room, string_sympathetic_mix: 0 },
    request: { ...base, events: [[0, 0xb0, 64, 127], [0, 0x90, 60, 100], [.2, 0x80, 60, 0], [2, 0xb0, 64, 0]],
      windows: [{ name: 'pedal-held', start: 1.4, end: 1.9 }, { name: 'after-pedal-up', start: 2, end: 4 }] },
  });
  return examples;
}

export function runPerformanceCheck(out) {
  const catalog = createCatalog(), index = [];
  const provenance = { measuredAtUtc: new Date().toISOString(), revision: null, workingTreeDirty: null };
  try {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    provenance.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    provenance.workingTreeDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' }).trim();
  } catch { /* Rendering still works when Git or process spawning is unavailable. */ }
  for (const example of performanceExamples()) {
    const preset = catalog.instruments.phys.presets.find(p => p.name === example.preset);
    if (!preset) throw new Error(`Unknown preset ${example.preset}`);
    const { report, left, right } = audition('phys', { ...preset.params, ...example.patch }, example.request);
    const dir = join(out, example.id); mkdirSync(dir, { recursive: true });
    const json = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
    json('report.json', { ...report, ...provenance, preset: example.preset }); json('request.json', report.request);
    json('sound.json', { type: 'amisynth-phys-preset', name: example.id, params: Object.fromEntries(Object.entries(report.diff).filter(([id]) => !id.startsWith('tuning_'))) });
    writeFileSync(join(dir, 'phrase.mid'), auditionMidi(report.request));
    writeFileSync(join(dir, 'audition.wav'), encodeWav(left, right, example.request.sampleRate));
    // A separate listening copy: never use these samples to calculate the raw comparison.
    const desired = report.metrics.integratedLufs === null ? 0 : -20 - report.metrics.integratedLufs;
    const ceiling = report.metrics.samplePeakDbfs === null ? 0 : -1 - report.metrics.samplePeakDbfs;
    const gainDb = Math.min(desired, ceiling), gain = 10 ** (gainDb / 20);
    writeFileSync(join(dir, 'listening.wav'), encodeWav(left.map(v => v * gain), right.map(v => v * gain), example.request.sampleRate));
    json('listening.json', { targetLufs: -20, gainDb, peakLimited: gainDb < desired, predictedLufs: report.metrics.integratedLufs === null ? null : report.metrics.integratedLufs + gainDb, note: 'Sample-peak ceiling -1 dBFS; may prevent matching target. Raw report uses audition.wav before PCM encoding, not listening.wav.' });
    index.push({ id: example.id, preset: example.preset, phraseHash: report.phraseHash, metrics: report.metrics });
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify({ engine: 'Offline JS reference DSP', examples: index, note: 'Dry disables room and sympathetic mix; body resonance remains. No listening judgment or measured fundamental frequency.' }, null, 2) + '\n');
  return index;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Usage: npm run check:performance -- --out DIRECTORY');
    console.log(JSON.stringify(runPerformanceCheck(resolve(process.argv[3])), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
