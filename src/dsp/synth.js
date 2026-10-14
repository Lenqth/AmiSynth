// AmiSynth polyphonic subtractive synth core.
// Pure DSP: no Web Audio dependencies, runs in an AudioWorklet or in Node tests.
// Structure mirrors a JSFX plugin:
//   synth_init        -> @init
//   synth_update      -> @slider   (p = slider values keyed by param id)
//   synth_transport   -> @block    (host tempo / beat position)
//   synth_note_on/off -> @block MIDI handling (midirecv)
//   synth_render      -> @sample   (one call per sample)
//
// Note path:  MIDI key -> [arpeggiator] -> transpose -> voice engine (poly, or mono/legato on voice 0)
// Signal flow per voice:
//   [osc1 + osc2] x unison (detuned, panned) + sub + noise -> drive -> SVF (12/24 dB, LP/HP/BP/notch) -> amp env
//   osc2 can hard-sync to osc1 and phase-modulate osc1 (FM). The filter envelope can bend osc2 pitch.
// Mod matrix: MOD_SLOTS slots of source -> destination x amount (real units), evaluated per sample.
//   Global sources (LFO 1, LFO 2, mod wheel) are summed once per sample, per-note sources (mod env,
//   velocity, key track, pressure, random) per voice. Slots that are Off cost nothing, and every code
//   path a slot adds is skipped unless a slot uses it, so patches without modulation render exactly
//   as before.
//
// Voices are matched by "key" (the incoming MIDI note, or the arpeggiator's output note) and sound
// at "pitch" (key + transpose), so changing the transpose while notes sound never leaves one hanging.

import {
  adsr_gate_off, adsr_gate_on, adsr_init, adsr_process, adsr_set,
  clamp, db_to_gain, lfo_init, lfo_process, lfo_process_at, lfo_wave, pan_gains, noise_seed, noise_white, random_unit, osc_init, osc_process, osc_reset,
  osc_set_freq, osc_sync_to, smoother_init, smoother_process, smoother_set, soft_clip, svf_copy_coefs,
  svf_init, svf_output, svf_process, svf_reset, svf_set, tau_coef, TWO_PI, tuning_init, tuning_note_to_hz,
  tuning_set_edo, tuning_set_table,
} from './lib.js';
import { ARP_RATE_BEATS, LFO_SYNC_BEATS, MOD_DESTINATIONS, MOD_SLOTS, MOD_SOURCES } from './params.js';

export const MAX_VOICES = 8;
export const MAX_UNISON = 9;
/** Held keys remembered by the arpeggiator and by the mono note stack. */
export const MAX_HELD = 16;

const ARP_UP = 1;
const ARP_DOWN = 2;
const ARP_UPDOWN = 3;
const ARP_RANDOM = 4;
const ARP_CHORD = 6; // 5 = as played

// mod matrix sources / destinations (indices into MOD_SOURCES / MOD_DESTINATIONS in params.js)
const SRC_LFO1 = 1;
const SRC_LFO2 = 2;
const SRC_MENV = 3;
const SRC_VEL = 4;
const SRC_KEY = 5;
const SRC_WHEEL = 6;
const SRC_PRESS = 7;
const SRC_RAND = 8;
const DST_PITCH = 1;
const DST_CUTOFF = 2;
const DST_RES = 3;
const DST_PW = 4;
const DST_OSC2 = 5;
const DST_FM = 6;
const DST_AMP = 7;
const DST_PAN = 8;
const DST_LFO1_RATE = 9;
const DST_LFO2_RATE = 10;
const DST_NOISE = 11;
const N_SRC = MOD_SOURCES.length;
const N_DST = MOD_DESTINATIONS.length;

function voice_create() {
  const v = {
    active: 0, // 1 while the amp envelope runs
    note: -1, // key the voice answers to (note-off matching)
    pitch: 0, // note number it sounds at (key + transpose)
    gate: 0, // key held
    sustained: 0, // released while sustain pedal held
    velocity: 0,
    age: 0, // allocation counter for voice stealing
    base_hz: 0,
    glide_oct: 0, // pitch offset that decays to 0 (portamento)
    osc1: [], osc2: [], prev2: [], // per unison copy (JSFX: arrays in memory)
    sub: {},
    filt_l1: {}, filt_l2: {}, filt_r1: {}, filt_r2: {},
    amp_env: {}, filt_env: {}, mod_env: {},
    // mod matrix: random value drawn per note (-1..1), polyphonic aftertouch of the key (0..1),
    // smoothed pressure of this voice (max of channel pressure and its aftertouch)
    rnd: 0, poly_at: 0, press: 0,
    // chip / S&H noise: shift register, clock phase, current output; noise-only filter
    nz_reg: 1, nz_phase: 0, nz_out: 0, nz_filt: {},
  };
  for (let u = 0; u < MAX_UNISON; u++) {
    v.osc1.push({});
    v.osc2.push({});
    v.prev2.push(0);
    osc_init(v.osc1[u]);
    osc_init(v.osc2[u]);
  }
  osc_init(v.sub);
  svf_init(v.filt_l1);
  svf_init(v.filt_l2);
  svf_init(v.filt_r1);
  svf_init(v.filt_r2);
  adsr_init(v.amp_env);
  adsr_init(v.filt_env);
  adsr_init(v.mod_env);
  svf_init(v.nz_filt);
  return v;
}

// Clock of the chip / S&H noise in multiples of the note frequency (at Noise Clock 0).
// Chip Short repeats every 93 clocks, so x93 puts its tone on the note.
const NOISE_CLOCK = [0, 32, 93, 8];

