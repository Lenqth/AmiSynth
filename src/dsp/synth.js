// AmiSynth polyphonic subtractive synth core.
// Pure DSP: no Web Audio dependencies, runs in an AudioWorklet or in Node tests.
// Structure mirrors a JSFX plugin:
//   synth_init        -> @init
//   synth_update      -> @slider   (p = slider values keyed by param id)
//   synth_note_on/off -> @block MIDI handling (midirecv)
//   synth_render      -> @sample   (one call per sample)
//
// Signal flow per voice:
//   [osc1 + osc2] x unison (detuned, panned) + sub + noise -> drive -> SVF (12/24 dB, LP/HP/BP/notch) -> amp env
//   osc2 can hard-sync to osc1 and phase-modulate osc1 (FM). The filter envelope can bend osc2 pitch.

import {
  adsr_gate_off, adsr_gate_on, adsr_init, adsr_process, adsr_set,
  clamp, db_to_gain, lfo_init, lfo_process, noise_seed, noise_white, random_unit, osc_init, osc_process, osc_reset, osc_set_freq,
  osc_sync_to, smoother_init, smoother_process, smoother_set, soft_clip, svf_copy_coefs,
  svf_init, svf_output, svf_process, svf_reset, svf_set, tau_coef, TWO_PI, tuning_init, tuning_note_to_hz,
  tuning_set_edo, tuning_set_table,
} from './lib.js';

export const MAX_VOICES = 8;
export const MAX_UNISON = 4;

