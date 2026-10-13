// Generic AudioWorklet wrapper around an AmiSynth DSP core.
//
// The main thread talks to the processor only through plain MIDI bytes and
// parameter values, i.e. exactly what a JSFX receives from REAPER:
//   { type: 'midi', data: [status, d1, d2], time?: <AudioContext seconds> }
//   { type: 'param', id, value }  /  { type: 'params', values: {...} }
//   { type: 'transport', bpm, playing, beat, time? }  host tempo / beat position (JSFX tempo,
//                                 play_state, beat_position), applied at its sample like MIDI
//   { type: 'clear' }             drop scheduled events + all notes off
//   { type: 'viz', on: bool }     (optional) post core.snapshot() to the main thread
//                                 every few blocks while on; costs nothing when off
// Timed MIDI events are applied with sample accuracy (like JSFX midirecv offsets).

/**
 * @param {string} name processor name
 * @param {{init:Function, update:Function, midi:Function, render:Function, message?:Function, panic:Function,
 *   transport?:Function, defaults:Record<string,number>}} core
 */
export function registerAmiProcessor(name, core) {
  class AmiProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.state = {};
      this.params = { ...core.defaults };
      core.init(this.state, sampleRate);
      core.update(this.state, this.params);
      this.queue = []; // sorted by frame
      this.dirty = false;
      this.vizOn = false;
      this.vizCount = 0;
      this.port.onmessage = (e) => this.onMessage(e.data);
    }

    onMessage(msg) {
      switch (msg.type) {
        case 'param':
          this.params[msg.id] = msg.value;
          this.dirty = true;
          break;
        case 'params':
          Object.assign(this.params, msg.values);
          this.dirty = true;
          break;
        case 'midi':
          this.enqueue(msg.time, { data: msg.data });
          break;
        case 'transport':
          if (core.transport) this.enqueue(msg.time, { transport: [msg.bpm, msg.playing ? 1 : 0, msg.beat ?? 0] });
          break;
        case 'viz':
          this.vizOn = !!msg.on && typeof core.snapshot === 'function';
          break;
        case 'clear':
          this.queue.length = 0;
          core.panic(this.state);
          break;
        default:
          if (core.message) core.message(this.state, msg);
      }
    }

    /** @param {number | undefined} time AudioContext seconds (undefined = now) */
    enqueue(time, ev) {
      const frame = time == null ? 0 : Math.round(time * sampleRate);
      ev.frame = frame;
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].frame > frame) i--;
      this.queue.splice(i, 0, ev);
    }

    process(_inputs, outputs) {
      if (this.dirty) {
        this.dirty = false;
        core.update(this.state, this.params);
      }
      const out = outputs[0];
      const L = out[0];
      const R = out[1] || out[0];
      const n = L.length;
      const s = this.state;
      const q = this.queue;
      for (let i = 0; i < n; i++) {
        const frame = currentFrame + i;
        while (q.length > 0 && q[0].frame <= frame) {
          const ev = q.shift();
          if (ev.transport) core.transport(s, ev.transport[0], ev.transport[1], ev.transport[2]);
          else core.midi(s, ev.data[0], ev.data[1], ev.data[2]);
        }
        core.render(s);
        L[i] = s.out_l;
        R[i] = s.out_r;
      }
      // ~60 snapshots/s at 48 kHz (every 6 blocks of 128 samples)
      if (this.vizOn && ++this.vizCount >= 6) {
        this.vizCount = 0;
        this.port.postMessage({ type: 'snapshot', data: core.snapshot(s) });
      }
      return true;
    }
  }
  registerProcessor(name, AmiProcessor);
}
