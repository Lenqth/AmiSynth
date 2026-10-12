// Every built-in preset sits at a common loudness, so switching genre / preset does not change the
// level by several dB (it used to range from -8 to -28 LUFS on the same phrase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness } from '../src/lib/loudness.js';
import { allPresetLoudness, TARGET_LUFS } from '../scripts/preset-loudness.js';
import { parseScale, scaleToScala } from '../src/lib/tuning.js';

test('LUFS meter: a full-scale 997 Hz sine in one channel reads -3.01 LUFS (BS.1770)', () => {
  const sr = 48000;
  const l = new Float64Array(sr * 3);
  const r = new Float64Array(sr * 3);
  for (let i = 0; i < l.length; i++) l[i] = Math.sin((2 * Math.PI * 997 * i) / sr);
  assert.ok(Math.abs(integratedLoudness(l, r, sr) + 3.01) < 0.02);
  assert.equal(integratedLoudness(r, r, sr), -Infinity);
});

test(`every built-in preset plays its test phrase at ${TARGET_LUFS} LUFS (+/- 1 LU)`, () => {
  const off = allPresetLoudness().filter((r) => Math.abs(r.lufs - TARGET_LUFS) > 1);
  assert.deepEqual(off.map((r) => `${r.kind}/${r.name}: ${r.lufs.toFixed(1)}`), [], 'run node scripts/preset-loudness.js');
});

test('tuning.txt export round-trips through the Scala parser (EDO and custom scales)', () => {
  assert.deepEqual(parseScale(scaleToScala(null, 5, 1200)).cents, [240, 480, 720, 960, 1200]);
  const just = { name: 'Just', cents: [111.731285, 203.910002, 386.313714, 498.044999, 701.955001, 1200] };
  assert.deepEqual(parseScale(scaleToScala(just, 12, 1200)).cents, just.cents);
});
