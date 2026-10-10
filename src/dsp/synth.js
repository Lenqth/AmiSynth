// AmiSynth polyphonic subtractive synth core.
// Pure DSP: no Web Audio dependencies, runs in an AudioWorklet or in Node tests.
// Structure mirrors a JSFX plugin:
//   synth_init        -> @init
//   synth_update      -> @slider   (p = slider values keyed by param id)
//   synth_note_on/off -> @block MIDI handling (midirecv)
//   synth_render      -> @sample   (one call per sample)

import {
  adsr_gate_off, adsr_gate_on, adsr_init, adsr_process, adsr_set,
  clamp, db_to_gain, noise_white, osc_init, osc_process, osc_reset, osc_set_freq,
  smoother_init, smoother_process, smoother_set, soft_clip,
  svf_init, svf_process, svf_reset, svf_set, tuning_init, tuning_note_to_hz, tuning_set_edo,
  tuning_set_table, TWO_PI,
} from './lib.js';

export const MAX_VOICES = 8;

function voice_create() {
  const v = {
    active: 0, // 1 while the amp envelope runs
    note: -1,
    gate: 0, // key held
    sustained: 0, // released while sustain pedal held
    velocity: 0,
    age: 0, // allocation counter for voice stealing
    base_hz: 0,
    osc1: {}, osc2: {},
    filt1: {}, filt2: {},
    amp_env: {}, filt_env: {},
  };
  osc_init(v.osc1);
  osc_init(v.osc2);
  svf_init(v.filt1);
  svf_init(v.filt2);
  adsr_init(v.amp_env);
  adsr_init(v.filt_env);
  return v;
}

export function synth_init(s, sr) {
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
  s.lfo_phase = 0;
  s.cutoff_smooth = {};
  smoother_init(s.cutoff_smooth, 1000);
  smoother_set(s.cutoff_smooth, 15, sr);
  s.gain_smooth = {};
  smoother_init(s.gain_smooth, 0);
  smoother_set(s.gain_smooth, 20, sr);
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
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    adsr_set(v.amp_env, p.amp_attack_ms, p.amp_decay_ms, p.amp_sustain, p.amp_release_ms, s.sr);
    adsr_set(v.filt_env, p.filter_env_attack_ms, p.filter_env_decay_ms, p.filter_env_sustain, p.filter_env_release_ms, s.sr);
    if (v.active) v.base_hz = tuning_note_to_hz(s.tuning, v.note);
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

function voice_allocate(s) {
  const n = clamp(Math.round(s.p.voice_count || MAX_VOICES), 1, MAX_VOICES);
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

export function synth_note_on(s, note, velocity) {
  if (velocity <= 0) {
    synth_note_off(s, note);
    return;
  }
  const n = clamp(Math.round(s.p.voice_count || MAX_VOICES), 1, MAX_VOICES);
  // Retrigger a voice already playing this note, otherwise allocate.
  let idx = -1;
  for (let i = 0; i < n; i++) if (s.voices[i].active && s.voices[i].note === note) idx = i;
  if (idx < 0) idx = voice_allocate(s);
  const v = s.voices[idx];
  if (!v.active) {
    osc_reset(v.osc1, 0);
    osc_reset(v.osc2, Math.random()); // free-running feel for the detuned osc
    svf_reset(v.filt1);
    svf_reset(v.filt2);
    v.amp_env.value = 0;
    v.filt_env.value = 0;
  }
  v.active = 1;
  v.gate = 1;
  v.sustained = 0;
  v.note = note;
  v.velocity = velocity / 127;
  v.age = ++s.age_counter;
  v.base_hz = tuning_note_to_hz(s.tuning, note);
  adsr_gate_on(v.amp_env);
  adsr_gate_on(v.filt_env);
}

export function synth_note_off(s, note) {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    if (v.active && v.gate && v.note === note) {
      v.gate = 0;
      if (s.sustain_pedal) {
        v.sustained = 1;
      } else {
        adsr_gate_off(v.amp_env);
        adsr_gate_off(v.filt_env);
      }
    }
  }
}

export function synth_all_notes_off(s) {
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    v.gate = 0;
    v.sustained = 0;
    adsr_gate_off(v.amp_env);
    adsr_gate_off(v.filt_env);
  }
}

/** value -1..1 */
export function synth_pitch_bend(s, value) {
  s.bend = clamp(value, -1, 1);
}

/** value 0..1 */
export function synth_mod_wheel(s, value) {
  s.modwheel = clamp(value, 0, 1);
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
      }
    }
  }
}

/** Render one stereo sample into s.out_l / s.out_r (JSFX @sample -> spl0/spl1). */
export function synth_render(s) {
  const p = s.p;
  const sr = s.sr;

  // Global modulation
  const lfo = Math.sin(TWO_PI * s.lfo_phase);
  s.lfo_phase += s.lfo_inc;
  if (s.lfo_phase >= 1) s.lfo_phase -= 1;
  const pitch_cents = s.bend * p.pitch_bend_range_cents + lfo * s.modwheel * p.modwheel_vibrato_cents;
  const pitch_ratio = Math.pow(2, pitch_cents / 1200);
  const osc2_ratio = Math.pow(2, (p.osc2_transpose_cents + p.osc2_detune_cents) / 1200);
  const cutoff = smoother_process(s.cutoff_smooth, s.cutoff_target);
  const lfo_filter_oct = lfo * s.modwheel * p.modwheel_filter_oct;
  const k = s.filter_k;
  const slope24 = p.filter_slope >= 0.5;
  const w1 = p.osc1_waveform;
  const w2 = p.osc2_waveform;

  let mix = 0;
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) continue;

    const hz = v.base_hz * pitch_ratio;
    osc_set_freq(v.osc1, hz, sr);
    osc_set_freq(v.osc2, hz * osc2_ratio, sr);
    let x = osc_process(v.osc1, w1) * p.osc1_level + osc_process(v.osc2, w2) * p.osc2_level;
    if (p.noise_level > 0) x += noise_white() * p.noise_level;

    const fenv = adsr_process(v.filt_env);
    const env_scale = 1 - p.filter_velocity_amount + p.filter_velocity_amount * v.velocity;
    const oct = fenv * p.filter_env_amount_oct * env_scale + lfo_filter_oct;
    // key tracking relative to middle C (261.63 Hz), works for any tuning
    const fc = cutoff * Math.pow(2, oct) * Math.pow(v.base_hz / 261.6256, p.filter_key_tracking);

    let y;
    if (slope24) {
      svf_set(v.filt1, fc, 1.414, sr);
      svf_set(v.filt2, fc, k, sr);
      y = svf_process(v.filt2, svf_process(v.filt1, x));
    } else {
      svf_set(v.filt1, fc, k, sr);
      y = svf_process(v.filt1, x);
    }

    const aenv = adsr_process(v.amp_env);
    const vel_gain = 1 - p.amp_velocity_amount + p.amp_velocity_amount * v.velocity;
    mix += y * aenv * vel_gain;

    if (v.amp_env.stage === 0) {
      v.active = 0;
      v.note = -1;
    }
  }

  const g = smoother_process(s.gain_smooth, s.master_gain);
  const out = soft_clip(mix * 0.5 * g);
  s.out_l = out;
  s.out_r = out;
}
