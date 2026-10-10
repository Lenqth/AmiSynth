// Main-thread side of the audio engine. Only creates the AudioContext and two
// AudioWorkletNodes; all DSP happens in the worklets (no built-in Web Audio DSP
// nodes are used for sound — an AnalyserNode is tapped for the scope only).

import synthUrl from '../worklets/synth-processor.js?worker&url';
import drumUrl from '../worklets/drum-processor.js?worker&url';

export class AudioEngine {
  /** @type {AudioContext | null} */ ctx = null;
  /** @type {AudioWorkletNode | null} */ synth = null;
  /** @type {AudioWorkletNode | null} */ drums = null;
  /** @type {AnalyserNode | null} */ analyser = null;

  /** Must be called from a user gesture (autoplay policy). */
  async start() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await Promise.all([ctx.audioWorklet.addModule(synthUrl), ctx.audioWorklet.addModule(drumUrl)]);
    const opts = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
    this.synth = new AudioWorkletNode(ctx, 'amisynth-synth', opts);
    this.drums = new AudioWorkletNode(ctx, 'amisynth-drums', opts);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    for (const node of [this.synth, this.drums]) {
      node.connect(ctx.destination);
      node.connect(this.analyser);
    }
    this.ctx = ctx;
    await ctx.resume();
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** @param {'synth'|'drums'} target @param {number[]} data MIDI bytes @param {number} [time] AudioContext time */
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
    this.synth?.port.postMessage({ type: 'scale', cents: cents ? [...cents] : null });
  }

  /** Drop scheduled events and release all notes. */
  clear() {
    this.synth?.port.postMessage({ type: 'clear' });
    this.drums?.port.postMessage({ type: 'clear' });
  }
}

export const engine = new AudioEngine();
