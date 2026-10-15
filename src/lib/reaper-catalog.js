// Companion controls write existing sliders: no new automation indices or DSP modes.
import { SYNTH_PARAMS, PHYS_PARAMS, DRUM_PARAMS, TUNING_HOLDER_PARAMS } from '../dsp/params.js';
import { SYNTH_PRESETS } from '../presets/synth.js';
import { PHYS_PRESETS } from '../presets/phys.js';
import { DRUM_PRESETS } from '../presets/drums.js';
import { resolvePreset } from './presets.js';

export const MACROS = [
  { name: 'Brightness', description: 'Cutoff and filter envelope depth.', targets: [
    { id: 'filter_cutoff_hz', min: 100, max: 16000, scale: 'log' },
    { id: 'filter_env_amount_oct', min: 0, max: 6 },
  ] },
  { name: 'Punch', description: 'Higher values shorten attack and decay.', targets: [
    { id: 'amp_attack_ms', min: 20, max: 0.5, scale: 'log' },
    { id: 'amp_decay_ms', min: 1200, max: 120, scale: 'log' },
    { id: 'filter_env_attack_ms', min: 20, max: 0.5, scale: 'log' },
    { id: 'filter_env_decay_ms', min: 800, max: 80, scale: 'log' },
  ] },
  { name: 'Width', description: 'Unison count, detune and stereo width.', targets: [
    { id: 'unison_voices', min: 1, max: 5 },
    { id: 'unison_detune_cents', min: 0, max: 30 },
    { id: 'unison_stereo_width', min: 0, max: 1 },
  ] },
  { name: 'Pump', description: 'Quarter-note Duck LFO; replaces the current LFO waveform and sync.', targets: [
    { id: 'lfo_waveform', min: 5, max: 5 },
    { id: 'lfo_sync', min: 7, max: 7 },
    { id: 'lfo_amp', min: 0, max: 1 },
  ] },
];

export function createCatalog() {
  const instruments = {};
  for (const [kind, defs, presets] of [
    ['synth', SYNTH_PARAMS, SYNTH_PRESETS], ['phys', PHYS_PARAMS, PHYS_PRESETS],
    ['drums', DRUM_PARAMS, DRUM_PRESETS], ['tuning', TUNING_HOLDER_PARAMS, []],
  ]) {
    instruments[kind] = {
      parameters: defs.map((d, i) => ({ ...d, slider: i + 1, paramIndex: i,
        valueDomain: d.file ? 'file-index' : d.readonly ? 'read-only' : 'real',
        ...(d.options ? { enumValues: d.options.map((label, value) => ({ value, label })) } : {}),
      })),
      presets: presets.map((p) => ({ name: p.name, category: p.category, description: p.description,
        // Tuning must survive preset changes, even in REAPER.
        params: Object.fromEntries(Object.entries(resolvePreset(defs, p)).filter(([id]) => !id.startsWith('tuning_'))),
      })),
      macros: kind === 'synth' ? MACROS : [],
    };
  }
  return { schemaVersion: 1, api: { real: 'TrackFX_SetParam', normalized: 'TrackFX_SetParamNormalized',
    normalization: '(value - min) / (max - min)', indexBase: 0 }, instruments };
}

export function validatePatch(instrument, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Expected a parameter object');
  const byId = new Map(instrument.parameters.map((d) => [d.id, d]));
  return Object.entries(params).map(([id, value]) => {
    const d = byId.get(id);
    if (!d) throw new Error(`Unknown parameter: ${id}`);
    if (d.file) throw new Error(`${id}: file indices depend on the REAPER Data directory`);
    if (d.readonly) throw new Error(`${id}: read-only status parameter`);
    if (!Number.isFinite(value) || value < d.min || value > d.max) throw new Error(`${id}: expected ${d.min}..${d.max} ${d.unit}`);
    if (d.step >= 1 && value !== Math.round(value)) throw new Error(`${id}: expected an integer`);
    return { id, paramIndex: d.paramIndex, slider: d.slider, value,
      normalized: (value - d.min) / (d.max - d.min) };
  });
}

export function macroPatch(instrument, name, amount) {
  const macro = instrument.macros.find((m) => m.name === name);
  if (!macro) throw new Error(`Unknown macro: ${name}`);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('Macro amount must be 0..1');
  const params = Object.fromEntries(macro.targets.map((t) => {
    const d = instrument.parameters.find((d) => d.id === t.id);
    let v = t.scale === 'log' ? t.min * (t.max / t.min) ** amount : t.min + (t.max - t.min) * amount;
    if (d.step >= 1) v = Math.round(v);
    return [t.id, v];
  }));
  validatePatch(instrument, params);
  return params;
}

export function verifyReadback(instrument, params, actual) {
  return validatePatch(instrument, params).flatMap(({ id, value }) => {
    const d = instrument.parameters.find((d) => d.id === id);
    const got = actual?.[id];
    return Number.isFinite(got) && Math.abs(got - value) <= Math.max(1e-6, Math.abs(value) * 1e-6)
      ? [] : [{ id, expected: value, actual: got ?? null, unit: d.unit }];
  });
}
