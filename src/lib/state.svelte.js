// Reactive app state + persistence. All parameter writes go through setParam()
// so the worklets always mirror the UI.

import { clampParam, defaultValues, DRUM_PARAMS, SYNTH_PARAMS } from '../dsp/params.js';
import { engine } from './engine.js';
import { demoPattern } from './pattern.js';
import { resolvePreset } from './presets.js';

const STORAGE_KEY = 'amisynth:v1';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const saved = load();

function merged(defs, savedValues) {
  const v = defaultValues(defs);
  if (savedValues) {
    for (const d of defs) if (typeof savedValues[d.id] === 'number') v[d.id] = clampParam(d, savedValues[d.id]);
  }
  return v;
}

export const app = $state({
  started: false,
  starting: false,
  error: '',
  tab: 'synth',
  synth: merged(SYNTH_PARAMS, saved?.synth),
  drums: merged(DRUM_PARAMS, saved?.drums),
  /** @type {{name:string, cents:number[]} | null} */
  scale: saved?.scale ?? null,
  pattern: saved?.pattern ?? demoPattern(),
  /** name of the last applied preset per instrument ('' = none) */
  presetName: { synth: saved?.presetName?.synth ?? 'Init', drums: saved?.presetName?.drums ?? 'AmiSynth Default' },
  /** @type {{synth: import('../presets/synth.js').Preset[], drums: import('../presets/synth.js').Preset[]}} */
  userPresets: { synth: saved?.userPresets?.synth ?? [], drums: saved?.userPresets?.drums ?? [] },
  playing: false,
  playStep: -1,
  baseNote: 48,
  bend: 0,
  modwheel: 0,
  /** notes currently held from the UI / PC keyboard / MIDI (for highlighting) */
  held: /** @type {Record<number, boolean>} */ ({}),
  drumFlash: /** @type {Record<number, number>} */ ({}),
  /** notes sounding from the sequencer: note -> overlap count (keyboard highlight) */
  seqHeld: /** @type {Record<number, number>} */ ({}),
  midiStatus: '',
  /** on-screen key size multiplier (1 = auto size for the pointer type) */
  keyScale: typeof saved?.keyScale === 'number' ? saved.keyScale : 1,
  /** on-screen keyboard layout: auto | piano | linear | grid | hex */
  kbLayout: saved?.kb?.layout ?? 'auto',
  /** isomorphic layout settings per layout ('custom' preset uses right/up) */
  iso: saved?.kb?.iso ?? {
    grid: { preset: 'fourths', right: 1, up: 5, rows: 4 },
    hex: { preset: 'wicki', right: 2, up: 7, rows: 5 },
  },
});

let saveTimer = 0;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        synth: app.synth, drums: app.drums, scale: app.scale, pattern: app.pattern,
        presetName: app.presetName, userPresets: app.userPresets, keyScale: app.keyScale,
        kb: { layout: app.kbLayout, iso: app.iso },
      }));
    } catch {
      /* storage unavailable: ignore */
    }
  }, 300);
}

/** @param {'synth'|'drums'} target */
export function setParam(target, id, value) {
  app[target][id] = value;
  engine.setParam(target, id, value);
  persist();
}

export function setScale(scale) {
  app.scale = scale;
  engine.setScale(scale ? scale.cents : null);
  persist();
}

/** Apply a preset (only non-tuning params change). @param {'synth'|'drums'} target */
export function applyPreset(target, preset) {
  const defs = target === 'synth' ? SYNTH_PARAMS : DRUM_PARAMS;
  app[target] = resolvePreset(defs, preset, app[target]);
  app.presetName[target] = preset.name;
  engine.setParams(target, app[target]);
  persist();
}

export function saveUserPreset(target, name, params) {
  const list = app.userPresets[target].filter((p) => p.name !== name);
  list.push({ name, category: 'User', description: '', params });
  app.userPresets[target] = list;
  app.presetName[target] = name;
  persist();
}

export function deleteUserPreset(target, name) {
  app.userPresets[target] = app.userPresets[target].filter((p) => p.name !== name);
  persist();
}

/** @type {Promise<void> | null} */
let starting = null;

/** Start audio once; concurrent callers (e.g. a 3-finger first touch) all await the same start. */
export function startAudio() {
  if (app.started) return Promise.resolve();
  if (!starting) {
    app.starting = true;
    app.error = '';
    starting = (async () => {
      try {
        await engine.start();
        engine.setParams('synth', app.synth);
        engine.setParams('drums', app.drums);
        if (app.scale) engine.setScale(app.scale.cents);
        app.started = true;
      } catch (e) {
        app.error = `オーディオを開始できませんでした: ${e?.message ?? e}`;
      } finally {
        app.starting = false;
        starting = null;
      }
    })();
  }
  return starting;
}

export function synthNoteOn(note, velocity = 100) {
  if (note < 0 || note > 127) return;
  app.held[note] = true;
  engine.noteOn('synth', note, velocity);
}

export function synthNoteOff(note) {
  if (note < 0 || note > 127) return;
  delete app.held[note];
  engine.noteOff('synth', note);
}

export function drumHit(note, velocity = 110, time) {
  engine.noteOn('drums', note, velocity, time);
  flashDrum(note, time);
}

export function flashDrum(note, time) {
  const delay = time ? Math.max(0, (time - engine.time) * 1000) : 0;
  setTimeout(() => {
    app.drumFlash[note] = (app.drumFlash[note] ?? 0) + 1;
  }, delay);
}

/** UI timers for sequencer note highlights (cleared on stop). */
const seqTimers = new Set();

function later(ms, fn) {
  const id = setTimeout(() => {
    seqTimers.delete(id);
    fn();
  }, ms);
  seqTimers.add(id);
}

/** Light a keyboard key while a sequenced note sounds. */
export function flashSeqNote(note, time, duration) {
  const delay = Math.max(0, (time - engine.time) * 1000);
  later(delay, () => {
    app.seqHeld[note] = (app.seqHeld[note] ?? 0) + 1;
  });
  later(delay + Math.max(30, duration * 1000), () => {
    const n = (app.seqHeld[note] ?? 1) - 1;
    if (n > 0) app.seqHeld[note] = n;
    else delete app.seqHeld[note];
  });
}

export function clearSeqHighlights() {
  for (const id of seqTimers) clearTimeout(id);
  seqTimers.clear();
  app.seqHeld = {};
}

export function setBend(v) {
  app.bend = v;
  const value = Math.round((v + 1) * 8192);
  const clamped = Math.max(0, Math.min(16383, value));
  engine.midi('synth', [0xe0, clamped & 0x7f, clamped >> 7]);
}

export function setModwheel(v) {
  app.modwheel = v;
  engine.midi('synth', [0xb0, 1, Math.round(v * 127)]);
}