/**
 * One sample of the voice's chip / S&H noise. The 15-bit shift register of 8-bit consoles is
 * done in plain arithmetic (no bit operators) so that EEL2 computes exactly the same thing:
 * feedback = bit0 XOR bit1 (long, 32767 steps) or bit0 XOR bit6 (short, 93 steps).
 */
function voice_noise(s, v, hz) {
  v.nz_phase += Math.min(1, (hz * s.noise_clock) / s.sr);
  if (v.nz_phase >= 1) {
    v.nz_phase -= 1;
    if (s.noise_type === 3) {
      v.nz_out = noise_white();
    } else {
      const r = v.nz_reg;
      const tap = s.noise_type === 2 ? 64 : 2;
      const b0 = r - 2 * Math.floor(r / 2);
      const bx = Math.floor(r / tap) - 2 * Math.floor(r / (2 * tap));
      v.nz_reg = Math.floor(r / 2) + (b0 === bx ? 0 : 16384);
      v.nz_out = v.nz_reg - 2 * Math.floor(v.nz_reg / 2) ? 1 : -1;
    }
  }
  return v.nz_out;
}

/**
 * The synth's own random generator for the mod matrix (LFO 2 sample & hold, random per note): the
 * same Park-Miller formula as noise_white() with a separate state, so using these sources never
 * changes the noise / unison phases of the shared generator.
 */
function mod_random(s) {
  s.mod_rnd *= 16807;
  s.mod_rnd -= Math.floor(s.mod_rnd / 2147483647) * 2147483647;
  return s.mod_rnd / 1073741823.5 - 1;
}

/** LFO 2: like lfo_process / lfo_process_at, but its sample & hold draws from mod_random. */
function lfo2_tick(s, waveform) {
  const o = s.lfo2;
  if (s.lfo2_sync_beats > 0) {
    let ph = s.beat / s.lfo2_sync_beats;
    ph -= Math.floor(ph);
    if (ph < o.phase) o.held = mod_random(s);
    o.phase = ph;
    return lfo_wave(waveform, ph, o.held);
  }
  const y = lfo_wave(waveform, o.phase, o.held);
  o.phase += o.inc;
  if (o.phase >= 1) {
    o.phase -= 1;
    o.held = mod_random(s);
  }
  return y;
}

export function synth_init(s, sr) {
  noise_seed(12345);
  s.sr = sr;
  s.voices = [];
  for (let i = 0; i < MAX_VOICES; i++) s.voices.push(voice_create());
  s.tuning = {};
  tuning_init(s.tuning);
  s.custom_scale = 0; // 1 while a custom table is loaded
  s.age_counter = 0;
  s.bend = 0; // -1..1
  s.modwheel = 0; // 0..1
  s.sustain_pedal = 0;
  s.last_hz = 0; // glide source
  s.lfo = {};
  lfo_init(s.lfo);
  s.lfo_inc = 0;
  s.lfo2 = {};
  lfo_init(s.lfo2);
  s.lfo2_inc = 0;
  s.lfo2_sync_beats = 0;
  s.mod_rnd = 777;
  // aftertouch: channel pressure 0..1 and its smoothed value (for the global destinations)
  s.pressure = 0;
  s.press_g = 0;
  s.press_a = 1 - tau_coef(10, sr);
  // mod matrix: the active slots packed (src / dst / amount), sources and destinations in use,
  // per-sample sums of the global sources and the per-voice totals
  s.mm_n = 0;
  s.mm_src = new Array(MOD_SLOTS).fill(0);
  s.mm_dst = new Array(MOD_SLOTS).fill(0);
  s.mm_amt = new Array(MOD_SLOTS).fill(0);
  s.mm_use = new Array(N_SRC).fill(0);
  s.mm_has = new Array(N_DST).fill(0);
  s.mm_g = new Array(N_DST).fill(0);
  s.mm_v = new Array(N_DST).fill(0);
  s.pan = { gl: 1, gr: 1 };
  s.cutoff_smooth = {};
  smoother_init(s.cutoff_smooth, 1000);
  smoother_set(s.cutoff_smooth, 15, sr);
  s.gain_smooth = {};
  smoother_init(s.gain_smooth, 0);
  smoother_set(s.gain_smooth, 20, sr);
  s.unison_ratio = new Array(MAX_UNISON).fill(1);
  s.unison_gl = new Array(MAX_UNISON).fill(1);
  s.unison_gr = new Array(MAX_UNISON).fill(1);
  s.unison_w = new Array(MAX_UNISON).fill(1);
  // host transport: beats (quarter notes) advance every sample, resynced by synth_transport()
  s.tempo = 120;
  s.beat = 0;
  s.beat_inc = 120 / 60 / sr;
  // mono / legato note stack (last note priority)
  s.stack_key = new Array(MAX_HELD).fill(0);
  s.stack_pitch = new Array(MAX_HELD).fill(0);
  s.stack_vel = new Array(MAX_HELD).fill(0);
  s.stack_n = 0;
  // arpeggiator: held keys in the order played, the notes it is sounding, the last step it played
  s.arp = {
    key: new Array(MAX_HELD).fill(0), vel: new Array(MAX_HELD).fill(0), n: 0,
    snd: new Array(MAX_HELD).fill(0), snd_n: 0,
    ord_key: new Array(MAX_HELD).fill(0), ord_vel: new Array(MAX_HELD).fill(0),
    new_key: new Array(MAX_HELD).fill(0), new_vel: new Array(MAX_HELD).fill(0),
    last: 0, off_pos: 0, idx: 0,
  };
  s.arp_pattern = new Array(16).fill(1);
  s.arp_mode = 0;
  s.cc_cutoff_value = 64; // last value of the cutoff CC (64 = centre, no change)
  s.cc_mult = 1;
  s.p = {};
  s.out_l = 0;
  s.out_r = 0;
}

