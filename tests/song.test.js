import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPattern, Sequencer, STEPS } from '../src/lib/pattern.js';
import {
  addPattern, addSlot, deletePattern, demoSong, duplicatePattern, MAX_PATTERNS, MAX_REPEAT, migrateSaved, moveSlot,
  removeSlot, renamePattern, sanitizeSong, setSlotRepeat, songBars, songFromFlat, timeline,
} from '../src/lib/song.js';
import { patternEvents, timelineEvents } from '../src/lib/render.js';
import { undoShortcut, UndoStack } from '../src/lib/history.js';

/** A song with two patterns: A (kick on every beat + a note) and B (snare + a different note), arranged A x2, B. */
function twoPatternSong() {
  return sanitizeSong({
    bpm: 120,
    patterns: [
      { id: 1, name: 'A', notes: [{ note: 60, start: 0, len: 4, vel: 100 }], drums: [0, 16, 32, 48].map((step) => ({ note: 36, step, vel: 110 })) },
      { id: 2, name: 'B', notes: [{ note: 67, start: 8, len: 2, vel: 80 }], drums: [{ note: 38, step: 4, vel: 90 }, { note: 42, step: 63, vel: 70 }] },
    ],
    arrangement: [{ pattern: 1, repeat: 2 }, { pattern: 2, repeat: 1 }],
  });
}

// ---- model / migration -------------------------------------------------------------------

test('old saved state: the single pattern becomes pattern A, played once', () => {
  const old = { pattern: { bpm: 97, notes: [{ note: 60, start: 3, len: 2, vel: 90 }], drums: [{ note: 36, step: 0, vel: 120 }], melodic: 'phys' } };
  const song = migrateSaved(old);
  assert.equal(song.bpm, 97);
  assert.equal(song.melodic, 'phys');
  assert.equal(song.patterns.length, 1);
  assert.equal(song.patterns[0].name, 'A');
  assert.deepEqual(song.patterns[0].notes, old.pattern.notes);
  assert.deepEqual(song.patterns[0].drums, old.pattern.drums);
  assert.deepEqual(song.arrangement, [{ pattern: song.patterns[0].id, repeat: 1 }]);
  // nothing saved: the demo; a new-style save round-trips
  assert.deepEqual(migrateSaved(null).patterns[0].notes, demoPattern().notes);
  const s = twoPatternSong();
  assert.deepEqual(migrateSaved(JSON.parse(JSON.stringify({ song: s }))), s);
});

test('sanitizeSong drops / clamps malformed data', () => {
  const s = sanitizeSong({
    bpm: 9999,
    melodic: 'evil',
    current: 50,
    patterns: [
      null,
      { id: 7, name: '\u0000  Verse with a much too long name for the chip  ', notes: [
        { note: 60, start: 0, len: 999, vel: 500 }, { note: 200, start: 0, len: 1, vel: 1 }, { note: 60, start: -1, len: 1, vel: 1 },
        { note: 'x', start: 0 }, 'junk', { note: 61.6, start: 62.2, len: 0, vel: 0 },
      ], drums: [{ note: 36, step: 64, vel: 1 }, { note: 36, step: 1, vel: 1 }, { note: 36, step: 1, vel: 50 }] },
      { id: 7, name: 5, notes: 'nope', drums: {} },
    ],
    arrangement: [{ pattern: 7, repeat: 100 }, { pattern: 99, repeat: 1 }, { pattern: '7' }, null],
  });
  assert.equal(s.bpm, 240);
  assert.equal(s.melodic, 'synth');
  assert.equal(s.patterns.length, 2);
  assert.equal(s.current, 1);
  const [a, b] = s.patterns;
  assert.equal(a.name, 'Verse with a much too lo', 'control chars stripped, trimmed, 24 chars max');
  assert.deepEqual(a.notes, [{ note: 60, start: 0, len: STEPS, vel: 127 }, { note: 62, start: 62, len: 1, vel: 1 }]);
  assert.deepEqual(a.drums, [{ note: 36, step: 1, vel: 1 }], 'out-of-range step and duplicate hit dropped');
  assert.equal(b.name, 'B');
  assert.deepEqual([b.notes, b.drums], [[], []]);
  // duplicate raw id: slots point at the first pattern with it; unknown ids dropped; repeat clamped
  assert.deepEqual(s.arrangement, [{ pattern: a.id, repeat: MAX_REPEAT }]);
  assert.equal(sanitizeSong(undefined).patterns.length, 1);
});

