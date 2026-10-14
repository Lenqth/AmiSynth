// Undo / redo of song edits (piano roll, drum steps, patterns, arrangement) as whole-song
// snapshots. A song is small (a few thousand numbers at most), so JSON snapshots are simple,
// cheap and can never alias the live (reactive) state.
//
//   one-shot edit:   history.record(before); ...change...
//   gesture (drag):  history.begin(before) on pointer down, history.commit(after) on pointer up
//                    -> the whole drag / paint stroke is one undo step (none if nothing changed)

const ser = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

export class UndoStack {
  /** @param {number} [limit] steps kept */
  constructor(limit = 200) {
    this.limit = limit;
    /** @type {string[]} */ this.undoList = [];
    /** @type {string[]} */ this.redoList = [];
    /** @type {string | null} */ this.pending = null;
  }

  get canUndo() {
    return this.undoList.length > 0;
  }

  get canRedo() {
    return this.redoList.length > 0;
  }

  /** Store the state from before an edit (clears the redo list). */
  record(before) {
    this.undoList.push(ser(before));
    if (this.undoList.length > this.limit) this.undoList.splice(0, this.undoList.length - this.limit);
    this.redoList = [];
  }

  /** Start a gesture: remember the state before it (an already open gesture is kept). */
  begin(before) {
    if (this.pending === null) this.pending = ser(before);
  }

  /** End a gesture: one undo step if the state changed during it. @returns {boolean} recorded */
  commit(after) {
    const before = this.pending;
    this.pending = null;
    if (before === null || before === ser(after)) return false;
    this.record(before);
    return true;
  }

  /** @returns {any | null} the state to restore, or null if there is nothing to undo */
  undo(current) {
    this.commit(current);
    if (!this.undoList.length) return null;
    this.redoList.push(ser(current));
    return JSON.parse(/** @type {string} */ (this.undoList.pop()));
  }

  /** @returns {any | null} the state to restore, or null if there is nothing to redo */
  redo(current) {
    this.commit(current);
    if (!this.redoList.length) return null;
    this.undoList.push(ser(current));
    return JSON.parse(/** @type {string} */ (this.redoList.pop()));
  }

  clear() {
    this.undoList = [];
    this.redoList = [];
    this.pending = null;
  }
}

/** Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo. @returns {'undo'|'redo'|null} */
export function undoShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' ? 'z' : e.code === 'KeyY' || e.key === 'y' || e.key === 'Y' ? 'y' : '';
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}
