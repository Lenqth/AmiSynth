// Offline JS-reference audition and reproducible metrics; does not control a REAPER project.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog, validatePatch } from '../src/lib/reaper-catalog.js';
import { defaultValues } from '../src/dsp/params.js';
import { INSTRUMENTS } from './jsfx-compare.js';
import { integratedLoudness } from '../src/lib/loudness.js';
import { encodeWav } from '../src/lib/audiofile.js';
import { PLAYING_GUIDES } from '../src/presets/playing-guides.js';

const catalog = createCatalog();
const db = x => x > 0 ? 20 * Math.log10(x) : null;
function phraseFingerprint(request) {
  const { sampleRate, seconds, bpm, eventUnit } = request;
  const events = request.events.map(e => [...e]).sort((a, b) => a[0] - b[0]);
  return createHash('sha256').update(JSON.stringify({ sampleRate, seconds, bpm, events, eventUnit })).digest('hex');
}

/** All melodic models share the same notes/velocity by default; guides are opt-in. */
export function auditionPhrase(guide = null) {
  const notes = guide?.notes ?? [60, 64, 67, 72];
  const bpm = guide?.bpm ?? 120, velocity = guide?.velocity ?? 100;
  const beat = 60 / bpm;
  return { sampleRate: 48000, bpm, seconds: 8 * beat + 1,
    events: notes.flatMap((n, i) => [[i * 2 * beat, 0x90, n, velocity], [(i * 2 + 1.5) * beat, 0x80, n, 0]]),
    eventUnit: 'seconds', phrase: guide ? 'playing-guide' : 'common-four-notes-v1' };
}

