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
