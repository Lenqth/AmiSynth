import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GM_PROGRAMS, gmProgramPreset } from '../src/presets/gm.js';

test('every GM Level 1 program maps to an existing preset', () => {
  assert.equal(GM_PROGRAMS.length, 128);
  for (let p = 0; p < 128; p++) {
    const r = gmProgramPreset(p);
    assert.ok(r, `program ${p} ${GM_PROGRAMS[p].name} -> missing preset ${GM_PROGRAMS[p].preset}`);
    assert.equal(r.kind, GM_PROGRAMS[p].kind);
  }
  assert.equal(gmProgramPreset(128), null);
});