/** Re-derive internal values after any parameter change (JSFX @slider). */
export function synth_update(s, p) {
  s.p = p;
  if (!s.custom_scale) tuning_set_edo(s.tuning, p.tuning_divisions, p.tuning_period_cents);
  s.tuning.ref_note = p.tuning_ref_note;
  s.tuning.ref_hz = p.tuning_ref_hz;
  s.cutoff_target = p.filter_cutoff_hz;
  s.master_gain = db_to_gain(p.master_volume_db);
  // resonance 0..1 -> SVF damping k 2..0.02 (curved so the top of the knob is usable)
  const r = clamp(p.filter_resonance, 0, 1);
  s.filter_k = 2 - 1.98 * Math.sqrt(r);
  s.lfo_inc = p.lfo_rate_hz / s.sr;
  s.lfo.inc = s.lfo_inc;
  s.lfo_sync_beats = LFO_SYNC_BEATS[clamp(Math.round(p.lfo_sync), 0, LFO_SYNC_BEATS.length - 1)];
  s.lfo2_inc = p.lfo2_rate_hz / s.sr;
  s.lfo2.inc = s.lfo2_inc;
  s.lfo2_sync_beats = LFO_SYNC_BEATS[clamp(Math.round(p.lfo2_sync), 0, LFO_SYNC_BEATS.length - 1)];
  // mod matrix: keep only the slots that do something
  for (let i = 0; i < N_SRC; i++) s.mm_use[i] = 0;
  for (let i = 0; i < N_DST; i++) s.mm_has[i] = 0;
  let mm = 0;
  for (let k = 0; k < MOD_SLOTS; k++) {
    const src = clamp(Math.round(p[`mod${k + 1}_source`]), 0, N_SRC - 1);
    const dst = clamp(Math.round(p[`mod${k + 1}_destination`]), 0, N_DST - 1);
    const amt = p[`mod${k + 1}_amount`];
    if (src > 0 && dst > 0 && amt !== 0) {
      s.mm_src[mm] = src;
      s.mm_dst[mm] = dst;
      s.mm_amt[mm] = amt;
      s.mm_use[src] = 1;
      s.mm_has[dst] = 1;
      mm++;
    }
  }
  s.mm_n = mm;
  s.glide_coef = p.glide_ms > 0 ? tau_coef(p.glide_ms / 3, s.sr) : 0; // ~95% there after glide_ms
  s.glide_legato = p.glide_mode >= 0.5 ? 1 : 0;
  s.drive_gain = 1 + 8 * p.filter_drive;
  s.drive_makeup = 1 / (1 + 1.5 * p.filter_drive);
  s.fm_cycles = p.fm_index / TWO_PI;
  s.transpose = Math.round(p.transpose_semitones);
  s.noise_type = clamp(Math.round(p.noise_type), 0, 3);
  s.noise_clock = NOISE_CLOCK[s.noise_type] * Math.pow(2, p.noise_clock_oct);
  s.noise_filter = clamp(Math.round(p.noise_filter_mode), 0, 3);
  s.cc_cutoff_num = Math.round(p.cc_cutoff_number);
  s.cc_mult = Math.pow(2, clamp((s.cc_cutoff_value - 64) / 63, -1, 1) * p.cc_cutoff_depth_oct);
  s.mono = p.voice_mode >= 0.5 ? 1 : 0;
  s.legato = p.voice_mode >= 1.5 ? 1 : 0;

  // Unison: copies spread over +/- detune/2 (evenly, or bunched toward the centre by the curve),
  // panned evenly across the stereo width. The centre copy (two for an even count) is at full level.
  const n = clamp(Math.round(p.unison_voices), 1, MAX_UNISON);
  const curve = p.unison_detune_curve;
  let wsum = 0;
  s.unison_n = n;
  for (let u = 0; u < MAX_UNISON; u++) {
    const pos = n > 1 ? u / (n - 1) - 0.5 : 0; // -0.5..0.5
    let dpos = pos;
    if (curve > 0) dpos = (pos < 0 ? -0.5 : 0.5) * Math.pow(Math.abs(2 * pos), 1 + 2 * curve);
    s.unison_ratio[u] = Math.pow(2, (dpos * p.unison_detune_cents) / 1200);
    const a = (pos * p.unison_stereo_width + 0.5) * 0.5 * Math.PI; // 0..pi/2
    s.unison_gl[u] = Math.cos(a) * 1.41421356;
    s.unison_gr[u] = Math.sin(a) * 1.41421356;
    s.unison_w[u] = Math.abs(u - (n - 1) / 2) < 0.75 ? 1 : p.unison_side_level;
    if (u < n) wsum += s.unison_w[u] * s.unison_w[u];
  }
  s.unison_norm = 1 / Math.sqrt(wsum);
  s.stereo = n > 1 && p.unison_stereo_width > 0 ? 1 : 0;

  // Arpeggiator. Switching it on or off releases everything so no note is left hanging.
  const mode = clamp(Math.round(p.arp_mode), 0, ARP_CHORD);
  if (mode !== s.arp_mode && (mode === 0 || s.arp_mode === 0)) synth_release_all(s);
  s.arp_mode = mode;
  s.arp_step_beats = ARP_RATE_BEATS[clamp(Math.round(p.arp_rate), 0, ARP_RATE_BEATS.length - 1)];
  s.arp_octaves = clamp(Math.round(p.arp_octaves), 1, 4);
  s.arp_gate = clamp(p.arp_gate, 0.05, 1);
  s.arp_swing = clamp((2 * p.arp_swing_percent) / 100 - 1, 0, 0.5); // delay of every 2nd step, in steps
  s.arp_steps = clamp(Math.round(p.arp_steps), 1, 16);
  for (let i = 0; i < 16; i++) s.arp_pattern[i] = p[`arp_step_${i + 1}`] >= 0.5 ? 1 : 0;

  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    adsr_set(v.amp_env, p.amp_attack_ms, p.amp_decay_ms, p.amp_sustain, p.amp_release_ms, s.sr);
    adsr_set(v.filt_env, p.filter_env_attack_ms, p.filter_env_decay_ms, p.filter_env_sustain, p.filter_env_release_ms, s.sr);
    adsr_set(v.mod_env, p.mod_env_attack_ms, p.mod_env_decay_ms, p.mod_env_sustain, p.mod_env_release_ms, s.sr);
    svf_set(v.nz_filt, p.noise_filter_hz, 1, s.sr);
    if (v.active) v.base_hz = tuning_note_to_hz(s.tuning, v.pitch);
  }
}

