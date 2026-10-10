// Preset helpers shared by the UI, the tests and the JSFX generator.
import { clampParam, defaultValues } from '../dsp/params.js';

const isTuning = (id) => id.startsWith('tuning_');

/** Full parameter values for a preset (defaults + overrides). Tuning comes from `keep` if given. */
export function resolvePreset(defs, preset, keep = {}) {
  const values = defaultValues(defs);
  for (const d of defs) {
    if (isTuning(d.id)) {
      if (d.id in keep) values[d.id] = keep[d.id];
    } else if (typeof preset.params[d.id] === 'number') {
      values[d.id] = clampParam(d, preset.params[d.id]);
    }
  }
  return values;
}

/** Values that differ from the defaults (tuning excluded): the compact, LLM-friendly form. */
export function diffFromDefaults(defs, values) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const d of defs) {
    if (isTuning(d.id)) continue;
    if (Math.abs(values[d.id] - d.default) > 1e-9) out[d.id] = values[d.id];
  }
  return out;
}

export function presetToJson(kind, name, defs, values) {
  return JSON.stringify({ type: `amisynth-${kind}-preset`, name, params: diffFromDefaults(defs, values) }, null, 2);
}

/**
 * Accepts {name?, params:{...}} or a bare {id: value} object.
 * Unknown ids / non-numbers are reported, out-of-range values are clamped.
 */
export function parsePresetJson(text, defs) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON として読めません: ${e.message}`);
  }
  if (!obj || typeof obj !== 'object') throw new Error('JSON オブジェクトではありません');
  const raw = obj.params && typeof obj.params === 'object' ? obj.params : obj;
  const byId = new Map(defs.map((d) => [d.id, d]));
  /** @type {Record<string, number>} */
  const params = {};
  const warnings = [];
  for (const [id, v] of Object.entries(raw)) {
    if (id === 'name' || id === 'type' || id === 'description' || id === 'category') continue;
    const d = byId.get(id);
    if (!d) warnings.push(`不明なパラメータ: ${id}`);
    else if (isTuning(id)) warnings.push(`チューニングはプリセットに含めません: ${id}`);
    else if (typeof v !== 'number' || !Number.isFinite(v)) warnings.push(`数値ではありません: ${id}`);
    else {
      const c = clampParam(d, v);
      if (c !== v) warnings.push(`${id} を範囲内 (${c}) に丸めました`);
      params[id] = c;
    }
  }
  if (Object.keys(params).length === 0 && warnings.length > 0) throw new Error(warnings.join('\n'));
  return { name: typeof obj.name === 'string' ? obj.name : 'Pasted', params, warnings };
}
