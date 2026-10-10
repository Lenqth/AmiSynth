import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPattern, pianoDemoPattern, STEPS } from '../src/lib/pattern.js';

for (const [name, make] of [['demo', demoPattern], ['piano demo', pianoDemoPattern]]) {
  test(`${name}: notes fit the 4 bars and have valid velocities`, () => {
    const p = make();
    assert.ok(p.notes.length > 0);
    for (const n of p.notes) {
      assert.ok(n.start >= 0 && n.start + n.len <= STEPS, `${name}: note ${n.note} at ${n.start}+${n.len}`);
      assert.ok(Number.isInteger(n.vel) && n.vel >= 1 && n.vel <= 127, `${name}: velocity ${n.vel}`);
    }
  });
}

test('piano demo: plays the physical instrument, rises from pp to ff and falls back', () => {
  const p = pianoDemoPattern();
  assert.equal(p.melodic, 'phys');
  const at = (lo, hi) => {
    const v = p.notes.filter((n) => n.start >= lo && n.start < hi).map((n) => n.vel);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const start = at(0, 8);
  const peak = at(28, 40);
  const end = at(56, 64);
  assert.ok(peak > start + 30 && peak > end + 30, `pp ${start.toFixed(0)} -> ff ${peak.toFixed(0)} -> pp ${end.toFixed(0)}`);
  assert.ok(Math.max(...p.notes.map((n) => n.vel)) - Math.min(...p.notes.map((n) => n.vel)) > 60);
});
