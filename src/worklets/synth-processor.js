import { defaultValues, SYNTH_PARAMS } from '../dsp/params.js';
import { synth_all_notes_off, synth_init, synth_render, synth_set_scale, synth_transport, synth_update } from '../dsp/synth.js';
import { synth_midi } from '../dsp/midi.js';
import { registerAmiProcessor } from './processor-base.js';

registerAmiProcessor('amisynth-synth', {
  defaults: defaultValues(SYNTH_PARAMS),
  init: synth_init,
  update: synth_update,
  midi: synth_midi,
  render: synth_render,
  panic: synth_all_notes_off,
  transport: synth_transport,
  message(s, msg) {
    if (msg.type === 'scale') synth_set_scale(s, msg.cents || [], msg.cents ? msg.cents.length : 0);
  },
});
