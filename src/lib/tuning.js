// Main-thread tuning helpers (labels, presets, Scala parsing).
// Frequency math reuses the exact same code as the DSP (src/dsp/lib.js).

import { tuning_init, tuning_note_to_hz, tuning_set_edo, tuning_set_table } from '../dsp/lib.js';

/** Parse a Scala .scl file, or a plain whitespace/comma separated list of cents/ratios. */
export function parseScale(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('!'));
  let name = 'Custom scale';
  let tokens;
  if (lines.length >= 2 && /^\d+$/.test(lines[1].split(/\s+/)[0]) && !/^[\d./\s,-]+$/.test(lines[0])) {
    // Scala: description, count, pitches...
    name = lines[0] || name;
    const count = parseInt(lines[1], 10);
    tokens = lines.slice(2, 2 + count).map((l) => l.split(/\s+/)[0]);
  } else {
    tokens = lines.join(' ').split(/[\s,]+/).filter(Boolean);
  }
  const cents = tokens.map(pitchToCents);
  if (cents.length === 0 || cents.some((c) => !Number.isFinite(c) || c <= 0)) {
    throw new Error('音程は正の cents 値 (例: 386.3) か比 (例: 5/4) で指定してください');
  }
  for (let i = 1; i < cents.length; i++) {
    if (cents[i] <= cents[i - 1]) throw new Error('音程は昇順で並べてください');
  }
  return { name, cents };
}

function pitchToCents(tok) {
  if (tok.includes('.')) return parseFloat(tok);
  const [a, b] = tok.split('/');
  const ratio = b === undefined ? parseFloat(a) : parseFloat(a) / parseFloat(b);
  return 1200 * Math.log2(ratio);
}

const ratios = (list) => list.map((r) => pitchToCents(r));

/**
 * Scala (.scl) text of the current tuning: the custom scale, or the EDO. Saved as
 * REAPER/Data/AmiSynth/tuning.txt it becomes the shared scale of the JSFX (Tuning Source = Scale file).
 * @param {{name:string,cents:number[]} | null} scale @param {number} divisions @param {number} period
 */
export function scaleToScala(scale, divisions, period) {
  const name = scale ? scale.name : `${divisions}-EDO, period ${period} cents`;
  const cents = scale ? scale.cents : Array.from({ length: divisions }, (_, i) => ((i + 1) * period) / divisions);
  const lines = ['! tuning.txt (AmiSynth) - Scala format', '!', name.replace(/[\r\n]+/g, ' '), ` ${cents.length}`, '!'];
  // always with a '.', so every pitch is read as cents
  for (const c of cents) lines.push(` ${c.toFixed(6)}`);
  return lines.join('\n') + '\n';
}

/**
 * Slider values of the "AmiSynth Tuning" JSFX for the current tuning (for MCP tools / LLMs:
 * set them by name on the AmiSynth Tuning instance). null if the scale has more than 32 notes
 * (use a Scala file then).
 * @param {{name:string,cents:number[]} | null} scale
 * @param {{tuning_divisions:number, tuning_period_cents:number, tuning_ref_note:number, tuning_ref_hz:number}} values
 */
export function scaleToHolderParams(scale, values) {
  const d = values.tuning_divisions;
  const cents = scale ? scale.cents : Array.from({ length: d }, (_, i) => ((i + 1) * values.tuning_period_cents) / d);
  if (cents.length > 32) return null;
  /** @type {Record<string, number>} */
  const out = { scale_source: 0, scale_ref_note: values.tuning_ref_note, scale_ref_hz: values.tuning_ref_hz, scale_size: cents.length };
  cents.forEach((c, i) => (out[`scale_degree_${i + 1}`] = Number(c.toFixed(3))));
  return out;
}

export const TUNING_PRESETS = [
  { name: '12-EDO (standard)', divisions: 12, period: 1200 },
  { name: '5-EDO (slendro-like)', divisions: 5, period: 1200 },
  { name: '7-EDO (Thai-like)', divisions: 7, period: 1200 },
  { name: '17-EDO', divisions: 17, period: 1200 },
  { name: '19-EDO', divisions: 19, period: 1200 },
  { name: '22-EDO', divisions: 22, period: 1200 },
  { name: '24-EDO (quarter tones)', divisions: 24, period: 1200 },
  { name: '31-EDO', divisions: 31, period: 1200 },
  { name: '53-EDO', divisions: 53, period: 1200 },
  { name: 'Bohlen-Pierce (13 ED3)', divisions: 13, period: 1901.955 },
  { name: '5-limit Just (C major)', refNote: 60, refHz: 261.6256,
    cents: ratios(['16/15', '9/8', '6/5', '5/4', '4/3', '45/32', '3/2', '8/5', '5/3', '9/5', '15/8', '2/1']) },
  { name: 'Pythagorean', refNote: 60, refHz: 261.6256,
    cents: ratios(['256/243', '9/8', '32/27', '81/64', '4/3', '729/512', '3/2', '128/81', '27/16', '16/9', '243/128', '2/1']) },
  { name: 'Harmonic series 8-16', refNote: 60, refHz: 130.8128,
    cents: ratios(['9/8', '10/8', '11/8', '12/8', '13/8', '14/8', '15/8', '2/1']) },
];

/** Build a tuning object identical to the one inside the synth worklet. */
export function makeTuning(params, scale) {
  const t = {};
  tuning_init(t);
  if (scale) tuning_set_table(t, scale.cents, scale.cents.length);
  else tuning_set_edo(t, params.tuning_divisions, params.tuning_period_cents);
  t.ref_note = params.tuning_ref_note;
  t.ref_hz = params.tuning_ref_hz;
  return t;
}

export function noteHz(t, note) {
  return tuning_note_to_hz(t, note);
}

const NAMES_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const BLACK_12 = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Is the tuning laid out like a piano (12 steps per 1200 cents)? */
export function isPianoLike(t) {
  return t.size === 12 && Math.abs(t.period_cents - 1200) < 1e-6;
}

/** Degree / period of a note, counting from MIDI 60 as degree 0 of period 4. */
export function noteDegree(t, note) {
  const steps = note - 60;
  const period = Math.floor(steps / t.size);
  return { degree: steps - period * t.size, period: period + 4 };
}

export function noteLabel(t, note) {
  if (isPianoLike(t)) return NAMES_12[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
  const { degree, period } = noteDegree(t, note);
  return `${period}·${degree}`;
}