function voice_create() {
  const v = {
    active: 0, // 1 while the amp envelope runs
    note: -1,
    gate: 0, // key held
    sustained: 0, // released while sustain pedal held
    velocity: 0,
    age: 0, // allocation counter for voice stealing
    base_hz: 0,
    glide_oct: 0, // pitch offset that decays to 0 (portamento)
    osc1: [], osc2: [], prev2: [], // per unison copy (JSFX: arrays in memory)
    sub: {},
    filt_l1: {}, filt_l2: {}, filt_r1: {}, filt_r2: {},
    amp_env: {}, filt_env: {},
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
  return v;
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
  s.cutoff_smooth = {};
  smoother_init(s.cutoff_smooth, 1000);
  smoother_set(s.cutoff_smooth, 15, sr);
  s.gain_smooth = {};
  smoother_init(s.gain_smooth, 0);
  smoother_set(s.gain_smooth, 20, sr);
  s.unison_ratio = [1, 1, 1, 1];
  s.unison_gl = [1, 1, 1, 1];
  s.unison_gr = [1, 1, 1, 1];
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
  s.lfo.inc = p.lfo_rate_hz / s.sr;
  s.glide_coef = p.glide_ms > 0 ? tau_coef(p.glide_ms / 3, s.sr) : 0; // ~95% there after glide_ms
  s.drive_gain = 1 + 8 * p.filter_drive;
  s.drive_makeup = 1 / (1 + 1.5 * p.filter_drive);
  s.fm_cycles = p.fm_index / TWO_PI;

  // Unison: copies spread evenly over +/- detune/2, panned across the stereo width.
  const n = clamp(Math.round(p.unison_voices), 1, MAX_UNISON);
  s.unison_n = n;
  s.unison_norm = 1 / Math.sqrt(n);
  for (let u = 0; u < MAX_UNISON; u++) {
    const pos = n > 1 ? u / (n - 1) - 0.5 : 0; // -0.5..0.5
    s.unison_ratio[u] = Math.pow(2, (pos * p.unison_detune_cents) / 1200);
    const a = (pos * p.unison_stereo_width + 0.5) * 0.5 * Math.PI; // 0..pi/2
    s.unison_gl[u] = Math.cos(a) * 1.41421356;
    s.unison_gr[u] = Math.sin(a) * 1.41421356;
  }
  s.stereo = n > 1 && p.unison_stereo_width > 0 ? 1 : 0;

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
  const hz = tuning_note_to_hz(s.tuning, note);
  if (!v.active) {
    const spread = s.unison_n > 1;
    for (let u = 0; u < MAX_UNISON; u++) {
      // random phases make unison copies sound like a section instead of flanging in sync
      osc_reset(v.osc1[u], spread ? random_unit() : 0);
      osc_reset(v.osc2[u], random_unit());
      v.prev2[u] = 0;
    }
    osc_reset(v.sub, 0);
    svf_reset(v.filt_l1);
    svf_reset(v.filt_l2);
    svf_reset(v.filt_r1);
    svf_reset(v.filt_r2);
    v.amp_env.value = 0;
    v.filt_env.value = 0;
  }
  // Glide from the last played pitch (in octaves, decays to 0 in synth_render).
  v.glide_oct = s.glide_coef > 0 && s.last_hz > 0 ? clamp(Math.log2(s.last_hz / hz), -8, 8) : 0;
  s.last_hz = hz;
  v.active = 1;
  v.gate = 1;
  v.sustained = 0;
  v.note = note;
  v.velocity = velocity / 127;
  v.age = ++s.age_counter;
  v.base_hz = hz;
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

  // ---- global modulation (once per sample)
  const lfo = lfo_process(s.lfo, p.lfo_waveform);
  const pitch_cents = s.bend * p.pitch_bend_range_cents + lfo * (p.lfo_pitch_cents + s.modwheel * p.modwheel_vibrato_cents);
  const pitch_ratio = Math.pow(2, pitch_cents / 1200);
  const osc2_cents = p.osc2_transpose_cents + p.osc2_detune_cents;
  const osc2_env = p.osc2_env_pitch_cents;
  const osc2_ratio = Math.pow(2, osc2_cents / 1200);
  const cutoff = smoother_process(s.cutoff_smooth, s.cutoff_target);
  const lfo_filter_oct = lfo * (p.lfo_filter_oct + s.modwheel * p.modwheel_filter_oct);
  const pw_mod = lfo * p.lfo_pulse_width;
  const pw1 = clamp(p.osc1_pulse_width + pw_mod, 0.02, 0.98);
  const pw2 = clamp(p.osc2_pulse_width + pw_mod, 0.02, 0.98);
  const tremolo = 1 - p.lfo_amp * (0.5 - 0.5 * lfo);
  const k = s.filter_k;
  const slope24 = p.filter_slope >= 0.5;
  const mode = p.filter_mode;
  const w1 = p.osc1_waveform;
  const w2 = p.osc2_waveform;
  const l1 = p.osc1_level;
  const l2 = p.osc2_level;
  const sync = p.osc2_hard_sync >= 0.5;
  const fm = s.fm_cycles;
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
    const r2 = osc2_env !== 0 ? Math.pow(2, (osc2_cents + fenv * osc2_env) / 1200) : osc2_ratio;

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
      const y = y1 * l1 + y2 * l2;
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
    if (p.sub_osc_level > 0) {
      osc_set_freq(v.sub, hz * 0.5, sr);
      common += osc_process(v.sub, 1, 0.5, 0) * p.sub_osc_level;
    }
    if (p.noise_level > 0) common += noise_white() * p.noise_level;
    xl += common;
    if (stereo) xr += common;
    if (drive) {
      xl = soft_clip(xl * s.drive_gain) * s.drive_makeup;
      if (stereo) xr = soft_clip(xr * s.drive_gain) * s.drive_makeup;
    }

    // ---- filter
    const env_scale = 1 - p.filter_velocity_amount + p.filter_velocity_amount * v.velocity;
    const oct = fenv * p.filter_env_amount_oct * env_scale + lfo_filter_oct;
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
    const g = aenv * (1 - p.amp_velocity_amount + p.amp_velocity_amount * v.velocity);
    mix_l += yl * g;
    mix_r += (stereo ? yr : yl) * g;

    if (v.amp_env.stage === 0) {
      v.active = 0;
      v.note = -1;
    }
  }

  const g = smoother_process(s.gain_smooth, s.master_gain) * 0.5 * tremolo;
  s.out_l = soft_clip(mix_l * g);
  s.out_r = soft_clip(mix_r * g);
}
