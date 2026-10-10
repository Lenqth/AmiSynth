// Generic AudioWorklet wrapper around an AmiSynth DSP core.
//
// The main thread talks to the processor only through plain MIDI bytes and
// parameter values, i.e. exactly what a JSFX receives from REAPER:
//   { type: 'midi', data: [status, d1, d2], time?: <AudioContext seconds> }
//   { type: 'param', id, value }  /  { type: 'params', values: {...} }
//   { type: 'clear' }             drop scheduled events + all notes off
// Timed MIDI events are applied with sample accuracy (like JSFX midirecv offsets).

/**
 * @param {string} name processor name
 * @param {{init:Function, update:Function, midi:Function, render:Function, message?:Function, panic:Function, defaults:Record<string,number>}} core
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
        case 'midi': {
          const frame = msg.time == null ? 0 : Math.round(msg.time * sampleRate);
          const ev = { frame, data: msg.data };
          let i = this.queue.length;
          while (i > 0 && this.queue[i - 1].frame > frame) i--;
          this.queue.splice(i, 0, ev);
          break;
        }
        case 'clear':
          this.queue.length = 0;
          core.panic(this.state);
          break;
        default:
          if (core.message) core.message(this.state, msg);
      }
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
          const d = q.shift().data;
          core.midi(s, d[0], d[1], d[2]);
        }
        core.render(s);
        L[i] = s.out_l;
        R[i] = s.out_r;
      }
      return true;
    }
  }
  registerProcessor(name, AmiProcessor);
}
