// General MIDI Level 1 program (0..127) -> the closest built-in preset. Used when a MIDI file or
// a MIDI controller sends a program change. `exact: false` marks programs AmiSynth has no
// dedicated sound for yet (organs, accordion, harmonica, sitar ...): the nearest preset stands in.

import { PHYS_PRESETS } from './phys.js';
import { SYNTH_PRESETS } from './synth.js';

/** @typedef {{name:string, kind:'synth'|'phys', preset:string, exact?:false}} GmProgram */

const S = (name, preset, exact = true) => ({ name, kind: 'synth', preset, ...(exact ? {} : { exact: false }) });
const P = (name, preset, exact = true) => ({ name, kind: 'phys', preset, ...(exact ? {} : { exact: false }) });

/** @type {GmProgram[]} */
export const GM_PROGRAMS = [
  // Piano
  P('Acoustic Grand Piano', 'Grand Piano'), P('Bright Acoustic Piano', 'Bright Piano'), P('Electric Grand Piano', 'Electric Grand'),
  P('Honky-tonk Piano', 'Honky-tonk'), S('Electric Piano 1', 'FM E-Piano'), S('Electric Piano 2', 'DX E-Piano'),
  P('Harpsichord', 'Harpsichord'), P('Clavinet', 'Clavinet'),
  // Chromatic percussion
  P('Celesta', 'Celesta'), P('Glockenspiel', 'Glockenspiel'), P('Music Box', 'Music Box'), P('Vibraphone', 'Vibraphone'),
  P('Marimba', 'Marimba'), P('Xylophone', 'Xylophone'), P('Tubular Bells', 'Tubular Bells'), P('Dulcimer', 'Hammered Dulcimer'),
  // Organ
  S('Drawbar Organ', 'Organ', false), S('Percussive Organ', 'Organ', false), S('Rock Organ', 'Organ', false),
  S('Church Organ', 'Organ', false), S('Reed Organ', 'Organ', false), S('Accordion', 'Organ', false),
  P('Harmonica', 'Clarinet', false), S('Tango Accordion', 'Organ', false),
  // Guitar
  P('Acoustic Guitar (nylon)', 'Nylon Guitar'), P('Acoustic Guitar (steel)', 'Steel String'), P('Electric Guitar (jazz)', 'Jazz Guitar'),
  P('Electric Guitar (clean)', 'Clean Electric'), P('Electric Guitar (muted)', 'Palm Mute Chug'), P('Overdriven Guitar', 'Overdrive Lead'),
  P('Distortion Guitar', 'Distortion Power Chord'), S('Guitar Harmonics', 'Glass Pluck', false),
  // Bass
  P('Acoustic Bass', 'Acoustic Bass'), P('Electric Bass (finger)', 'Finger Bass'), P('Electric Bass (pick)', 'Pick Bass'),
  P('Fretless Bass', 'Fretless Bass'), P('Slap Bass 1', 'Slap Bass'), P('Slap Bass 2', 'Slap Bass'),
  S('Synth Bass 1', 'Acid Bass'), S('Synth Bass 2', 'Rubber Mono Bass'),
  // Strings
  P('Violin', 'Violin'), P('Viola', 'Viola'), P('Cello', 'Cello'), P('Contrabass', 'Contrabass'),
  S('Tremolo Strings', 'Tremolo Strings'), P('Pizzicato Strings', 'Pizzicato Strings'), P('Orchestral Harp', 'Harp'), P('Timpani', 'Timpani'),
  // Ensemble
  S('String Ensemble 1', 'String Ensemble'), S('String Ensemble 2', 'Chorus Strings'), S('Synth Strings 1', 'PWM Strings'),
  S('Synth Strings 2', 'PWM Sweep Strings'), S('Choir Aahs', 'Choir Aahs'), S('Voice Oohs', 'Voice Oohs'),
  S('Synth Voice', 'Vowel Choir Pad'), S('Orchestra Hit', 'Orchestra Hit'),
  // Brass
  P('Trumpet', 'Trumpet'), P('Trombone', 'Trombone'), P('Tuba', 'Tuba'), P('Muted Trumpet', 'Flugelhorn', false),
  P('French Horn', 'French Horn'), S('Brass Section', 'Brass Section'), S('Synth Brass 1', 'Brass'), S('Synth Brass 2', 'Brass Section'),
  // Reed
  P('Soprano Sax', 'Soprano Sax'), P('Alto Sax', 'Alto Sax'), P('Tenor Sax', 'Tenor Sax'), P('Baritone Sax', 'Baritone Sax'),
  P('Oboe', 'Oboe'), P('English Horn', 'English Horn'), P('Bassoon', 'Bassoon'), P('Clarinet', 'Clarinet'),
  // Pipe
  P('Piccolo', 'Piccolo'), P('Flute', 'Pure Flute'), P('Recorder', 'Recorder'), P('Pan Flute', 'Pan Pipe'),
  P('Blown Bottle', 'Blown Bottle'), P('Shakuhachi', 'Shakuhachi'), P('Whistle', 'Whistle'), P('Ocarina', 'Ocarina'),
  // Synth lead
  S('Lead 1 (square)', 'Chiptune Square'), S('Lead 2 (sawtooth)', 'Supersaw Lead'), S('Lead 3 (calliope)', 'Calliope Lead'),
  S('Lead 4 (chiff)', 'Chiff Lead'), S('Lead 5 (charang)', 'Sync Lead'), S('Lead 6 (voice)', 'Morphing Wave Lead', false),
  S('Lead 7 (fifths)', 'Fifths Lead'), S('Lead 8 (bass + lead)', 'Bass + Lead'),
  // Synth pad
  S('Pad 1 (new age)', 'New Age Pad'), S('Pad 2 (warm)', 'Warm Pad'), S('Pad 3 (polysynth)', 'Poly Chord Stab'),
  S('Pad 4 (choir)', 'Vowel Choir Pad'), S('Pad 5 (bowed)', 'Bowed Pad'), S('Pad 6 (metallic)', 'Metallic Pad'),
  S('Pad 7 (halo)', 'Ambient Hall Pad'), S('Pad 8 (sweep)', 'Slow Chord Wash'),
  // Synth effects
  S('FX 1 (rain)', 'Rain'), S('FX 2 (soundtrack)', 'Soundtrack'), S('FX 3 (crystal)', 'Crystal'), P('FX 4 (atmosphere)', 'Glass Atmosphere'),
  S('FX 5 (brightness)', 'Brightness'), S('FX 6 (goblins)', 'Goblin'), S('FX 7 (echoes)', 'Echo Drops'), S('FX 8 (sci-fi)', 'Sci-Fi'),
  // Ethnic
  P('Sitar', 'Koto-ish', false), P('Banjo', 'Steel String', false), P('Shamisen', 'Koto-ish', false), P('Koto', 'Koto-ish'),
  P('Kalimba', 'Kalimba'), P('Bagpipe', 'Shanai', false), P('Fiddle', 'Fiddle'), P('Shanai', 'Shanai'),
  // Percussive
  P('Tinkle Bell', 'Tinkle Bell'), P('Agogo', 'Agogo'), P('Steel Drums', 'Steel Drums'), P('Woodblock', 'Woodblock'),
  P('Taiko Drum', 'Taiko'), P('Melodic Tom', 'Tom'), S('Synth Drum', 'Synth Drum'), S('Reverse Cymbal', 'Reverse Cymbal'),
  // Sound effects
  S('Guitar Fret Noise', 'Chip Metal Noise', false), S('Breath Noise', 'Breath Noise'), S('Seashore', 'Seashore'), S('Bird Tweet', 'Bird Tweet'),
  S('Telephone Ring', 'Telephone Ring'), S('Helicopter', 'Helicopter'), S('Applause', 'Applause'), S('Gunshot', 'Gunshot'),
];

/**
 * The preset a GM program selects, or null for an out-of-range program.
 * @param {number} program 0..127
 * @returns {{kind:'synth'|'phys', preset:object, gm:GmProgram} | null}
 */
export function gmProgramPreset(program) {
  const gm = GM_PROGRAMS[program];
  if (!gm) return null;
  const preset = (gm.kind === 'phys' ? PHYS_PRESETS : SYNTH_PRESETS).find((p) => p.name === gm.preset);
  return preset ? { kind: gm.kind, preset, gm } : null;
}
