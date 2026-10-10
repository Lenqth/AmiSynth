import { defaultValues, PHYS_PARAMS } from '../dsp/params.js';
import { phys_all_notes_off, phys_init, phys_render, phys_set_scale, phys_snapshot, phys_update } from '../dsp/phys.js';
import { phys_midi } from '../dsp/midi.js';
import { registerAmiProcessor } from './processor-base.js';

registerAmiProcessor('amisynth-phys', {
  defaults: defaultValues(PHYS_PARAMS),
  init: phys_init,
  update: phys_update,
  midi: phys_midi,
  render: phys_render,
  panic: phys_all_notes_off,
  snapshot: (s) => phys_snapshot(s),
  message(s, msg) {
    if (msg.type === 'scale') phys_set_scale(s, msg.cents || [], msg.cents ? msg.cents.length : 0);
  },
});
