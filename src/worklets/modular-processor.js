import { defaultModularPatch, modular_all_notes_off, modular_init, modular_meter_enable, modular_meter_snapshot, modular_midi, modular_render, modular_set_patch } from '../dsp/modular.js';
import { registerAmiProcessor } from './processor-base.js';

registerAmiProcessor('amisynth-modular', {
  defaults: {},
  init: modular_init,
  update() {},
  midi: modular_midi,
  render: modular_render,
  panic: modular_all_notes_off,
  snapshot: modular_meter_snapshot,
  visualize: modular_meter_enable,
  vizInterval: Math.max(1, Math.round(sampleRate / 128 / 24)),
  message(s, msg) {
    if (msg.type === 'patch') {
      try { modular_set_patch(s, msg.patch || defaultModularPatch()); }
      catch (e) { console.warn('[AmiSynth Modular] invalid patch', e); }
    }
  },
});
