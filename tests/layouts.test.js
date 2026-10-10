import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoCells, isoSteps, stepsFor } from '../src/lib/layouts.js';

const edo = (n, period = 1200) => ({ size: n, period_cents: period });

test('presets resolve to the classic step sizes in 12-EDO', () => {
  const t = edo(12);
  assert.deepEqual(isoSteps('hex', 'wicki', t, {}), { right: 2, up: 7 });
  assert.deepEqual(isoSteps('hex', 'harmonic', t, {}), { right: 1, up: 4 });
  assert.deepEqual(isoSteps('hex', 'janko', t, {}), { right: 2, up: 1 });
  assert.deepEqual(isoSteps('grid', 'fourths', t, {}), { right: 1, up: 5 });
  assert.deepEqual(isoSteps('grid', 'fifths', t, {}), { right: 1, up: 7 });
  assert.deepEqual(isoSteps('grid', 'custom', t, { right: 3, up: -2 }), { right: 3, up: -2 });
});

test('presets follow other tunings', () => {
  assert.deepEqual(isoSteps('hex', 'wicki', edo(19), {}), { right: 3, up: 11 });
  assert.deepEqual(isoSteps('hex', 'wicki', edo(31), {}), { right: 5, up: 18 });
  assert.equal(stepsFor(edo(5), 111.73), 1); // never 0
});

test('hex neighbours keep the same intervals on even and odd rows', () => {
  const right = 2;
  const up = 7;
  const cells = isoCells({ cols: 8, rows: 4, base: 48, right, up, hex: true });
  const at = (c, r) => cells.find((x) => x.c === c && x.r === r).note;
  assert.equal(at(0, 0), 48);
  for (const r of [0, 1, 2]) {
    for (let c = 1; c < 7; c++) {
      const upRight = r & 1 ? at(c + 1, r + 1) : at(c, r + 1);
      const upLeft = r & 1 ? at(c, r + 1) : at(c - 1, r + 1);
      assert.equal(at(c + 1, r) - at(c, r), right);
      assert.equal(upRight - at(c, r), up, `upper-right r${r}`);
      assert.equal(upLeft - at(c, r), up - right, `upper-left r${r}`);
    }
  }
});

test('grid rows stack by the up interval', () => {
  const cells = isoCells({ cols: 5, rows: 3, base: 40, right: 1, up: 5, hex: false });
  assert.deepEqual(cells.filter((x) => x.c === 0).map((x) => x.note), [40, 45, 50]);
});