export function audition(kind, patch = {}, request = auditionPhrase()) {
  if (!['synth', 'phys', 'drums'].includes(kind)) throw new Error('kind must be synth, phys or drums');
  validatePatch(catalog.instruments[kind], patch);
  const core = INSTRUMENTS[kind], params = { ...defaultValues(core.defs), ...patch };
  const { sampleRate: sr, seconds, bpm, events } = request;
  if (![44100, 48000].includes(sr) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 30 ||
      !Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new Error('Use 44100/48000 Hz, 0-30 seconds and 20-400 BPM');
  if (!Array.isArray(events) || events.length > 10000 || request.eventUnit !== 'seconds') throw new Error('events must be up to 10000 [seconds,status,data1,data2] entries');
  for (const e of events) if (!Array.isArray(e) || e.length !== 4 || !Number.isFinite(e[0]) || e[0] < 0 || e[0] >= seconds ||
    !Number.isInteger(e[1]) || e[1] < 0x80 || e[1] > 0xef || e.slice(2).some(v => !Number.isInteger(v) || v < 0 || v > 127)) throw new Error('Invalid MIDI event');
  const ordered = events.map(e => [...e]).sort((a, b) => a[0] - b[0]);
  const schedule = ordered.map(([t, ...bytes]) => [Math.round(t * sr), ...bytes]);
  const phrase = { sampleRate: sr, seconds, bpm, events: ordered, eventUnit: 'seconds' };
  const phraseHash = phraseFingerprint(phrase);
  const s = {}; core.init(s, sr); core.update(s, params);
  const n = Math.round(seconds * sr), left = new Float64Array(n), right = new Float64Array(n);
  let ev = 0, sum = 0, peak = 0, maxActive = 0, maxReleased = 0, steals = 0;
  for (let i = 0; i < n; i++) {
    if (i % 128 === 0 && core.transport) core.transport(s, bpm, 1, i * bpm / (60 * sr));
    while (ev < schedule.length && schedule[ev][0] <= i) {
      const [, status, a, b] = schedule[ev++];
      const before = s.voices?.map(v => ({ active: v.active, note: v.note, age: v.age }));
      core.midi(s, status, a, b);
      if ((status & 0xf0) === 0x90 && b > 0 && before && !s.mono)
        for (let j = 0; j < before.length; j++) if (before[j].active && s.voices[j].age > before[j].age && before[j].note !== s.voices[j].note) steals++;
    }
    core.render(s);
    left[i] = s.out_l; right[i] = s.out_r;
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('Non-finite DSP output');
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    sum += left[i] * left[i] + right[i] * right[i];
    if (s.voices) {
      let active = 0, released = 0;
      for (const v of s.voices) if (v.active) { active++; if (!v.gate) released++; }
      maxActive = Math.max(maxActive, active); maxReleased = Math.max(maxReleased, released);
    }
  }
  const lufs = integratedLoudness(left, right, sr);
  const loudness = Number.isFinite(lufs) ? lufs : null;
  const volumeId = kind === 'phys' ? 'phys_volume_db' : kind === 'synth' ? 'master_volume_db' : 'drum_master_volume_db';
  const volume = core.defs.find(d => d.id === volumeId);
  const correction = loudness === null ? null : Math.max(volume.min - params[volumeId], Math.min(volume.max - params[volumeId], Math.max(-12, Math.min(12, -18 - loudness))));
  const report = { schemaVersion: 1, engine: 'AmiSynth JS reference DSP', kind, phraseHash, request: phrase,
    params, diff: Object.fromEntries(core.defs.filter(d => params[d.id] !== d.default).map(d => [d.id, params[d.id]])),
    metrics: { samplePeak: peak, samplePeakDbfs: db(peak), rmsDbfs: db(Math.sqrt(sum / (2 * n))), integratedLufs: loudness,
      maxActiveVoices: s.voices ? maxActive : null, maxReleasedVoices: s.voices ? maxReleased : null,
      voiceSteals: s.voices ? steals : null },
    levelSuggestion: { targetLufs: -18, parameter: volumeId, correctionDb: correction,
      suggestedValue: correction === null ? null : params[volumeId] + correction, applied: false },
    limitations: ['Offline JS DSP, not a measurement of the installed REAPER FX or track fader.', 'Sample peak, not true peak. No sidechain audio input.', 'Gain correction is a capped suggestion; re-render to verify.'] };
  return { report, left, right };
}

export function compareAuditions(current, reference) {
  if (!reference.request || reference.phraseHash !== phraseFingerprint(reference.request) || current.phraseHash !== phraseFingerprint(current.request))
    throw new Error('Invalid report phrase fingerprint');
  if (current.phraseHash !== reference.phraseHash) throw new Error('Reference uses a different MIDI phrase, velocity, tempo, duration or sample rate');
  const delta = {};
  for (const key of ['samplePeakDbfs', 'rmsDbfs', 'integratedLufs']) {
    const a = current.metrics[key], b = reference.metrics[key]; delta[key] = a === null || b === null ? null : a - b;
  }
  return delta;
}

/** Export exactly the request's channel messages, quantized to 960 PPQ. */
export function auditionMidi(request) {
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (tag, data) => [...Buffer.from(tag), ...u32(data.length), ...data];
  const vlq = n => { const bytes = [n & 127]; while ((n >>>= 7)) bytes.unshift((n & 127) | 128); return bytes; };
  const us = Math.round(60000000 / request.bpm), data = [0, 0xff, 0x51, 3, (us >>> 16) & 255, (us >>> 8) & 255, us & 255];
  let previous = 0;
  for (const [time, status, a, b] of [...request.events].sort((a, b) => a[0] - b[0])) {
    const tick = Math.round(time * request.bpm / 60 * 960);
    data.push(...vlq(tick - previous), status, a);
    if ((status & 0xf0) !== 0xc0 && (status & 0xf0) !== 0xd0) data.push(b);
    previous = tick;
  }
  data.push(...vlq(Math.max(0, Math.round(request.seconds * request.bpm / 60 * 960) - previous)), 0xff, 0x2f, 0);
  return Uint8Array.from([...chunk('MThd', [0, 0, 0, 1, 3, 192]), ...chunk('MTrk', data)]);
}

function main() {
  const [kind, ...args] = process.argv.slice(2);
  let name, out, reference, request, patch = {}, guide = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (flag === '--guide') { guide = true; continue; }
    if (!['--preset', '--out', '--reference', '--request', '--patch'].includes(flag) || !args[i + 1]) throw new Error('Use synth|phys|drums --preset name --out directory [--guide] [--patch JSON] [--request JSON] [--reference report.json]');
    const value = args[++i];
    if (flag === '--preset') name = value;
    if (flag === '--out') out = value;
    if (flag === '--reference') reference = JSON.parse(readFileSync(value, 'utf8'));
    if (flag === '--request') request = JSON.parse(readFileSync(value, 'utf8'));
    if (flag === '--patch') { const json = JSON.parse(readFileSync(value, 'utf8')); patch = json.params ?? json; }
  }
  const preset = catalog.instruments[kind]?.presets.find(p => p.name === name);
  if (!preset || !out) throw new Error('Specify a valid instrument, --preset and --out');
  if (guide && (!PLAYING_GUIDES[name] || PLAYING_GUIDES[name].kind !== kind)) throw new Error('No playing guide for this preset');
  if (request && guide) throw new Error('--guide and --request cannot be combined');
  const input = request ?? auditionPhrase(guide ? PLAYING_GUIDES[name] : null);
  if (kind === 'drums' && !request) throw new Error('Drums require --request with GM drum notes');
  const { report, left, right } = audition(kind, { ...preset.params, ...patch }, input);
  report.preset = name;
  report.measuredAtUtc = new Date().toISOString();
  if (reference) report.comparison = compareAuditions(report, reference);
  try { report.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim();
    report.workingTreeDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim().length > 0;
  } catch { report.revision = null; report.workingTreeDirty = null; }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'sound.json'), JSON.stringify({ type: `amisynth-${kind}-preset`, name,
    params: Object.fromEntries(Object.entries(report.diff).filter(([id]) => !id.startsWith('tuning_'))) }, null, 2) + '\n');
  writeFileSync(join(out, 'request.json'), JSON.stringify(report.request, null, 2) + '\n');
  writeFileSync(join(out, 'audition.wav'), encodeWav(left, right, input.sampleRate));
  writeFileSync(join(out, 'phrase.mid'), auditionMidi(report.request));
  console.log(JSON.stringify({ report: resolve(out, 'report.json'), metrics: report.metrics, levelSuggestion: report.levelSuggestion, comparison: report.comparison }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
