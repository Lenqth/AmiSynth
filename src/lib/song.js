// Song model: several 4-bar patterns (A, B, C, ...) and an arrangement (ordered pattern slots
// with repeat counts). Pure data + helpers, no Svelte / Web Audio, so Node tests can use it.
//
//   Song = { bpm, melodic: 'synth'|'phys', patterns: SongPattern[], arrangement: Slot[], current }
//   SongPattern = { id, name, notes: RollNote[], drums: DrumHit[] }
//   Slot = { pattern: <SongPattern.id>, repeat: 1..MAX_REPEAT }
//
// Everything that comes from outside (localStorage, a shared URL, an imported file) goes through
// sanitizeSong(), which drops or clamps anything malformed.

import { demoPattern, STEPS } from './pattern.js';

export const MAX_PATTERNS = 32;
export const MAX_SLOTS = 128;
export const MAX_REPEAT = 16;
export const MAX_EVENTS = 4096; // notes or drum hits per pattern
export const MAX_NAME = 24;
export const BPM_MIN = 40;
export const BPM_MAX = 240;

/** @typedef {import('./pattern.js').RollNote} RollNote */
/** @typedef {import('./pattern.js').DrumHit} DrumHit */
/** @typedef {{id:number, name:string, notes:RollNote[], drums:DrumHit[]}} SongPattern */
/** @typedef {{pattern:number, repeat:number}} Slot */
/** @typedef {{bpm:number, melodic:'synth'|'phys', patterns:SongPattern[], arrangement:Slot[], current:number}} Song */
/** @typedef {'pattern'|'song'} PlayMode */
/** @typedef {{pattern: SongPattern, slot: number, index: number}} TimelineEntry */
/** @typedef {{bpm:number, melodic:'synth'|'phys', entries: TimelineEntry[]}} Timeline */

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const int = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

/** "A".."Z", then "AA", "AB", ... */
export function letterName(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** The first letter name not used by any pattern of the song. */
export function nextPatternName(song) {
  const used = new Set(song.patterns.map((p) => p.name));
  for (let i = 0; ; i++) if (!used.has(letterName(i))) return letterName(i);
}

function nextId(song) {
  return song.patterns.reduce((m, p) => Math.max(m, p.id), 0) + 1;
}

/** Clean a pattern / slot name: no control characters, trimmed, bounded. */
export function cleanName(v, fallback) {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME).trim();
  return s || fallback;
}

/** @returns {RollNote[]} valid notes only (inside the 4 bars, integer fields, velocity 1..127) */
export function sanitizeNotes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const n of list.slice(0, MAX_EVENTS)) {
    if (!n || typeof n !== 'object') continue;
    const note = int(n.note, -1, 128, -1);
    const start = int(n.start, -1, STEPS, -1);
    if (note < 0 || note > 127 || start < 0 || start >= STEPS) continue;
    out.push({ note, start, len: int(n.len, 1, STEPS - start, 1), vel: int(n.vel, 1, 127, 100) });
  }
  return out;
}

/** @returns {DrumHit[]} */
export function sanitizeDrums(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const h of list.slice(0, MAX_EVENTS)) {
    if (!h || typeof h !== 'object') continue;
    const note = int(h.note, -1, 128, -1);
    const step = int(h.step, -1, STEPS, -1);
    if (note < 0 || note > 127 || step < 0 || step >= STEPS || seen.has(note * STEPS + step)) continue;
    seen.add(note * STEPS + step);
    out.push({ note, step, vel: int(h.vel, 1, 127, 110) });
  }
  return out;
}

/** A Song from a single legacy pattern ({bpm, notes, drums, melodic?}). @returns {Song} */
export function songFromPattern(p, name = 'A') {
  return sanitizeSong({
    bpm: p?.bpm,
    melodic: p?.melodic,
    patterns: [{ id: 1, name, notes: p?.notes, drums: p?.drums }],
    arrangement: [{ pattern: 1, repeat: 1 }],
    current: 0,
  });
}

/** @returns {Song} */
export function demoSong() {
  return songFromPattern(demoPattern());
}

/**
 * Validate / clamp an untrusted song-like object. Always returns a usable Song (at least one pattern);
 * pattern ids are renumbered 1..n and arrangement slots pointing at unknown patterns are dropped.
 * @returns {Song}
 */
