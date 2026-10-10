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

test('fitNotes keeps keys at least the minimum width and never ends on a black key', async () => {
  const { fitNotes } = await import('../src/lib/keysize.js');
  const black = (n) => [1, 3, 6, 8, 10].includes(n % 12);
  const notes = fitNotes(48, 300, 44, black); // 6 white keys fit
  assert.equal(notes.filter((n) => !black(n)).length, 6);
  assert.ok(!black(notes[notes.length - 1]));
  assert.equal(fitNotes(48, 100, 44, black).filter((n) => !black(n)).length, 5); // minimum 5
  assert.equal(fitNotes(48, 5000, 34, black).filter((n) => !black(n)).length, 29); // capped
  assert.equal(fitNotes(120, 5000, 34, black).at(-1), 127); // stops at MIDI 127
  assert.equal(fitNotes(41, 220, 44, () => false).length, 5); // linear (EDO) layout
});
