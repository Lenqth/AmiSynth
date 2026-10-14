// MIDI byte dispatch for the three DSP cores (JSFX: the midirecv loop in @block).
// Shared by the AudioWorklets and the offline renderer so both react identically.
import {
  synth_all_notes_off, synth_cc, synth_channel_pressure, synth_mod_wheel, synth_note_off, synth_note_on, synth_pitch_bend,
  synth_poly_pressure, synth_sustain_pedal,
} from './synth.js';
import {
  phys_all_notes_off, phys_channel_pressure, phys_mod_wheel, phys_note_off, phys_note_on, phys_pitch_bend, phys_poly_pressure, phys_pressure_reset, phys_sustain_pedal,
} from './phys.js';
import { drums_note_on } from './drums.js';

export function synth_midi(s, status, d1, d2) {
  const type = status & 0xf0;
  if (type === 0x90) synth_note_on(s, d1, d2);
  else if (type === 0x80) synth_note_off(s, d1);
  else if (type === 0xe0) synth_pitch_bend(s, ((d2 << 7) | d1) / 8192 - 1);
  else if (type === 0xd0) synth_channel_pressure(s, d1 / 127); // channel pressure: one data byte
  else if (type === 0xa0) synth_poly_pressure(s, d1, d2 / 127); // polyphonic aftertouch: key, value
  else if (type === 0xb0) {
    synth_cc(s, d1, d2);
    if (d1 === 1) synth_mod_wheel(s, d2 / 127);
    else if (d1 === 64) synth_sustain_pedal(s, d2 >= 64);
    else if (d1 === 120 || d1 === 123) synth_all_notes_off(s);
  }
}

export function phys_midi(s, status, d1, d2) {
  const type = status & 0xf0;
  if (type === 0x90) phys_note_on(s, d1, d2);
  else if (type === 0x80) phys_note_off(s, d1);
  else if (type === 0xe0) phys_pitch_bend(s, ((d2 << 7) | d1) / 8192 - 1);
  else if (type === 0xd0) phys_channel_pressure(s, d1 / 127);
  else if (type === 0xa0) phys_poly_pressure(s, d1, d2 / 127);
  else if (type === 0xb0) {
    if (d1 === 64) phys_sustain_pedal(s, d2 >= 64);
    else if (d1 === 1) phys_mod_wheel(s, d2 / 127);
    else if (d1 === 120 || d1 === 123) phys_all_notes_off(s);
    else if (d1 === 121) { phys_sustain_pedal(s, false); phys_pitch_bend(s, 0); phys_pressure_reset(s); }
  }
}

/** Drums only react to note-on (one-shot voices, note-off ignored like most drum machines). */
export function drums_midi(d, status, d1, d2) {
  if ((status & 0xf0) === 0x90 && d2 > 0) drums_note_on(d, d1, d2);
}
