// Web MIDI input wiring that survives hot-plugging.
//
// The old code re-ran a "bind every input" pass on each `statechange` and assigned
// `input.onmidimessage` on every port, including ones that had just been unplugged.
// Assigning that handler implicitly calls `open()`, which on a disconnected port moves it to
// `pending` and fires another `statechange`, so one unplug could turn into a burst of rebinds
// (and in some browsers a loop) on the main thread. Notes held on the unplugged device were
// also never released.
//
// Here each input is bound once, only while it is `connected`; `statechange` bursts are
// coalesced into one pass; and when a device disappears its held notes / sustain are released.

/**
 * @param {MIDIAccess} access
 * @param {{
 *   onMessage: (data: ArrayLike<number>) => void,
 *   onStatus?: (count: number) => void,
 *   schedule?: (fn: () => void) => void,
 * }} opts
 * @returns {{ sync: () => void, dispose: () => void, bound: () => number }}
 */
export function connectMidiInputs(access, { onMessage, onStatus, schedule = defaultSchedule }) {
  /** @type {Map<string, { input: any, listener: (e: any) => void, notes: Set<number>, sustain: Set<number> }>} */
  const bound = new Map();
  let queued = false;
  let disposed = false;

  function release(entry) {
    // note-offs for whatever this device still holds, then sustain off on the channels it pressed
    for (const key of entry.notes) {
      const ch = key >> 7;
      safe(() => onMessage([0x80 | ch, key & 0x7f, 0]));
    }
    for (const ch of entry.sustain) safe(() => onMessage([0xb0 | ch, 64, 0]));
    entry.notes.clear();
    entry.sustain.clear();
  }

  function unbind(id) {
    const entry = bound.get(id);
    if (!entry) return;
    bound.delete(id);
    try {
      entry.input.removeEventListener?.('midimessage', entry.listener);
    } catch {
      // the port may already be gone
    }
    release(entry);
  }

  function bind(input) {
    const entry = { input, listener: null, notes: new Set(), sustain: new Set() };
    entry.listener = (e) => {
      const data = e?.data;
      if (!data || data.length === 0) return;
      const status = data[0];
      // system messages (clock, active sensing, sysex...) are not used and can arrive very often
      if (status >= 0xf0) return;
      const type = status & 0xf0;
      const ch = status & 0x0f;
      const d1 = data[1] ?? 0;
      const d2 = data[2] ?? 0;
      if (type === 0x90 && d2 > 0) entry.notes.add((ch << 7) | d1);
      else if (type === 0x80 || type === 0x90) entry.notes.delete((ch << 7) | d1);
      else if (type === 0xb0 && d1 === 64) {
        if (d2 >= 64) entry.sustain.add(ch);
        else entry.sustain.delete(ch);
      } else if (type === 0xb0 && (d1 === 120 || d1 === 123)) {
        for (const k of entry.notes) if (k >> 7 === ch) entry.notes.delete(k);
      }
      safe(() => onMessage(data));
    };
    bound.set(input.id, entry);
    input.addEventListener('midimessage', entry.listener);
  }

  function sync() {
    queued = false;
    if (disposed) return;
    const seen = new Set();
    for (const input of access.inputs.values()) {
      if (input.state !== 'connected') continue;
      seen.add(input.id);
      const entry = bound.get(input.id);
      if (entry && entry.input === input) continue;
      if (entry) unbind(input.id);
      bind(input);
    }
    for (const id of [...bound.keys()]) if (!seen.has(id)) unbind(id);
    onStatus?.(bound.size);
  }

  function onStateChange(e) {
    // output ports and connection-only changes (open/pending/closed) do not change our set of inputs
    const port = e?.port;
    if (port && port.type !== 'input') return;
    if (port && port.state === 'connected' && bound.get(port.id)?.input === port) return;
    if (queued || disposed) return;
    queued = true;
    schedule(sync);
  }

  access.addEventListener('statechange', onStateChange);
  sync();

  return {
    sync,
    bound: () => bound.size,
    dispose() {
      disposed = true;
      access.removeEventListener('statechange', onStateChange);
      for (const id of [...bound.keys()]) unbind(id);
    },
  };
}

function defaultSchedule(fn) {
  setTimeout(fn, 0);
}

function safe(fn) {
  try {
    fn();
  } catch (err) {
    console.error(err);
  }
}