export function sanitizeSong(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawPatterns = Array.isArray(src.patterns) ? src.patterns.slice(0, MAX_PATTERNS) : [];
  /** @type {Map<number, number>} raw id -> new id */
  const idMap = new Map();
  const patterns = [];
  for (const p of rawPatterns) {
    if (!p || typeof p !== 'object') continue;
    const id = patterns.length + 1;
    if (isInt(p.id) && !idMap.has(p.id)) idMap.set(p.id, id);
    patterns.push({ id, name: cleanName(p.name, letterName(patterns.length)), notes: sanitizeNotes(p.notes), drums: sanitizeDrums(p.drums) });
  }
  if (patterns.length === 0) patterns.push({ id: 1, name: 'A', notes: [], drums: [] });
  const arrangement = [];
  const rawArr = Array.isArray(src.arrangement) ? src.arrangement.slice(0, MAX_SLOTS) : [];
  for (const s of rawArr) {
    if (!s || typeof s !== 'object' || !isInt(s.pattern) || !idMap.has(s.pattern)) continue;
    arrangement.push({ pattern: idMap.get(s.pattern), repeat: int(s.repeat, 1, MAX_REPEAT, 1) });
  }
  return {
    bpm: num(src.bpm, BPM_MIN, BPM_MAX, 120),
    melodic: src.melodic === 'phys' ? 'phys' : 'synth',
    patterns,
    arrangement,
    current: int(src.current, 0, patterns.length - 1, 0),
  };
}

/**
 * Song from the saved localStorage state: the new `song` field, or the old single `pattern`
 * (which becomes pattern A, played once in the arrangement), or the demo.
 * @returns {Song}
 */
export function migrateSaved(saved) {
  if (saved?.song && typeof saved.song === 'object') return sanitizeSong(saved.song);
  if (saved?.pattern && typeof saved.pattern === 'object') return songFromPattern(saved.pattern);
  return demoSong();
}

/** @param {Song} song */
export function currentPattern(song) {
  return song.patterns[Math.min(song.patterns.length - 1, Math.max(0, song.current))];
}

export function patternIndexById(song, id) {
  return song.patterns.findIndex((p) => p.id === id);
}

/**
 * What the sequencer / exporters play: the current pattern on its own ('pattern' mode), or the
 * arrangement with repeats expanded ('song' mode; an empty arrangement falls back to the current pattern).
 * @param {Song} song @param {PlayMode} mode @returns {Timeline}
 */
export function timeline(song, mode) {
  /** @type {TimelineEntry[]} */
  const entries = [];
  if (mode === 'song') {
    song.arrangement.forEach((s, slot) => {
      const index = patternIndexById(song, s.pattern);
      if (index < 0) return;
      for (let r = 0; r < s.repeat; r++) entries.push({ pattern: song.patterns[index], slot, index });
    });
  }
  if (entries.length === 0) {
    const index = Math.min(song.patterns.length - 1, Math.max(0, song.current));
    entries.push({ pattern: song.patterns[index], slot: -1, index });
  }
  return { bpm: song.bpm, melodic: song.melodic === 'phys' ? 'phys' : 'synth', entries };
}

/** Number of bars the song plays in song mode. */
export function songBars(song) {
  return timeline(song, 'song').entries.length * (STEPS / 16);
}

// ---- structure edits (mutate the song in place; return the affected index) ----------------

/** Add an empty pattern after the last one and select it. */
export function addPattern(song) {
  if (song.patterns.length >= MAX_PATTERNS) return -1;
  song.patterns.push({ id: nextId(song), name: nextPatternName(song), notes: [], drums: [] });
  song.current = song.patterns.length - 1;
  return song.current;
}

/** Copy pattern `index` (inserted right after it) and select the copy. */
export function duplicatePattern(song, index) {
  if (song.patterns.length >= MAX_PATTERNS) return -1;
  const src = song.patterns[index];
  if (!src) return -1;
  const copy = { id: nextId(song), name: nextPatternName(song), notes: src.notes.map((n) => ({ ...n })), drums: src.drums.map((h) => ({ ...h })) };
  song.patterns.splice(index + 1, 0, copy);
  song.current = index + 1;
  return song.current;
}

