import { defaultValues, PHYS_PARAMS } from '../dsp/params.js';
import {
  phys_all_notes_off, phys_init, phys_note_off, phys_note_on, phys_pitch_bend, phys_render,
  phys_set_scale, phys_snapshot, phys_update,
} from '../dsp/phys.js';
import { registerAmiProcessor } from './processor-base.js';

/** MIDI byte dispatch (JSFX: midirecv loop in @block). */
function phys_midi(s, status, d1, d2) {
  const type = status & 0xf0;
  if (type === 0x90) phys_note_on(s, d1, d2);
  else if (type === 0x80) phys_note_off(s, d1);
  else if (type === 0xe0) phys_pitch_bend(s, ((d2 << 7) | d1) / 8192 - 1);
  else if (type === 0xb0 && (d1 === 120 || d1 === 123)) phys_all_notes_off(s);
}

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