test('pattern / arrangement edits', () => {
  const s = demoSong();
  assert.equal(addPattern(s), 1);
  assert.equal(s.patterns[1].name, 'B');
  assert.deepEqual([s.patterns[1].notes, s.patterns[1].drums], [[], []]);
  s.current = 0;
  assert.equal(duplicatePattern(s, 0), 1);
  assert.equal(s.patterns[1].name, 'C');
  assert.deepEqual(s.patterns[1].notes, s.patterns[0].notes);
  s.patterns[1].notes[0].vel = 1;
  assert.notEqual(s.patterns[0].notes[0].vel, 1, 'the copy is deep');
  renamePattern(s, 1, '  Chorus ');
  assert.equal(s.patterns[1].name, 'Chorus');
  addSlot(s, 1);
  addSlot(s, 2);
  addSlot(s, 1, 0);
  setSlotRepeat(s, 1, 3);
  assert.deepEqual(s.arrangement.map((x) => [s.patterns.find((p) => p.id === x.pattern).name, x.repeat]), [['Chorus', 1], ['A', 3], ['Chorus', 1], ['B', 1]]);
  assert.equal(songBars(s), 6 * 4);
  moveSlot(s, 3, -1);
  assert.equal(s.arrangement[2].pattern, s.patterns[2].id);
  removeSlot(s, 0);
  // deleting a pattern removes its slots and keeps the selection on a valid pattern
  s.current = 2;
  deletePattern(s, 1);
  assert.deepEqual(s.patterns.map((p) => p.name), ['A', 'B']);
  assert.ok(s.arrangement.every((x) => s.patterns.some((p) => p.id === x.pattern)));
  assert.equal(s.current, 1);
  deletePattern(s, 0);
  assert.equal(deletePattern(s, 0), -1, 'the last pattern stays');
  for (let i = 0; i < MAX_PATTERNS + 3; i++) addPattern(s);
  assert.equal(s.patterns.length, MAX_PATTERNS);
});

test('timeline: pattern mode = the edited pattern, song mode = arrangement with repeats', () => {
  const s = twoPatternSong();
  s.current = 1;
  assert.deepEqual(timeline(s, 'pattern').entries.map((e) => [e.pattern.name, e.slot, e.index]), [['B', -1, 1]]);
  assert.deepEqual(timeline(s, 'song').entries.map((e) => [e.pattern.name, e.slot, e.index]), [['A', 0, 0], ['A', 0, 0], ['B', 1, 1]]);
  s.arrangement = [];
  assert.deepEqual(timeline(s, 'song').entries.map((e) => e.pattern.name), ['B'], 'empty arrangement falls back');
});

// ---- sequencer timing ----------------------------------------------------------------------

/** Engine stand-in: a clock we move by hand, recording what the sequencer sends. */
function fakeEngine(t0 = 0.37) {
  const e = {
    ctx: {}, now: t0, events: [], transports: [],
    get time() { return e.now; },
    noteOn(target, note, vel, time) { e.events.push({ type: 'on', target, note, vel, time }); },
    noteOff(target, note, time) { e.events.push({ type: 'off', target, note, time }); },
    transport(bpm, playing, beat, time) { e.transports.push({ bpm, playing, beat, time }); },
    clear() {},
  };
  return e;
}

function runSequencer(getTimeline, seconds, tickJitter = [0.025, 0.031, 0.019, 0.044]) {
  const eng = fakeEngine();
  const seq = new Sequencer(eng, getTimeline, () => {}, () => {});
  const origSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // drive ticks by hand
  try {
    seq.start();
  } finally {
    globalThis.setInterval = origSetInterval;
  }
  const t0 = seq.anchorTime;
  let i = 0;
  while (eng.now < t0 + seconds) {
    eng.now += tickJitter[i++ % tickJitter.length];
    seq.tick();
  }
  seq.playing = false;
  return { eng, seq, t0 };
}

