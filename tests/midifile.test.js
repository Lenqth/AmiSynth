import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternToMidi } from '../src/lib/midifile.js';

/** minimal SMF reader for the test: returns tracks as [absTick, bytes] lists */
function parse(buf) {
  const u = buf;
  const str = (o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  const u32 = (o) => (u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3];
  assert.equal(str(0), 'MThd');
  const ntr = (u[10] << 8) | u[11];
  const ppq = (u[12] << 8) | u[13];
  let o = 14;
  const tracks = [];
  for (let t = 0; t < ntr; t++) {
    assert.equal(str(o), 'MTrk');
    const end = o + 8 + u32(o + 4);
    o += 8;
    let tick = 0;
    const ev = [];
    while (o < end) {
      let d = 0;
      let b;
      do {
        b = u[o++];
        d = (d << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += d;
      if (u[o] === 0xff) {
        const len = u[o + 2];
        ev.push([tick, [...u.slice(o, o + 3 + len)]]);
        o += 3 + len;
      } else {
        ev.push([tick, [...u.slice(o, o + 3)]]);
        o += 3;
      }
    }
    tracks.push(ev);
  }
  return { ppq, tracks };
}

test('pattern exports as a valid 3-track SMF with tempo, notes and drums on ch10', () => {
  const smf = parse(patternToMidi({
    bpm: 120,
    notes: [{ note: 60, start: 0, len: 4, vel: 100 }, { note: 60, start: 4, len: 2, vel: 90 }],
    drums: [{ note: 36, step: 0, vel: 110 }, { note: 42, step: 2, vel: 70 }],
  }));
  assert.equal(smf.ppq, 480);
  assert.equal(smf.tracks.length, 3);
  const tempo = smf.tracks[0].find(([, b]) => b[0] === 0xff && b[1] === 0x51)[1];
  assert.equal((tempo[3] << 16) | (tempo[4] << 8) | tempo[5], 500000); // 120 bpm
  const mel = smf.tracks[1].filter(([, b]) => b[0] !== 0xff);
  assert.deepEqual(mel.map(([t, b]) => [t, b[0], b[1]]), [[0, 0x90, 60], [480, 0x80, 60], [480, 0x90, 60], [720, 0x80, 60]]);
  const dr = smf.tracks[2].filter(([, b]) => b[0] === 0x99);
  assert.deepEqual(dr.map(([t, b]) => [t, b[1], b[2]]), [[0, 36, 110], [240, 42, 70]]);
  for (const tr of smf.tracks) assert.deepEqual(tr.at(-1)[1], [0xff, 0x2f, 0x00]);
});

// ---- import ----------------------------------------------------------------------------------

import { GM_DRUM_MAP, midiToSteps, parseMidi, timelineToMidi } from '../src/lib/midifile.js';
import { sanitizeSong, songFromFlat, timeline } from '../src/lib/song.js';
import { DRUM_PARTS } from '../src/dsp/params.js';
import { STEPS } from '../src/lib/pattern.js';

const vlq = (n) => {
  const b = [n & 0x7f];
  while ((n >>= 7) > 0) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const chunkBytes = (type, data) => [...type].map((c) => c.charCodeAt(0)).concat([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255], data);
/** SMF from raw track byte lists (already delta-timed) */
const smf = (format, ppq, tracks) => new Uint8Array([
  ...chunkBytes('MThd', [0, format, 0, tracks.length, ppq >> 8, ppq & 255]),
  ...tracks.flatMap((t) => chunkBytes('MTrk', [...t, 0, 0xff, 0x2f, 0])),
]);

test('MIDI round trip: song -> SMF -> 4-bar patterns + arrangement again', () => {
  const song = sanitizeSong({
    bpm: 133,
    patterns: [
      { id: 1, name: 'A', notes: [{ note: 60, start: 0, len: 4, vel: 100 }, { note: 64, start: 0, len: 64, vel: 30 }, { note: 60, start: 4, len: 2, vel: 90 }],
        drums: [{ note: 36, step: 0, vel: 127 }, { note: 42, step: 2, vel: 1 }, { note: 70, step: 63, vel: 64 }] },
      { id: 2, name: 'B', notes: [{ note: 72, start: 63, len: 1, vel: 127 }], drums: DRUM_PARTS.map((p, i) => ({ note: p.note, step: i * 3, vel: 10 + i })) },
    ],
    arrangement: [{ pattern: 1, repeat: 3 }, { pattern: 2, repeat: 1 }, { pattern: 1, repeat: 1 }],
  });
  const bytes = timelineToMidi(timeline(song, 'song'));
  const midi = parseMidi(bytes);
  assert.equal(midi.format, 1);
  const flat = midiToSteps(midi);
  assert.deepEqual(flat.warnings, []);
  assert.equal(flat.bpm, 133);
  const back = songFromFlat({ ...flat, melodic: song.melodic }).song;
  const norm = (p) => ({
    notes: [...p.notes].sort((a, b) => a.start - b.start || a.note - b.note),
    drums: [...p.drums].sort((a, b) => a.step - b.step || a.note - b.note),
  });
  assert.deepEqual(back.patterns.map(norm), song.patterns.map(norm));
  assert.deepEqual(back.arrangement, song.arrangement);
  // pattern mode exports just the edited pattern
  song.current = 1;
  const one = midiToSteps(parseMidi(timelineToMidi(timeline(song, 'pattern'))));
  assert.deepEqual(norm(one), norm(song.patterns[1]));
});

test('MIDI import: format 0, running status, note-on vel 0, quantize, GM drum aliases, odd PPQ', () => {
  const ppq = 96; // 24 ticks per 16th
  const track = [
    0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0, // 600000 us = 100 bpm
    0, 0xc0, 5, // program change (1 data byte), ignored
    0, 0xf0, 2, 0x7e, 0xf7, // sysex, skipped
    0, 0x90, 60, 100, // C4 on
    13, 62, 80, // running status: D4 on at tick 13 -> step 1 (rounded)
    35, 60, 0, // C4 off (vel 0) at tick 48 -> 2 steps
    0, 0x99, 35, 120, // GM acoustic bass drum -> kick
    0, 44, 70, // pedal hat -> closed hat (running status)
    0, 72, 50, // long whistle: not played -> dropped
    10, 0xb0, 7, 100, // CC, ignored
    38, 0x80, 62, 0, // D4 off at tick 96 -> step 4
    0, 0x90, 20, 90, // below the piano roll
    24, 0x80, 20, 0,
    0, 0x90, 67, 99, // G4 never released: ends at end of file
    48, 0xe0, 0, 64,
  ];
  const midi = parseMidi(smf(0, ppq, [track]));
  const out = midiToSteps(midi, { lowNote: 24, highNote: 108 });
  assert.equal(out.bpm, 100);
  assert.deepEqual(out.notes, [
    { note: 60, start: 0, len: 2, vel: 100 },
    { note: 62, start: 1, len: 3, vel: 80 },
    { note: 67, start: 5, len: 2, vel: 99 },
  ]);
  assert.deepEqual(out.drums, [{ note: 36, step: 2, vel: 120 }, { note: 42, step: 2, vel: 70 }]);
  assert.equal(out.warnings.length, 2, out.warnings.join('\n'));
  for (const to of Object.values(GM_DRUM_MAP)) assert.ok(DRUM_PARTS.some((p) => p.note === to));
  // maxSteps (import into one pattern): notes after bar 4 are dropped with a warning
  const long = parseMidi(smf(1, 480, [[0, 0x90, 60, 100, 0x8f, 0x00, 0x80, 60, 0], [0, 0x90, 62, 90, 0x83, 0x60, 0x80, 62, 0]]));
  assert.equal(midiToSteps(long, { maxSteps: STEPS }).notes.length, 2);
  const late = parseMidi(smf(1, 480, [[0x81, 0xf6, 0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0]])); // tick 32000 = step 266
  const r = midiToSteps(late, { maxSteps: STEPS });
  assert.equal(r.notes.length, 0);
  assert.equal(r.warnings.length, 1);
});

test('MIDI import rejects broken / unsupported files without hanging', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])), /Standard MIDI File/);
  assert.throws(() => parseMidi(new Uint8Array([...chunkBytes('MThd', [0, 2, 0, 1, 0, 96])])), /format 2/);
  assert.throws(() => parseMidi(new Uint8Array([...chunkBytes('MThd', [0, 1, 0, 1, 0xe7, 0x28])])), /SMPTE/);
  assert.throws(() => parseMidi(new Uint8Array([...chunkBytes('MThd', [0, 1, 0, 1, 0, 0])])), /PPQ/);
  // truncated event / bad running status / endless VLQ
  assert.throws(() => parseMidi(smf(0, 96, [[0, 0x90, 60]])), /途中で切れて|不正/);
  assert.throws(() => parseMidi(smf(0, 96, [[0, 60, 100]])), /ランニングステータス/);
  assert.throws(() => parseMidi(smf(0, 96, [[0xff, 0xff, 0xff, 0xff, 0x7f]])), /可変長/);
  // a track length that points past the end of the file: read what's there
  const bytes = smf(0, 96, [[0, 0x90, 60, 100, 24, 0x80, 60, 0]]);
  bytes[18] = 0x7f; // MTrk length -> huge
  assert.equal(parseMidi(bytes).notes.length, 1);
  assert.throws(() => parseMidi(/** @type {any} */ ([0x4d])), /MIDI データ/);
});

test('MIDI import: program change of the main melodic channel picks a GM preset', async () => {
  const { GM_PROGRAMS, gmProgramPreset } = await import('../src/presets/gm.js');
  // ch1 program 65 (alto sax) with two notes, ch2 program 0 with one note, drums ch10 program 0
  const track = [
    0, 0xc0, 65, 0, 0xc1, 0, 0, 0xc9, 0,
    0, 0x90, 60, 100, 0x60, 0x80, 60, 0,
    0, 0x90, 62, 100, 0x60, 0x80, 62, 0,
    0, 0x91, 48, 100, 0x60, 0x81, 48, 0,
    0, 0xc0, 20, 0, // a later change does not replace the first program
  ];
  const flat = midiToSteps(parseMidi(smf(0, 96, [track])));
  assert.equal(flat.program, 65);
  assert.equal(gmProgramPreset(flat.program).preset.name, GM_PROGRAMS[65].preset);
  assert.equal(midiToSteps(parseMidi(smf(0, 96, [[0, 0x90, 60, 100, 0x60, 0x80, 60, 0]]))).program, null);
});
