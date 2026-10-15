import { noteHz } from './tuning.js';
import { tuning_note_cents } from '../dsp/lib.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function tuningMap(tuning, low = 48, high = 84) {
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 127 || high < low) throw new Error('MIDI番号は0〜127、開始≦終了で指定してください');
  return Array.from({ length: high - low + 1 }, (_, i) => {
    const note = low + i;
    return { note, inputLabel: NAMES[note % 12] + (Math.floor(note / 12) - 1),
      stepsFromReference: note - tuning.ref_note, centsFromReference: tuning_note_cents(tuning, note), predictedHz: noteHz(tuning, note) };
  });
}

/** Preserve a 12-TET A4=440 pitch as closely as possible on the current 0..127 key map. */
export function map12TetNotes(notes, tuning) {
  const table = tuningMap(tuning, 0, 127);
  return notes.map(source => {
    if (!Number.isInteger(source) || source < 0 || source > 127) throw new Error('入力は12平均律のMIDI番号0〜127です');
    const hz = 440 * 2 ** ((source - 69) / 12);
    if (hz < table[0].predictedHz * (1 - 1e-12) || hz > table[127].predictedHz * (1 + 1e-12)) throw new Error(`元のMIDI ${source}は現在の音律の0〜127鍵に収まりません`);
    const best = table.reduce((a, b) => Math.abs(Math.log2(b.predictedHz / hz)) < Math.abs(Math.log2(a.predictedHz / hz)) - 1e-12 ? b : a);
    return { sourceNote: source, targetNote: best.note, sourceHz: hz, predictedHz: best.predictedHz,
      errorCents: 1200 * Math.log2(best.predictedHz / hz) };
  });
}
