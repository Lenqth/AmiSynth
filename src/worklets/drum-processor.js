import { defaultValues, DRUM_PARAMS } from '../dsp/params.js';
import { drums_init, drums_note_on, drums_render, drums_update } from '../dsp/drums.js';
import { registerAmiProcessor } from './processor-base.js';

/** Drums only react to note-on (one-shot voices, note-off ignored like most drum machines). */
function drums_midi(d, status, d1, d2) {
  if ((status & 0xf0) === 0x90 && d2 > 0) drums_note_on(d, d1, d2);
}

registerAmiProcessor('amisynth-drums', {
  defaults: defaultValues(DRUM_PARAMS),
  init: drums_init,
  update: drums_update,
  midi: drums_midi,
  render: drums_render,
  panic() {},
});
