// Main-thread side of the audio engine. Only creates the AudioContext and three
// AudioWorkletNodes (synth, drums, physical); all DSP happens in the worklets (no built-in Web Audio DSP
// nodes are used for sound — an AnalyserNode is tapped for the scope only).

import synthUrl from '../worklets/synth-processor.js?worker&url';
import drumUrl from '../worklets/drum-processor.js?worker&url';
import physUrl from '../worklets/phys-processor.js?worker&url';

export class AudioEngine {
  /** @type {AudioContext | null} */ ctx = null;
  /** @type {AudioWorkletNode | null} */ synth = null;
  /** @type {AudioWorkletNode | null} */ drums = null;
  /** @type {AudioWorkletNode | null} */ phys = null;
  /** @type {((data:any)=>void) | null} */ onPhysSnapshot = null;
  /** @type {AnalyserNode | null} */ analyser = null;

  /** Must be called from a user gesture (autoplay policy). */
  async start() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await Promise.all([synthUrl, drumUrl, physUrl].map((u) => ctx.audioWorklet.addModule(u)));
    const opts = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
    this.synth = new AudioWorkletNode(ctx, 'amisynth-synth', opts);
    this.drums = new AudioWorkletNode(ctx, 'amisynth-drums', opts);
    this.phys = new AudioWorkletNode(ctx, 'amisynth-phys', opts);
    this.phys.port.onmessage = (e) => {
      if (e.data?.type === 'snapshot') this.onPhysSnapshot?.(e.data.data);
    };
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    for (const node of [this.synth, this.drums, this.phys]) {
      node.connect(ctx.destination);
      node.connect(this.analyser);
    }
    this.ctx = ctx;
    await ctx.resume();
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** @param {'synth'|'drums'|'phys'} target @param {number[]} data MIDI bytes @param {number} [time] AudioContext time */
  midi(target, data, time) {
    this[target]?.port.postMessage({ type: 'midi', data, time });
  }

  noteOn(target, note, velocity = 100, time) {
    this.midi(target, [0x90, note, velocity], time);
  }

  noteOff(target, note, time) {
    this.midi(target, [0x80, note, 0], time);
  }

  setParam(target, id, value) {
    this[target]?.port.postMessage({ type: 'param', id, value });
  }

  setParams(target, values) {
    this[target]?.port.postMessage({ type: 'params', values: { ...values } });
  }

  /** @param {number[] | null} cents Scala-style degrees (last = period) or null for EDO */
  setScale(cents) {
    for (const node of [this.synth, this.phys]) node?.port.postMessage({ type: 'scale', cents: cents ? [...cents] : null });
  }

  /** Ask the physical-model worklet to stream visualisation snapshots (or stop). */
  setPhysViz(on) {
    this.phys?.port.postMessage({ type: 'viz', on });
  }

  /** Drop scheduled events and release all notes. */
  clear() {
    this.synth?.port.postMessage({ type: 'clear' });
    this.drums?.port.postMessage({ type: 'clear' });
    this.phys?.port.postMessage({ type: 'clear' });
  }
}

export const engine = new AudioEngine();
