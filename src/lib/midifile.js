// Standard MIDI File (format 1) export of the 4-bar pattern, so it can be dropped
// into REAPER onto the AmiSynth JSFX instruments.
//   track 0: tempo, track 1: melodic notes (channel 1), track 2: drums (channel 10)

import { STEPS_PER_BEAT } from './pattern.js';

const PPQ = 480;
const TICKS_PER_STEP = PPQ / STEPS_PER_BEAT;

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function chunk(type, data) {
  const len = data.length;
  return [...type].map((c) => c.charCodeAt(0)).concat([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], data);
}

/** events: [tick, bytes[]] -> track chunk (sorted, delta-timed, with end-of-track) */
function track(events, name) {
  const named = [[0, [0xff, 0x03, ...vlq(name.length), ...[...name].map((c) => c.charCodeAt(0) & 0x7f)]], ...events];
  // note-offs before note-ons at the same tick so repeated notes retrigger
  named.sort((a, b) => a[0] - b[0] || ((a[1][0] & 0xf0) === 0x80 ? -1 : 0) - ((b[1][0] & 0xf0) === 0x80 ? -1 : 0));
  const data = [];
  let last = 0;
  for (const [tick, bytes] of named) {
    data.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  data.push(0, 0xff, 0x2f, 0x00);
  return chunk('MTrk', data);
}

/** @param {import('./pattern.js').Pattern} pattern @returns {Uint8Array} */
export function patternToMidi(pattern) {
  const usPerBeat = Math.round(60000000 / pattern.bpm);
  const tempo = track([[0, [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255]], [0, [0xff, 0x58, 0x04, 4, 2, 24, 8]]], 'AmiSynth');
  const melodic = [];
  for (const n of pattern.notes) {
    const on = n.start * TICKS_PER_STEP;
    melodic.push([on, [0x90, n.note & 127, Math.max(1, Math.min(127, n.vel))]]);
    melodic.push([on + n.len * TICKS_PER_STEP, [0x80, n.note & 127, 0]]);
  }
  const drums = [];
  for (const h of pattern.drums) {
    const on = h.step * TICKS_PER_STEP;
    drums.push([on, [0x99, h.note & 127, Math.max(1, Math.min(127, h.vel))]]);
    drums.push([on + TICKS_PER_STEP / 2, [0x89, h.note & 127, 0]]);
  }
  const header = chunk('MThd', [0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255]);
  const inst = pattern.melodic === 'phys' ? 'AmiSynth Physical' : 'AmiSynth Synth';
  return new Uint8Array([...header, ...tempo, ...track(melodic, inst), ...track(drums, 'AmiSynth Drums')]);
}

export function downloadPatternMidi(pattern, filename = 'amisynth-pattern.mid') {
  const blob = new Blob([patternToMidi(pattern)], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
