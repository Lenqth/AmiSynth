// Modular factory patches built from Synth presets.
//
// A Synth preset is rebuilt from Modular modules that do the same thing: per-copy VCOs for
// unison, a VCO an octave down for the sub oscillator, VCO sync and phase-modulation inputs for
// hard sync and FM, a VCF with the same slope, drive, key tracking and resonance curve, two
// ADSRs scaled by velocity, and the MIDI module's voice mode and glide.
//
// Differences that remain by design: Modular is mono (no unison stereo spread), its LFO restarts
// with each voice instead of running globally, and performance controls
// (mod wheel, pitch-bend range) are not part of a patch. Anything else a preset changes throws,
// so a patch never silently sounds unlike its name.
import { SYNTH_PARAMS, defaultValues } from '../dsp/params.js';
import { SYNTH_PRESETS } from './synth.js';

const DEFAULTS = defaultValues(SYNTH_PARAMS);

// Parameters the conversion reproduces, or deliberately leaves out (see above).
const SUPPORTED = new Set([
  'osc1_waveform', 'osc1_pulse_width', 'osc1_level', 'osc2_waveform', 'osc2_pulse_width', 'osc2_level',
  'osc2_transpose_cents', 'osc2_detune_cents', 'sub_osc_level', 'noise_level', 'osc2_hard_sync',
  'osc2_env_pitch_cents', 'fm_index', 'filter_mode', 'filter_cutoff_hz', 'filter_resonance', 'filter_slope',
  'filter_drive', 'filter_env_amount_oct', 'filter_key_tracking', 'filter_velocity_amount',
  'filter_env_attack_ms', 'filter_env_decay_ms', 'filter_env_sustain', 'filter_env_release_ms',
  'amp_attack_ms', 'amp_decay_ms', 'amp_sustain', 'amp_release_ms', 'amp_velocity_amount',
  'lfo_waveform', 'lfo_rate_hz', 'lfo_pitch_cents', 'lfo_filter_oct', 'voice_count', 'glide_ms',
  'unison_voices', 'unison_detune_cents', 'unison_side_level', 'unison_detune_curve', 'master_volume_db',
  'voice_mode', 'glide_mode', 'lfo_amp', 'lfo_pulse_width', 'noise_filter_mode', 'noise_filter_hz',
  // Left out: performance controls and stereo.
  'modwheel_vibrato_cents', 'modwheel_filter_oct', 'pitch_bend_range_cents', 'unison_stereo_width', 'legato_window_ms',
]);
const LFO_WAVES = { 0: 'sine', 1: 'triangle', 4: 'sample-and-hold' };
// Synth waveforms: Saw, Pulse, Triangle, Sine. Modular VCO: Sine, Saw, Square, Triangle.
const VCO_WAVE = [1, 2, 3, 0];
// The Synth's triangle starts its cycle at -1, a quarter cycle before the VCO's.
const START = [0, 0, 0.75, 0];
// The Synth starts unison copies and osc2 at random phases. Fixed, golden-ratio-spaced starts keep
// them out of step the same way, and make every note sound alike.
const spaced = (base, u) => (base + u * 0.618034) % 1;
const COLUMN = 274, ROW = 300;