/** Load a custom scale (Scala style cents list, last entry = period). count=0 reverts to EDO. */
export function synth_set_scale(s, cents_list, count) {
  if (count > 0) {
    tuning_set_table(s.tuning, cents_list, count);
    s.custom_scale = 1;
  } else {
    s.custom_scale = 0;
  }
  synth_update(s, s.p);
}

/**
 * Host transport (JSFX: tempo / play_state / beat_position at the start of @block).
 * bpm > 0 sets the tempo; while playing, the beat position is resynced to the host's.
 * When stopped the beat keeps counting at the last tempo, so the arpeggiator and a synced LFO still run.
 */
export function synth_transport(s, bpm, playing, beat) {
  if (bpm > 0) {
    s.tempo = bpm;
    s.beat_inc = bpm / 60 / s.sr;
  }
  if (playing) s.beat = beat;
}

// ---------------------------------------------------------------------------
// Voice engine (poly): voices answer to `key`, sound at `pitch`

function voice_limit(s) {
  return clamp(Math.round(s.p.voice_count || MAX_VOICES), 1, MAX_VOICES);
}

function voice_allocate(s) {
  const n = voice_limit(s);
  let best = -1;
  let best_score = -1;
  for (let i = 0; i < n; i++) {
    const v = s.voices[i];
    if (!v.active) return i;
    // Prefer stealing released voices, then the oldest.
    const score = (v.gate ? 0 : 1e12) + (s.age_counter - v.age);
    if (score > best_score) {
      best_score = score;
      best = i;
    }
  }
  return best;
}

function any_gate(s) {
  for (let i = 0; i < MAX_VOICES; i++) if (s.voices[i].active && s.voices[i].gate) return 1;
  return 0;
}

/** Fresh voice: restart oscillators and filters (a voice still ringing keeps them, no click). */
function voice_reset(s, v) {
  const spread = s.unison_n > 1;
  for (let u = 0; u < MAX_UNISON; u++) {
    // random phases make unison copies sound like a section instead of flanging in sync
    osc_reset(v.osc1[u], spread ? random_unit() : 0);
    osc_reset(v.osc2[u], random_unit());
    v.prev2[u] = 0;
  }
  osc_reset(v.sub, 0);
  v.nz_reg = 1;
  v.nz_phase = 0;
  v.nz_out = 0;
  svf_reset(v.nz_filt);
  svf_reset(v.filt_l1);
  svf_reset(v.filt_l2);
  svf_reset(v.filt_r1);
  svf_reset(v.filt_r2);
  v.amp_env.value = 0;
  v.filt_env.value = 0;
  v.mod_env.value = 0;
}

function poly_note_on(s, key, pitch, velocity) {
  const n = voice_limit(s);
  const held = s.glide_legato ? any_gate(s) : 1;
  // Retrigger a voice already playing this key, otherwise allocate.
  let idx = -1;
  for (let i = 0; i < n; i++) if (s.voices[i].active && s.voices[i].note === key) idx = i;
  if (idx < 0) idx = voice_allocate(s);
  const v = s.voices[idx];
  const hz = tuning_note_to_hz(s.tuning, pitch);
  if (!v.active) voice_reset(s, v);
  // Glide from the last played pitch (in octaves, decays to 0 in synth_render).
  v.glide_oct = s.glide_coef > 0 && s.last_hz > 0 && held ? clamp(Math.log2(s.last_hz / hz), -8, 8) : 0;
  s.last_hz = hz;
  v.active = 1;
  v.gate = 1;
  v.sustained = 0;
  v.note = key;
  v.pitch = pitch;
  v.velocity = velocity / 127;
  v.age = ++s.age_counter;
  v.base_hz = hz;
  v.poly_at = 0;
  adsr_gate_on(v.amp_env);
  adsr_gate_on(v.filt_env);
  adsr_gate_on(v.mod_env);
  v.rnd = mod_random(s);
}