test('sequencer: song mode crosses pattern boundaries on the exact step times', () => {
  const s = twoPatternSong();
  const stepDur = 60 / s.bpm / 4;
  const songSteps = 3 * STEPS;
  const { eng, t0 } = runSequencer(() => timeline(s, 'song'), (songSteps + STEPS) * stepDur);
  const drums = eng.events.filter((e) => e.target === 'drums');
  // expected: A, A, B, then the song loops to A
  const expected = [];
  ['A', 'A', 'B', 'A'].forEach((name, k) => {
    for (const h of s.patterns.find((p) => p.name === name).drums) expected.push({ note: h.note, step: k * STEPS + h.step });
  });
  expected.sort((a, b) => a.step - b.step);
  const got = drums.filter((e) => e.time < t0 + (songSteps + STEPS) * stepDur - 1e-9);
  assert.equal(got.length, expected.length);
  got.forEach((e, i) => {
    assert.equal(e.note, expected[i].note);
    // same expression as a single long pattern would use: no drift at the boundaries
    assert.ok(Math.abs(e.time - (t0 + expected[i].step * stepDur)) < 1e-12, `hit ${i} at ${e.time}`);
  });
  // B's snare is exactly 2 patterns + 4 steps in; the closed hat on B's last step is right before the loop
  assert.ok(got.some((e) => e.note === 38 && Math.abs(e.time - (t0 + (2 * STEPS + 4) * stepDur)) < 1e-12));
  assert.ok(got.some((e) => e.note === 42 && Math.abs(e.time - (t0 + (3 * STEPS - 1) * stepDur)) < 1e-12));
  // melodic note of pattern B and its release
  const on = eng.events.find((e) => e.type === 'on' && e.target === 'synth' && e.note === 67);
  assert.ok(Math.abs(on.time - (t0 + (2 * STEPS + 8) * stepDur)) < 1e-12);
  const off = eng.events.find((e) => e.type === 'off' && e.note === 67);
  assert.ok(Math.abs(off.time - (on.time + 2 * stepDur - 0.002)) < 1e-12);
  // transport: beat position restarts at the top of each loop of the song, counts on across patterns
  const beats = eng.transports.filter((t) => t.playing).map((t) => t.beat);
  assert.deepEqual(beats.slice(0, 4), [0, 16, 32, 0]);
});

test('sequencer: one-entry timeline (pattern loop) matches the old behaviour; live edits / mode switch apply', () => {
  const s = twoPatternSong();
  const stepDur = 60 / s.bpm / 4;
  let mode = 'pattern';
  const eng = fakeEngine();
  const seq = new Sequencer(eng, () => timeline(s, mode), () => {});
  const orig = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  seq.start();
  globalThis.setInterval = orig;
  const t0 = seq.anchorTime;
  const advance = (steps) => {
    const until = t0 + steps * stepDur;
    while (eng.now < until) {
      eng.now += 0.025;
      seq.tick();
    }
  };
  advance(2 * STEPS);
  const kicks = eng.events.filter((e) => e.note === 36).map((e) => Math.round((e.time - t0) / stepDur));
  assert.deepEqual(kicks.slice(0, 8), [0, 16, 32, 48, 64, 80, 96, 112], 'pattern A loops');
  // playhead position: index / step of what is audible now
  eng.now = t0 + (STEPS + 5.5) * stepDur;
  assert.deepEqual([seq.position().index, seq.position().step], [0, 5]);
  // switch to pattern B (edited pattern) mid-play: the next loop plays B
  s.current = 1;
  const before = eng.events.length;
  advance(4 * STEPS);
  assert.ok(eng.events.slice(before).some((e) => e.note === 38), 'B is heard after switching');
  // song mode on the fly: entry index wraps into the arrangement
  mode = 'song';
  advance(8 * STEPS);
  assert.ok(seq.entry < 3);
});

test('offline render events = sequencer timing across pattern boundaries', () => {
  const s = twoPatternSong();
  const sr = 48000;
  const stepDur = 60 / s.bpm / 4;
  const tl = timeline(s, 'song');
  const { ev, length } = timelineEvents(tl, sr, 2);
  assert.equal(length, Math.round(2 * 3 * STEPS * stepDur * sr));
  const snare = ev.drums.filter((e) => e[2] === 38).map((e) => e[0]);
  assert.deepEqual(snare, [2 * STEPS + 4, 5 * STEPS + 4].map((st) => Math.round(st * stepDur * sr)));
  assert.equal(ev.synth.filter((e) => e[1] === 0x90).length, 2 * 3);
  // a single pattern still renders exactly as before (patternEvents = one-entry timeline)
  const p = demoPattern();
  const old = patternEvents(p, sr, 2);
  const viaTimeline = timelineEvents({ bpm: p.bpm, melodic: 'synth', entries: [{ pattern: p, slot: -1, index: 0 }] }, sr, 2);
  assert.deepEqual(old, viaTimeline);
});

