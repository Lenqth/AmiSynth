import { defaultValues, DRUM_PARAMS } from '../dsp/params.js';
import { drums_init, drums_render, drums_update } from '../dsp/drums.js';
import { drums_midi } from '../dsp/midi.js';
import { registerAmiProcessor } from './processor-base.js';

registerAmiProcessor('amisynth-drums', {
  defaults: defaultValues(DRUM_PARAMS),
  init: drums_init,
  update: drums_update,
  midi: drums_midi,
  render: drums_render,
  panic() {},
});