function poly_note_off(s, key) {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    if (v.active && v.gate && v.note === key) {
      v.gate = 0;
      if (s.sustain_pedal) {
        v.sustained = 1;
      } else {
        adsr_gate_off(v.amp_env);
        adsr_gate_off(v.filt_env);
        adsr_gate_off(v.mod_env);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mono / legato: voice 0 only, last-note priority with a stack of held keys

/** Move voice 0 to a note. retrig: restart the envelopes; overlap: a key was still held (legato). */
function mono_play(s, key, pitch, velocity, retrig, overlap) {
  const v = s.voices[0];
  const hz = tuning_note_to_hz(s.tuning, pitch);
  if (!v.active) voice_reset(s, v);
  if (s.glide_coef > 0 && (overlap || !s.glide_legato)) {
    // glide from where the pitch is right now (it may still be gliding)
    if (v.active) v.glide_oct = clamp(v.glide_oct + Math.log2(v.base_hz / hz), -8, 8);
    else v.glide_oct = s.last_hz > 0 ? clamp(Math.log2(s.last_hz / hz), -8, 8) : 0;
  } else {
    v.glide_oct = 0;
  }
  s.last_hz = hz;
  v.active = 1;
  v.gate = 1;
  v.sustained = 0;
  v.note = key;
  v.pitch = pitch;
  v.age = ++s.age_counter;
  v.base_hz = hz;
  v.poly_at = 0;
  if (retrig) {
    v.velocity = velocity / 127;
    adsr_gate_on(v.amp_env);
    adsr_gate_on(v.filt_env);
    adsr_gate_on(v.mod_env);
    v.rnd = mod_random(s);
  }
}

function stack_remove(s, key) {
  let j = 0;
  for (let i = 0; i < s.stack_n; i++) {
    if (s.stack_key[i] !== key) {
      s.stack_key[j] = s.stack_key[i];
      s.stack_pitch[j] = s.stack_pitch[i];
      s.stack_vel[j] = s.stack_vel[i];
      j++;
    }
  }
  s.stack_n = j;
}

function mono_note_on(s, key, pitch, velocity) {
  stack_remove(s, key);
  if (s.stack_n >= MAX_HELD) {
    // forget the oldest key
    for (let i = 1; i < MAX_HELD; i++) {
      s.stack_key[i - 1] = s.stack_key[i];
      s.stack_pitch[i - 1] = s.stack_pitch[i];
      s.stack_vel[i - 1] = s.stack_vel[i];
    }
    s.stack_n = MAX_HELD - 1;
  }
  s.stack_key[s.stack_n] = key;
  s.stack_pitch[s.stack_n] = pitch;
  s.stack_vel[s.stack_n] = velocity;
  s.stack_n++;
  const v = s.voices[0];
  const overlap = v.active && v.gate ? 1 : 0;
  mono_play(s, key, pitch, velocity, s.legato && overlap ? 0 : 1, overlap);
}

function mono_note_off(s, key) {
  stack_remove(s, key);
  const v = s.voices[0];
  if (v.active && v.gate && v.note === key && s.stack_n > 0) {
    // back to the most recent key still held
    const t = s.stack_n - 1;
    mono_play(s, s.stack_key[t], s.stack_pitch[t], s.stack_vel[t], s.legato ? 0 : 1, 1);
  }
}

function engine_on(s, key, pitch, velocity) {
  if (s.mono) mono_note_on(s, key, pitch, velocity);
  else poly_note_on(s, key, pitch, velocity);
}

function engine_off(s, key) {
  if (s.mono) mono_note_off(s, key);
  // releases voice 0 when no other key is held, and any voice left from a mode change
  poly_note_off(s, key);
}

// ---------------------------------------------------------------------------
// Arpeggiator: steps are locked to the host beat grid (step k starts at beat k * step_beats,
// every 2nd step delayed by the swing). Each step plays the next note of the held chord.

function arp_key_on(s, key, velocity) {
  const a = s.arp;
  for (let i = 0; i < a.n; i++) {
    if (a.key[i] === key) {
      a.vel[i] = velocity;
      return;
    }
  }
  if (a.n >= MAX_HELD) return;
  if (a.n === 0) {
    // first key: start from the bottom of the pattern and play the current step at once (a key
    // pressed in the last 10 % of a step waits for the next one instead)
    const pos = s.beat / s.arp_step_beats;
    const k = Math.floor(pos + 0.000001);
    a.idx = 0;
    a.last = pos - k > 0.9 ? k : k - 1;
  }
  a.key[a.n] = key;
  a.vel[a.n] = velocity;
  a.n++;
}

function arp_key_off(s, key) {
  const a = s.arp;
  let j = 0;
  for (let i = 0; i < a.n; i++) {
    if (a.key[i] !== key) {
      a.key[j] = a.key[i];
      a.vel[j] = a.vel[i];
      j++;
    }
  }
  a.n = j;
}

function arp_release(s) {
  const a = s.arp;
  for (let i = 0; i < a.snd_n; i++) engine_off(s, a.snd[i]);
  a.snd_n = 0;
}

/** Play one step: work out the new notes, then hand over from the notes of the previous step. */
function arp_fire(s) {
  const a = s.arp;
  const n = a.n;
  let m = 0;
  if (s.arp_mode === ARP_CHORD) {
    for (let i = 0; i < n; i++) {
      a.new_key[i] = a.key[i] + s.transpose;
      a.new_vel[i] = a.vel[i];
    }
    m = n;
  } else {
    // order: as played, or sorted low to high (insertion sort keeps equal keys in play order)
    for (let i = 0; i < n; i++) {
      let j = i;
      if (s.arp_mode !== 5) {
        while (j > 0 && a.ord_key[j - 1] > a.key[i]) {
          a.ord_key[j] = a.ord_key[j - 1];
          a.ord_vel[j] = a.ord_vel[j - 1];
          j--;
        }
      }
      a.ord_key[j] = a.key[i];
      a.ord_vel[j] = a.vel[i];
    }
    const len = n * s.arp_octaves;
    let i;
    if (s.arp_mode === ARP_DOWN) i = len - 1 - (a.idx % len);
    else if (s.arp_mode === ARP_UPDOWN) {
      if (len > 1) {
        const cycle = 2 * len - 2;
        const j = a.idx % cycle;
        i = j < len ? j : cycle - j;
      } else i = 0;
    } else if (s.arp_mode === ARP_RANDOM) i = Math.min(len - 1, Math.floor(random_unit() * len));
    else i = a.idx % len;
    a.idx++;
    const oct = Math.floor(i / n);
    const k = i - oct * n;
    a.new_key[0] = a.ord_key[k] + oct * s.tuning.size + s.transpose;
    a.new_vel[0] = a.ord_vel[k];
    m = 1;
  }
  // 1. notes struck again are released first (so they restart)
  for (let j = 0; j < a.snd_n; j++) {
    for (let i = 0; i < m; i++) {
      if (a.snd[j] === a.new_key[i]) {
        engine_off(s, a.snd[j]);
        a.snd[j] = -1000;
      }
    }
  }
  // 2. new notes, 3. then the rest of the old ones (overlapping, so Legato mode slurs at gate 1)
  for (let i = 0; i < m; i++) engine_on(s, a.new_key[i], a.new_key[i], a.new_vel[i]);
  for (let j = 0; j < a.snd_n; j++) if (a.snd[j] !== -1000) engine_off(s, a.snd[j]);
  for (let i = 0; i < m; i++) a.snd[i] = a.new_key[i];
  a.snd_n = m;
}

/** Once per sample (before the voices render). */
function arp_tick(s) {
  const a = s.arp;
  const pos = s.beat / s.arp_step_beats;
  const k = Math.floor(pos + 0.000001);
  let fired = 0;
  if (a.n > 0 && k !== a.last) {
    const odd = k - 2 * Math.floor(k / 2);
    const start = k + odd * s.arp_swing;
    if (pos >= start - 0.000001) {
      a.last = k;
      const step = k - s.arp_steps * Math.floor(k / s.arp_steps);
      if (s.arp_pattern[step]) {
        fired = 1;
        a.off_pos = start + s.arp_gate * (odd ? 1 - s.arp_swing : 1 + s.arp_swing);
        arp_fire(s);
      }
    }
  }
  // end of the gate (also when the host jumped back, e.g. a loop)
  if (!fired && a.snd_n > 0 && (pos >= a.off_pos - 0.000001 || pos < a.off_pos - 4)) arp_release(s);
}

// ---------------------------------------------------------------------------
// MIDI input

export function synth_note_on(s, note, velocity) {
  if (velocity <= 0) {
    synth_note_off(s, note);
    return;
  }
  if (s.arp_mode > 0) arp_key_on(s, note, velocity);
  else engine_on(s, note, note + s.transpose, velocity);
}

export function synth_note_off(s, note) {
  if (s.arp_mode > 0) arp_key_off(s, note);
  else engine_off(s, note);
}

/** Release every voice and forget held keys (all-notes-off, arpeggiator switched on/off). */
function synth_release_all(s) {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    v.gate = 0;
    v.sustained = 0;
    adsr_gate_off(v.amp_env);
    adsr_gate_off(v.filt_env);
    adsr_gate_off(v.mod_env);
  }
  s.stack_n = 0;
  s.arp.n = 0;
  s.arp.snd_n = 0;
}

/** Control change (the ones not handled by synth_midi): the cutoff CC. */
export function synth_cc(s, number, value) {
  if (s.cc_cutoff_num > 0 && number === s.cc_cutoff_num) {
    s.cc_cutoff_value = value;
    s.cc_mult = Math.pow(2, clamp((value - 64) / 63, -1, 1) * s.p.cc_cutoff_depth_oct);
  }
}

export function synth_all_notes_off(s) {
  synth_release_all(s);
}

/** value -1..1 */
export function synth_pitch_bend(s, value) {
  s.bend = clamp(value, -1, 1);
}

/** value 0..1 */
export function synth_mod_wheel(s, value) {
  s.modwheel = clamp(value, 0, 1);
}

/** Channel pressure (MIDI 0xD0), value 0..1: the Pressure source of every note. */
export function synth_channel_pressure(s, value) {
  s.pressure = clamp(value, 0, 1);
}

/** Polyphonic aftertouch (MIDI 0xA0), value 0..1: the Pressure source of the voice playing `key`. */
export function synth_poly_pressure(s, key, value) {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    if (v.active && v.note === key) v.poly_at = clamp(value, 0, 1);
  }
}

export function synth_sustain_pedal(s, on) {
  s.sustain_pedal = on ? 1 : 0;
  if (!on) {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = s.voices[i];
      if (v.sustained) {
        v.sustained = 0;
        adsr_gate_off(v.amp_env);
        adsr_gate_off(v.filt_env);
        adsr_gate_off(v.mod_env);
      }
    }
  }
}