test('songFromFlat: splits into 4-bar patterns, shares identical ones, counts repeats', () => {
  const notes = [];
  const drums = [];
  // bars 1-8: same 4-bar riff twice; bars 9-12: different; bars 13-16 empty then a hit in bar 17
  for (const base of [0, STEPS]) {
    notes.push({ note: 60, start: base, len: 4, vel: 100 });
    drums.push({ note: 36, step: base, vel: 100 });
  }
  notes.push({ note: 64, start: 2 * STEPS + 60, len: 10, vel: 90 }); // crosses the boundary: cut
  drums.push({ note: 42, step: 4 * STEPS + 1, vel: 80 });
  const { song, truncated } = songFromFlat({ bpm: 100, notes, drums });
  assert.equal(truncated, false);
  assert.deepEqual(song.patterns.map((p) => p.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(song.arrangement.map((a) => [a.pattern, a.repeat]), [[1, 2], [2, 1], [3, 1], [4, 1]]);
  assert.deepEqual(song.patterns[1].notes, [{ note: 64, start: 60, len: 4, vel: 90 }]);
  assert.deepEqual(song.patterns[2], { id: 3, name: 'C', notes: [], drums: [] });
});

// ---- undo ------------------------------------------------------------------------------------

test('undo stack: record / undo / redo, gestures coalesce, no-op gestures add nothing', () => {
  const h = new UndoStack(3);
  let state = { n: [1] };
  const edit = (fn) => {
    h.record(state);
    state = structuredClone(state);
    fn(state);
  };
  edit((s) => s.n.push(2));
  edit((s) => s.n.push(3));
  assert.ok(h.canUndo && !h.canRedo);
  state = h.undo(state);
  assert.deepEqual(state.n, [1, 2]);
  state = h.redo(state);
  assert.deepEqual(state.n, [1, 2, 3]);
  // a drag of many moves = one step
  h.begin(state);
  for (let i = 4; i < 10; i++) state.n.push(i);
  h.begin(state); // nested begin keeps the first snapshot
  assert.equal(h.commit(state), true);
  state = h.undo(state);
  assert.deepEqual(state.n, [1, 2, 3]);
  assert.ok(h.canRedo);
  // a tap that changed nothing
  h.begin(state);
  assert.equal(h.commit(state), false);
  assert.ok(h.canRedo, 'a no-op gesture keeps the redo list');
  // a new edit clears redo
  edit((s) => s.n.push(99));
  assert.ok(!h.canRedo);
  // limit
  for (let i = 0; i < 10; i++) edit((s) => s.n.push(i));
  assert.equal(h.undoList.length, 3);
  let undos = 0;
  while (h.canUndo) {
    state = h.undo(state);
    undos++;
  }
  assert.equal(undos, 3);
  assert.equal(h.undo(state), null);
  // undo / redo hand out fresh copies: changing one doesn't touch the stored history
  const a = h.redo(state);
  const stored = h.undoList.at(-1);
  a.n.push('mutated');
  assert.equal(h.undoList.at(-1), stored);
});

test('undo shortcuts', () => {
  const k = (o) => undoShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: '', code: '', ...o });
  assert.equal(k({ ctrlKey: true, key: 'z', code: 'KeyZ' }), 'undo');
  assert.equal(k({ metaKey: true, key: 'z', code: 'KeyZ' }), 'undo');
  assert.equal(k({ ctrlKey: true, shiftKey: true, key: 'Z', code: 'KeyZ' }), 'redo');
  assert.equal(k({ ctrlKey: true, key: 'y', code: 'KeyY' }), 'redo');
  assert.equal(k({ key: 'z', code: 'KeyZ' }), null);
  assert.equal(k({ ctrlKey: true, key: 'c', code: 'KeyC' }), null);
  assert.equal(k({ ctrlKey: true, altKey: true, key: 'z', code: 'KeyZ' }), null);
});
