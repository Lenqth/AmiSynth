// Web MIDI hot-plug handling (src/lib/webmidi.js) against a fake MIDIAccess that mimics the
// Chrome behaviour behind the unplug freeze: adding a listener implicitly opens the port, and
// opening a disconnected port fires another statechange.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectMidiInputs } from '../src/lib/webmidi.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type, e) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeAccess extends FakeTarget {
  constructor() {
    super();
    this.inputs = new Map();
    this.events = 0;
  }
  fire(port) {
    this.events++;
    if (this.events > 1000) throw new Error('statechange storm');
    this.emit('statechange', { port });
  }
  plug(id) {
    const access = this;
    const port = new (class extends FakeTarget {
      addEventListener(type, fn) {
        super.addEventListener(type, fn);
        // implicit open(): a disconnected port goes pending and announces it
        if (type === 'midimessage' && this.state === 'disconnected') {
          this.connection = 'pending';
          access.fire(this);
        } else if (type === 'midimessage') this.connection = 'open';
      }
    })();
    Object.assign(port, { id, type: 'input', state: 'connected', connection: 'closed' });
    this.inputs.set(id, port);
    this.fire(port);
    return port;
  }
  unplug(id) {
    const port = this.inputs.get(id);
    port.state = 'disconnected'; // Chrome keeps disconnected ports in the map
    this.fire(port);
  }
}

function setup() {
  const access = new FakeAccess();
  const queue = [];
  const sent = [];
  const status = [];
  const conn = connectMidiInputs(access, {
    onMessage: (d) => sent.push([...d]),
    onStatus: (n) => status.push(n),
    schedule: (fn) => queue.push(fn),
  });
  const flush = () => {
    let n = 0;
    while (queue.length) {
      if (++n > 100) throw new Error('sync loop');
      queue.shift()();
    }
  };
  return { access, conn, sent, status, flush, queue };
}

test('binds each connected input once and forwards channel messages', () => {
  const { access, conn, sent, flush } = setup();
  const a = access.plug('a');
  flush();
  access.fire(a); // a connection-only change must not rebind
  flush();
  assert.equal(conn.bound(), 1);
  assert.equal(a.count('midimessage'), 1);
  a.emit('midimessage', { data: [0x90, 60, 100] });
  a.emit('midimessage', { data: [0xf8] }); // clock is dropped
  assert.deepEqual(sent, [[0x90, 60, 100]]);
});

test('unplugging releases held notes and sustain without a statechange storm', () => {
  const { access, conn, sent, status, flush } = setup();
  const a = access.plug('a');
  flush();
  a.emit('midimessage', { data: [0x90, 60, 100] });
  a.emit('midimessage', { data: [0x91, 64, 90] });
  a.emit('midimessage', { data: [0x90, 67, 80] });
  a.emit('midimessage', { data: [0x80, 67, 0] });
  a.emit('midimessage', { data: [0xb0, 64, 127] });
  sent.length = 0;
  const before = access.events;
  access.unplug('a');
  flush();
  assert.equal(access.events - before, 1, 'no extra statechange from re-opening a dead port');
  assert.equal(conn.bound(), 0);
  assert.equal(a.count('midimessage'), 0);
  assert.deepEqual(
    sent.sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    [
      [0x80, 60, 0],
      [0x81, 64, 0],
      [0xb0, 64, 0],
    ],
  );
  assert.equal(status.at(-1), 0);
});

test('a burst of statechange events is coalesced into one rescan', () => {
  const { access, status, flush, queue } = setup();
  const n0 = status.length;
  const a = access.plug('a');
  access.plug('b');
  access.fire(a);
  assert.equal(queue.length, 1);
  flush();
  assert.equal(status.length - n0, 1);
  assert.equal(status.at(-1), 2);
});

test('replugging rebinds the device; dispose removes everything', () => {
  const { access, conn, flush } = setup();
  const a = access.plug('a');
  flush();
  access.unplug('a');
  flush();
  a.state = 'connected';
  access.fire(a);
  flush();
  assert.equal(conn.bound(), 1);
  assert.equal(a.count('midimessage'), 1);
  conn.dispose();
  assert.equal(a.count('midimessage'), 0);
  assert.equal(access.count('statechange'), 0);
});