/** A Modular patch that plays a Synth preset's parameters. */
export function modularFromSynth(params) {
  const p = { ...DEFAULTS, ...params };
  for (const [key, value] of Object.entries(params))
    if (!SUPPORTED.has(key) && value !== DEFAULTS[key]) throw new Error(`Modular cannot play ${key}`);
  if (!(p.osc1_waveform in VCO_WAVE) || !(p.osc2_waveform in VCO_WAVE)) throw new Error('Modular cannot play wavetables');
  if (!(p.lfo_waveform in LFO_WAVES)) throw new Error('Modular cannot play this LFO waveform');

  const nodes = [], cables = [], rows = [0, 0, 0, 0, 0, 0];
  const node = (id, type, params, column) => {
    nodes.push({ id, type, params, position: { x: 22 + column * COLUMN, y: 22 + rows[column]++ * ROW } });
    return id;
  };
  const wire = (from, port, to, input) => cables.push({ from, port, to, input });
  const scale = (id, source, port, factor, offset, column) => {
    node(id, 'cv', { scale: factor, offset }, column);
    wire(source, port, id, 'in');
    return id;
  };
  // Sums any number of sources with Mixer (4) modules; returns the node carrying the total.
  const sum = (prefix, sources, column) => {
    let level = sources, round = 0;
    while (level.length > 1 || round === 0) {
      const next = [];
      for (let i = 0; i < level.length; i += 4) {
        const id = node(prefix + (round ? '_r' + round : '') + (i ? '_' + i / 4 : ''), 'mix4', { a: 0, b: 0, c: 0, d: 0 }, column);
        level.slice(i, i + 4).forEach(([source, port, gain], k) => {
          const input = 'abcd'[k];
          nodes.at(-1).params[input] = gain;
          wire(source, port, id, input);
        });
        next.push([id, 'out', 1]);
      }
      level = next;
      round++;
    }
    return level[0][0];
  };

  const mono = p.voice_mode >= 1 || p.voice_count === 1;
  node('note', 'midi', { voices: p.voice_mode >= 1 ? p.voice_mode : mono ? 1 : 0,
    glide: p.glide_ms / 1000, glideMode: p.glide_mode }, 0);

  // Envelopes, velocity and LFO.
  const env = (id, prefix) => node(id, 'adsr', {
    attack: Math.max(0.001, p[`${prefix}_attack_ms`] / 1000), decay: Math.max(0.001, p[`${prefix}_decay_ms`] / 1000),
    sustain: p[`${prefix}_sustain`], release: Math.max(0.001, p[`${prefix}_release_ms`] / 1000), curve: 1,
  }, 3);
  env('fenv', 'filter_env');
  wire('note', 'gate', 'fenv', 'gate');
  env('aenv', 'amp');
  wire('note', 'gate', 'aenv', 'gate');
  let lfo = null;
  const needsLfo = p.lfo_pitch_cents !== 0 || p.lfo_filter_oct !== 0 || p.lfo_amp !== 0 || p.lfo_pulse_width !== 0;
  if (needsLfo && LFO_WAVES[p.lfo_waveform] === 'sample-and-hold') lfo = node('lfo', 'sh', { rate: p.lfo_rate_hz }, 0);
  else if (needsLfo) lfo = node('lfo', 'lfo', { rate: p.lfo_rate_hz, depth: 1, wave: p.lfo_waveform }, 0);

  // Pitch modulation in octaves: the LFO on both oscillators, the filter envelope on osc2.
  const vibrato = lfo && p.lfo_pitch_cents ? scale('vibrato', lfo, 'out', p.lfo_pitch_cents / 1200, 0, 1) : null;
  let osc2Pitch = vibrato;
  if (p.osc2_env_pitch_cents) {
    const sweep = scale('sweep', 'fenv', 'out', p.osc2_env_pitch_cents / 1200, 0, 1);
    osc2Pitch = vibrato ? sum('pitchsum', [[vibrato, 'out', 1], [sweep, 'out', 1]], 1) : sweep;
  }

  // Oscillators, one pair per unison copy.
  const copies = Math.max(1, Math.round(p.unison_voices));
  let weights = 0;
  const weight = u => Math.abs(u - (copies - 1) / 2) < 0.75 ? 1 : p.unison_side_level;
  for (let u = 0; u < copies; u++) weights += weight(u) ** 2;
  const norm = 1 / Math.sqrt(weights);
  const tune = cents => {
    const octave = Math.max(-3, Math.min(3, Math.trunc(cents / 1200)));
    return { octave, detune: Math.round(cents - octave * 1200) };
  };
  const sources = [];
  const fm = p.fm_index > 0, sync = p.osc2_hard_sync >= 0.5;
  // LFO pulse-width modulation, shared by every pulse oscillator.
  const pwm = (base, id) => lfo && p.lfo_pulse_width ? scale(id, lfo, 'out', p.lfo_pulse_width, base, 0) : null;
  const pwm1 = p.osc1_waveform === 1 ? pwm(p.osc1_pulse_width, 'pwm') : null;
  const pwm2 = p.osc2_waveform === 1 ? pwm(p.osc2_pulse_width, 'pwm2') : null;
  for (let u = 0; u < copies; u++) {
    // Copies spread over +/- detune/2, bunched toward the centre by the curve.
    const pos = copies > 1 ? u / (copies - 1) - 0.5 : 0;
    const bunched = p.unison_detune_curve > 0
      ? (pos < 0 ? -0.5 : 0.5) * Math.pow(Math.abs(2 * pos), 1 + 2 * p.unison_detune_curve) : pos;
    const spread = bunched * p.unison_detune_cents;
    const suffix = copies > 1 ? String(u + 1) : '';
    const o1 = node('osc' + suffix, 'vco', { wave: VCO_WAVE[p.osc1_waveform], ...tune(spread), level: 1,
      pw: p.osc1_pulse_width, phase: Math.round(spaced(START[p.osc1_waveform], u) * 100) / 100 }, 1);
    const o2 = node('osc2' + (suffix ? '_' + suffix : ''), 'vco', { wave: VCO_WAVE[p.osc2_waveform],
      ...tune(spread + p.osc2_transpose_cents + p.osc2_detune_cents), level: 1, pw: p.osc2_pulse_width,
      phase: Math.round(spaced(START[p.osc2_waveform] + 0.37, u) * 100) / 100 }, 1);
    wire('note', 'pitch', o1, 'pitch');
    wire('note', 'pitch', o2, 'pitch');
    if (vibrato) wire(vibrato, 'out', o1, 'fm');
    if (osc2Pitch) wire(osc2Pitch, 'out', o2, 'fm');
    if (sync) wire(o1, 'sync', o2, 'sync');
    if (pwm1) wire(pwm1, 'out', o1, 'param:pw');
    if (pwm2) wire(pwm2, 'out', o2, 'param:pw');
    if (fm) wire(scale('index' + suffix, o2, 'out', p.fm_index, 0, 2), 'out', o1, 'pm');
    const gain = weight(u) * norm;
    if (p.osc1_level) sources.push([o1, 'out', p.osc1_level * gain]);
    if (p.osc2_level) sources.push([o2, 'out', p.osc2_level * gain]);
  }
  if (p.sub_osc_level) {
    node('sub', 'vco', { wave: 2, octave: -1, level: 1 }, 1);
    wire('note', 'pitch', 'sub', 'pitch');
    sources.push(['sub', 'out', p.sub_osc_level]);
  }
  if (p.noise_level) {
    node('noise', 'noise', { color: 0, level: 1 }, 1);
    if (p.noise_filter_mode > 0) {
      // The Synth's noise filter: a fixed SVF with k = 1.
      node('noisefilter', 'vcf', { cutoff: p.noise_filter_hz, resonance: 1 / 1.95, mode: p.noise_filter_mode - 1 }, 2);
      wire('noise', 'out', 'noisefilter', 'audio');
      sources.push(['noisefilter', 'out', p.noise_level]);
    } else sources.push(['noise', 'out', p.noise_level]);
  }
  if (sources.length === 0) throw new Error('The preset has no sound source');
  const mixed = sum('mix', sources, 2);

  // Filter: the same slope, drive, resonance curve and key tracking; cutoff CV adds 2 octaves per unit.
  node('filter', 'vcf', {
    cutoff: p.filter_cutoff_hz, mode: p.filter_mode, slope: p.filter_slope, drive: p.filter_drive,
    resonance: Math.min(0.95, 1.98 * Math.sqrt(p.filter_resonance) / 1.95), keytrack: p.filter_key_tracking,
  }, 4);
  wire(mixed, 'out', 'filter', 'audio');
  wire('note', 'pitch', 'filter', 'pitch');
  const cutoff = [];
  if (p.filter_env_amount_oct) {
    let source = 'fenv';
    if (p.filter_velocity_amount) {
      const velocity = scale('fvel', 'note', 'velocity', p.filter_velocity_amount, 1 - p.filter_velocity_amount, 0);
      node('fscale', 'ring', { level: 1 }, 3);
      wire('fenv', 'out', 'fscale', 'a');
      wire(velocity, 'out', 'fscale', 'b');
      source = 'fscale';
    }
    cutoff.push([scale('fdepth', source, 'out', p.filter_env_amount_oct / 2, 0, 3), 'out', 1]);
  }
  if (lfo && p.lfo_filter_oct) cutoff.push([scale('lfodepth', lfo, 'out', p.lfo_filter_oct / 2, 0, 3), 'out', 1]);
  if (cutoff.length) wire(cutoff.length === 1 ? cutoff[0][0] : sum('cutoff', cutoff, 3), 'out', 'filter', 'cutoff');

  // Amplifier with velocity, tremolo and master volume (the Synth halves its output).
  node('amp', 'vca', { level: Math.min(2, 0.5 * 10 ** (p.master_volume_db / 20)) }, 5);
  wire('filter', 'out', 'amp', 'audio');
  let gain = 'aenv';
  const multiply = (id, by) => {
    node(id, 'ring', { level: 1 }, 4);
    wire(gain, 'out', id, 'a');
    wire(by, 'out', id, 'b');
    gain = id;
  };
  if (p.amp_velocity_amount)
    multiply('ascale', scale('avel', 'note', 'velocity', p.amp_velocity_amount, 1 - p.amp_velocity_amount, 0));
  if (lfo && p.lfo_amp) multiply('tremolo', scale('tremolodepth', lfo, 'out', p.lfo_amp / 2, 1 - p.lfo_amp / 2, 3));
  wire(gain, 'out', 'amp', 'gain');
  node('out', 'output', { level: 1 }, 5);
  wire('amp', 'out', 'out', 'audio');
  return { nodes, cables };
}

/** Synth presets whose sound Modular reproduces, by name. */
export const MODULAR_SYNTH_PORTS = SYNTH_PRESETS.filter(preset => {
  try { modularFromSynth(preset.params); return true; } catch { return false; }
}).map(preset => ({ name: preset.name, patch: () => modularFromSynth(preset.params) }));