/** Delete pattern `index` and its arrangement slots (the last pattern can't be deleted). */
export function deletePattern(song, index) {
  if (song.patterns.length <= 1 || !song.patterns[index]) return -1;
  const [gone] = song.patterns.splice(index, 1);
  song.arrangement = song.arrangement.filter((s) => s.pattern !== gone.id);
  song.current = Math.min(song.patterns.length - 1, song.current > index ? song.current - 1 : song.current);
  return song.current;
}

export function renamePattern(song, index, name) {
  const p = song.patterns[index];
  if (p) p.name = cleanName(name, p.name);
}

/** Append (or insert at `at`) a slot playing pattern `index` once. */
export function addSlot(song, index, at = song.arrangement.length) {
  const p = song.patterns[index];
  if (!p || song.arrangement.length >= MAX_SLOTS) return -1;
  const pos = Math.min(song.arrangement.length, Math.max(0, at));
  song.arrangement.splice(pos, 0, { pattern: p.id, repeat: 1 });
  return pos;
}

export function removeSlot(song, slot) {
  if (slot >= 0 && slot < song.arrangement.length) song.arrangement.splice(slot, 1);
}

/** Move a slot one place left (-1) or right (+1). */
export function moveSlot(song, slot, dir) {
  const to = slot + dir;
  if (slot < 0 || to < 0 || slot >= song.arrangement.length || to >= song.arrangement.length) return slot;
  const [s] = song.arrangement.splice(slot, 1);
  song.arrangement.splice(to, 0, s);
  return to;
}

export function setSlotRepeat(song, slot, repeat) {
  const s = song.arrangement[slot];
  if (s) s.repeat = int(repeat, 1, MAX_REPEAT, s.repeat);
}

export function setSlotPattern(song, slot, index) {
  const s = song.arrangement[slot];
  const p = song.patterns[index];
  if (s && p) s.pattern = p.id;
}

/**
 * Split a long note/drum list (steps counted from the song start) into 4-bar patterns.
 * Identical consecutive chunks become one slot with a repeat count, identical chunks anywhere share
 * one pattern; trailing empty bars are dropped. Notes crossing a 4-bar boundary are cut at it.
 * @param {{bpm?:number, melodic?:string, notes:RollNote[], drums:DrumHit[]}} flat
 * @returns {{song: Song, truncated: boolean}}
 */
export function songFromFlat(flat) {
  let last = 0;
  for (const n of flat.notes) last = Math.max(last, n.start + 1);
  for (const h of flat.drums) last = Math.max(last, h.step + 1);
  const chunks = Math.max(1, Math.ceil(last / STEPS));
  const byChunk = Array.from({ length: chunks }, () => ({ notes: [], drums: [] }));
  for (const n of flat.notes) {
    const c = Math.floor(n.start / STEPS);
    const start = n.start - c * STEPS;
    byChunk[c].notes.push({ note: n.note, start, len: Math.max(1, Math.min(n.len, STEPS - start)), vel: n.vel });
  }
  for (const h of flat.drums) {
    const c = Math.floor(h.step / STEPS);
    byChunk[c].drums.push({ note: h.note, step: h.step - c * STEPS, vel: h.vel });
  }
  const patterns = [];
  const arrangement = [];
  const keyToId = new Map();
  let truncated = false;
  for (const chunk of byChunk) {
    chunk.notes.sort((a, b) => a.start - b.start || a.note - b.note);
    chunk.drums.sort((a, b) => a.step - b.step || a.note - b.note);
    const key = JSON.stringify(chunk);
    let id = keyToId.get(key);
    if (id === undefined) {
      if (patterns.length >= MAX_PATTERNS) {
        truncated = true;
        break;
      }
      id = patterns.length + 1;
      keyToId.set(key, id);
      patterns.push({ id, name: letterName(patterns.length), notes: chunk.notes, drums: chunk.drums });
    }
    const prev = arrangement[arrangement.length - 1];
    if (prev && prev.pattern === id && prev.repeat < MAX_REPEAT) prev.repeat++;
    else if (arrangement.length < MAX_SLOTS) arrangement.push({ pattern: id, repeat: 1 });
    else {
      truncated = true;
      break;
    }
  }
  return { song: sanitizeSong({ bpm: flat.bpm, melodic: flat.melodic, patterns, arrangement, current: 0 }), truncated };
}