/** Render one stereo sample into s.out_l / s.out_r (JSFX @sample -> spl0/spl1). */
export function synth_render(s) {
  const p = s.p;
  const sr = s.sr;

  if (s.arp_mode > 0) arp_tick(s);

  // ---- global modulation (once per sample)
  let lfo;
  if (s.lfo_sync_beats > 0) {
    let ph = s.beat / s.lfo_sync_beats;
    ph -= Math.floor(ph);
    lfo = lfo_process_at(s.lfo, p.lfo_waveform, ph);
  } else {
    lfo = lfo_process(s.lfo, p.lfo_waveform);
  }

  // ---- mod matrix, global part: LFO 1 / LFO 2 / mod wheel for every destination, channel
  // pressure for the global ones (LFO rates). The rates take effect from the next sample.
  const mm = s.mm_n;
  const mg = s.mm_g;
  if (mm > 0) {
    const lfo2 = s.mm_use[SRC_LFO2] ? lfo2_tick(s, p.lfo2_waveform) : 0;
    if (s.mm_use[SRC_PRESS]) s.press_g += (s.pressure - s.press_g) * s.press_a;
    for (let d = 0; d < N_DST; d++) mg[d] = 0;
    for (let j = 0; j < mm; j++) {
      const src = s.mm_src[j];
      const dst = s.mm_dst[j];
      if (src === SRC_LFO1) mg[dst] += lfo * s.mm_amt[j];
      else if (src === SRC_LFO2) mg[dst] += lfo2 * s.mm_amt[j];
      else if (src === SRC_WHEEL) mg[dst] += s.modwheel * s.mm_amt[j];
      else if (src === SRC_PRESS && dst >= DST_LFO1_RATE && dst <= DST_LFO2_RATE) mg[dst] += s.press_g * s.mm_amt[j];
    }
    if (s.mm_has[DST_LFO1_RATE]) s.lfo.inc = s.lfo_inc * Math.pow(2, mg[DST_LFO1_RATE]);
    if (s.mm_has[DST_LFO2_RATE]) s.lfo2.inc = s.lfo2_inc * Math.pow(2, mg[DST_LFO2_RATE]);
  }
  const mv = s.mm_v;
  const m_pitch = mm > 0 && s.mm_has[DST_PITCH];
  const m_res = mm > 0 && s.mm_has[DST_RES];
  const m_pw = mm > 0 && s.mm_has[DST_PW];
  const m_osc2 = mm > 0 && s.mm_has[DST_OSC2];
  const m_fm = mm > 0 && s.mm_has[DST_FM];
  const m_amp = mm > 0 && s.mm_has[DST_AMP];
  const m_pan = mm > 0 && s.mm_has[DST_PAN];
  const m_noise = mm > 0 && s.mm_has[DST_NOISE];
  const m_press = mm > 0 && s.mm_use[SRC_PRESS];
  const pitch_cents = s.bend * p.pitch_bend_range_cents + lfo * (p.lfo_pitch_cents + s.modwheel * p.modwheel_vibrato_cents);
  const pitch_ratio = Math.pow(2, pitch_cents / 1200);
  const osc2_cents = p.osc2_transpose_cents + p.osc2_detune_cents;
  const osc2_env = p.osc2_env_pitch_cents;
  const osc2_ratio = Math.pow(2, osc2_cents / 1200);
  const cutoff = smoother_process(s.cutoff_smooth, s.cutoff_target * s.cc_mult);
  const lfo_filter_oct = lfo * (p.lfo_filter_oct + s.modwheel * p.modwheel_filter_oct);
  const pw_mod = lfo * p.lfo_pulse_width;
  let pw1 = clamp(p.osc1_pulse_width + pw_mod, 0.02, 0.98);
  let pw2 = clamp(p.osc2_pulse_width + pw_mod, 0.02, 0.98);
  const tremolo = 1 - p.lfo_amp * (0.5 - 0.5 * lfo);
  let k = s.filter_k;
  const slope24 = p.filter_slope >= 0.5;
  const mode = p.filter_mode;
  const w1 = p.osc1_waveform;
  const w2 = p.osc2_waveform;
  const l1 = p.osc1_level;
  const l2 = p.osc2_level;
  const sync = p.osc2_hard_sync >= 0.5;
  let fm = s.fm_cycles;
  const un = s.unison_n;
  const stereo = s.stereo;
  const drive = p.filter_drive > 0;

  let mix_l = 0;
  let mix_r = 0;
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) continue;

    let hz = v.base_hz * pitch_ratio;
    if (v.glide_oct !== 0) {
      hz *= Math.pow(2, v.glide_oct);
      v.glide_oct *= s.glide_coef;
      if (Math.abs(v.glide_oct) < 0.0001) v.glide_oct = 0;
    }
    const fenv = adsr_process(v.filt_env);
    const menv = adsr_process(v.mod_env);

    // ---- mod matrix, per voice: the global sums plus this note's own sources
    if (mm > 0) {
      if (m_press) v.press += (Math.max(s.pressure, v.poly_at) - v.press) * s.press_a;
      for (let d = 0; d < N_DST; d++) mv[d] = mg[d];
      for (let j = 0; j < mm; j++) {
        const src = s.mm_src[j];
        const dst = s.mm_dst[j];
        if (dst >= DST_LFO1_RATE && dst <= DST_LFO2_RATE) continue; // global only
        if (src === SRC_MENV) mv[dst] += menv * s.mm_amt[j];
        else if (src === SRC_VEL) mv[dst] += v.velocity * s.mm_amt[j];
        else if (src === SRC_KEY) mv[dst] += (Math.log(v.base_hz / 261.6256) / Math.LN2) * s.mm_amt[j];
        else if (src === SRC_PRESS) mv[dst] += v.press * s.mm_amt[j];
        else if (src === SRC_RAND) mv[dst] += v.rnd * s.mm_amt[j];
      }
      if (m_pitch) hz *= Math.pow(2, mv[DST_PITCH] / 1200);
      if (m_res) k = 2 - 1.98 * Math.sqrt(clamp(p.filter_resonance + mv[DST_RES], 0, 1));
      if (m_pw) {
        pw1 = clamp(p.osc1_pulse_width + pw_mod + mv[DST_PW], 0.02, 0.98);
        pw2 = clamp(p.osc2_pulse_width + pw_mod + mv[DST_PW], 0.02, 0.98);
      }
      if (m_fm) fm = Math.max(0, p.fm_index + mv[DST_FM]) / TWO_PI;
    }
    const r2 = m_osc2 ? Math.pow(2, (osc2_cents + fenv * osc2_env + mv[DST_OSC2]) / 1200)
      : osc2_env !== 0 ? Math.pow(2, (osc2_cents + fenv * osc2_env) / 1200) : osc2_ratio;

    // ---- oscillators (x unison)
    let xl = 0;
    let xr = 0;
    for (let u = 0; u < un; u++) {
      const o1 = v.osc1[u];
      const o2 = v.osc2[u];
      const f = hz * s.unison_ratio[u];
      osc_set_freq(o1, f, sr);
      osc_set_freq(o2, f * r2, sr);
      // FM uses osc2's previous sample so that sync (osc1 -> osc2) and FM (osc2 -> osc1) can coexist
      const y1 = osc_process(o1, w1, pw1, fm * v.prev2[u]);
      if (sync && o1.wrapped) osc_sync_to(o2, o1);
      const y2 = osc_process(o2, w2, pw2, 0);
      v.prev2[u] = y2;
      const y = (y1 * l1 + y2 * l2) * s.unison_w[u];
      if (stereo) {
        xl += y * s.unison_gl[u];
        xr += y * s.unison_gr[u];
      } else {
        xl += y;
      }
    }
    xl *= s.unison_norm;
    xr *= s.unison_norm;

    let common = 0;
    const nlev = m_noise ? clamp(p.noise_level + mv[DST_NOISE], 0, 1) : p.noise_level;
    if (p.sub_osc_level > 0) {
      osc_set_freq(v.sub, hz * 0.5, sr);
      common += osc_process(v.sub, 1, 0.5, 0) * p.sub_osc_level;
    }
    if (nlev > 0) {
      let nz = s.noise_type === 0 ? noise_white() : voice_noise(s, v, hz);
      if (s.noise_filter > 0) {
        svf_process(v.nz_filt, nz);
        nz = svf_output(v.nz_filt, s.noise_filter - 1);
      }
      common += nz * nlev;
    }
    xl += common;
    if (stereo) xr += common;
    if (drive) {
      xl = soft_clip(xl * s.drive_gain) * s.drive_makeup;
      if (stereo) xr = soft_clip(xr * s.drive_gain) * s.drive_makeup;
    }

    // ---- filter
    const env_scale = 1 - p.filter_velocity_amount + p.filter_velocity_amount * v.velocity;
    let oct = fenv * p.filter_env_amount_oct * env_scale + lfo_filter_oct;
    if (mm > 0) oct += mv[DST_CUTOFF];
    // key tracking relative to middle C (261.63 Hz), works for any tuning
    const fc = cutoff * Math.pow(2, oct) * Math.pow(v.base_hz / 261.6256, p.filter_key_tracking);

    let yl;
    let yr = 0;
    if (slope24) {
      svf_set(v.filt_l1, fc, 1.414, sr);
      svf_set(v.filt_l2, fc, k, sr);
      svf_process(v.filt_l1, xl);
      svf_process(v.filt_l2, svf_output(v.filt_l1, mode));
      yl = svf_output(v.filt_l2, mode);
      if (stereo) {
        svf_copy_coefs(v.filt_r1, v.filt_l1);
        svf_copy_coefs(v.filt_r2, v.filt_l2);
        svf_process(v.filt_r1, xr);
        svf_process(v.filt_r2, svf_output(v.filt_r1, mode));
        yr = svf_output(v.filt_r2, mode);
      }
    } else {
      svf_set(v.filt_l1, fc, k, sr);
      svf_process(v.filt_l1, xl);
      yl = svf_output(v.filt_l1, mode);
      if (stereo) {
        svf_copy_coefs(v.filt_r1, v.filt_l1);
        svf_process(v.filt_r1, xr);
        yr = svf_output(v.filt_r1, mode);
      }
    }

    // ---- amp
    const aenv = adsr_process(v.amp_env);
    let g = aenv * (1 - p.amp_velocity_amount + p.amp_velocity_amount * v.velocity);
    if (m_amp) g *= Math.pow(10, Math.min(mv[DST_AMP], 24) / 20);
    if (m_pan) {
      pan_gains(s.pan, mv[DST_PAN]);
      mix_l += yl * g * s.pan.gl;
      mix_r += (stereo ? yr : yl) * g * s.pan.gr;
    } else {
      mix_l += yl * g;
      mix_r += (stereo ? yr : yl) * g;
    }

    if (v.amp_env.stage === 0) {
      v.active = 0;
      v.note = -1;
    }
  }

  const g = smoother_process(s.gain_smooth, s.master_gain) * 0.5 * tremolo;
  s.out_l = soft_clip(mix_l * g);
  s.out_r = soft_clip(mix_r * g);
  s.beat += s.beat_inc;
}
