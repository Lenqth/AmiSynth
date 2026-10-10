import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeToOffset, eventCode, isImeEvent } from '../src/lib/pckeys.js';

test('eventCode prefers code and falls back to the produced character', () => {
  assert.equal(eventCode({ code: 'KeyZ', key: 'z' }), 'KeyZ');
  assert.equal(eventCode({ code: 'KeyZ', key: 'Z' }), 'KeyZ'); // Shift does not matter
  assert.equal(eventCode({ code: '', key: 'c' }), 'KeyC');
  assert.equal(eventCode({ code: 'Unidentified', key: 'C' }), 'KeyC');
  assert.equal(eventCode({ code: '', key: '2' }), 'Digit2');
  assert.equal(eventCode({ code: '', key: ',' }), 'Comma');
  assert.equal(eventCode({ code: '', key: 'Process', keyCode: 229 }), null);
});

test('isImeEvent detects IME-processed keys', () => {
  assert.equal(isImeEvent({ key: 'Process', keyCode: 229 }), true);
  assert.equal(isImeEvent({ key: 'a', keyCode: 65, isComposing: true }), true);
  assert.equal(isImeEvent({ key: 'a', keyCode: 65 }), false);
});

test('fallback codes map to the same notes as real codes', () => {
  for (const ch of ['z', 's', 'x', ',', 'l', '.', ';', '/', 'q', '2', 'w', 'p']) {
    const code = eventCode({ code: '', key: ch });
    assert.notEqual(codeToOffset(code, 12), null, ch);
  }
});
