import { defaultValues, SYNTH_PARAMS } from '../dsp/params.js';
import {
  synth_all_notes_off, synth_init, synth_mod_wheel, synth_note_off, synth_note_on,
  synth_pitch_bend, synth_render, synth_set_scale, synth_sustain_pedal, synth_update,
} from '../dsp/synth.js';
import { registerAmiProcessor } from './processor-base.js';

/** MIDI byte dispatch (JSFX: midirecv loop in @block). */
function synth_midi(s, status, d1, d2) {
  const type = status & 0xf0;
  if (type === 0x90) synth_note_on(s, d1, d2);
  else if (type === 0x80) synth_note_off(s, d1);
  else if (type === 0xe0) synth_pitch_bend(s, ((d2 << 7) | d1) / 8192 - 1);
  else if (type === 0xb0) {
    if (d1 === 1) synth_mod_wheel(s, d2 / 127);
    else if (d1 === 64) synth_sustain_pedal(s, d2 >= 64);
    else if (d1 === 120 || d1 === 123) synth_all_notes_off(s);
  }
}

registerAmiProcessor('amisynth-synth', {
  defaults: defaultValues(SYNTH_PARAMS),
  init: synth_init,
  update: synth_update,
  midi: synth_midi,
  render: synth_render,
  panic: synth_all_notes_off,
  message(s, msg) {
    if (msg.type === 'scale') synth_set_scale(s, msg.cents || [], msg.cents ? msg.cents.length : 0);
  },
});
