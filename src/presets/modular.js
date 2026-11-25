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
import { DELAY_SYNC_BEATS, MOD_DESTINATIONS, MOD_SLOTS, MOD_SOURCES, PHYS_PARAMS, SYNTH_PARAMS, defaultValues } from '../dsp/params.js';
import { MATERIALS } from '../dsp/phys.js';
import { PHYS_PRESETS } from './phys.js';
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
  'osc1_wt_bank', 'osc1_wt_position', 'osc2_wt_bank', 'osc2_wt_position',
  'wt_position_lfo', 'wt_position_filter_env', 'wt_position_amp_env',
  'unison_voices', 'unison_detune_cents', 'unison_side_level', 'unison_detune_curve', 'master_volume_db',
  'voice_mode', 'glide_mode', 'lfo_amp', 'lfo_pulse_width', 'noise_filter_mode', 'noise_filter_hz',
  'lfo2_waveform', 'lfo2_rate_hz', 'mod_env_attack_ms', 'mod_env_decay_ms', 'mod_env_sustain', 'mod_env_release_ms',
  ...Array.from({ length: MOD_SLOTS }, (_, i) => ['source', 'destination', 'amount'].map(k => `mod${i + 1}_${k}`)).flat(),
  'fx_chorus_on', 'fx_chorus_mix', 'fx_chorus_rate_hz', 'fx_chorus_depth_ms',
  'fx_delay_on', 'fx_delay_mix', 'fx_delay_sync', 'fx_delay_time_ms', 'fx_delay_feedback', 'fx_delay_ping_pong', 'fx_delay_high_cut_hz',
  'fx_reverb_on', 'fx_reverb_mix', 'fx_reverb_decay_ms', 'fx_reverb_size', 'fx_reverb_damping',
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

// Patch Echo note values (MODULAR_ECHO_BEATS in dsp/modular.js, which imports this file).
const ECHO_BEATS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 0.125, 1 / 6, 0.375, 1 / 3, 2 / 3, 4 / 3, 3];
// Mod matrix destinations the conversion patches; the others throw.
const MOD_PATCHED = new Set(['Pitch', 'Filter Cutoff', 'Osc2 Pitch', 'FM Index', 'Pan', 'LFO 1 Rate',
  'Noise Level', 'Osc1 WT Position', 'Osc2 WT Position']);
// Freeverb's mean comb length; with the comb feedback it sets the decay time.
const REVERB_COMB_SECONDS = 1350 / 44100;
// How much louder (dB) Modular's Reverb at mix 1 is than the Synth reverb, measured with white
// noise against the dry level, by Synth decay (rows, ms) and size (columns 0, 0.3, 0.6, 0.9).
// The conversion turns the reverb's wet path down by this much.
const REVERB_DECAYS = [400, 700, 1200, 2000, 3000, 4500, 7000, 10000];
const REVERB_EXCESS_DB = [
  [2.4, 3.9, 5.7, 7.8], [2.4, 2.7, 3.6, 4.7], [3.7, 3.3, 3.5, 4.1], [5.2, 4.4, 4.3, 4.5],
  [6.6, 5.5, 5.2, 5.3], [8.0, 6.8, 6.4, 6.3], [9.6, 8.4, 7.9, 7.7], [11.0, 9.7, 9.2, 9.0],
];
// Linear interpolation in a table row, by fractional index (clamped to the ends).
const lerp = (values, x) => {
  const i = Math.max(0, Math.min(values.length - 2, Math.floor(x))), t = Math.max(0, Math.min(1, x - i));
  return values[i] * (1 - t) + values[i + 1] * t;
};
function reverbExcess(decayMs, size) {
  const logs = REVERB_DECAYS.map(Math.log), d = Math.log(decayMs);
  const row = Math.max(0, Math.min(logs.length - 2, logs.findLastIndex(value => value <= d)));
  return lerp(REVERB_EXCESS_DB.map(columns => lerp(columns, size / 0.3)), row + (d - logs[row]) / (logs[row + 1] - logs[row]));
}

/** A Modular patch that plays a Synth preset's parameters. */
export function modularFromSynth(params) {
  const p = { ...DEFAULTS, ...params };
  for (const [key, value] of Object.entries(params))
    if (!SUPPORTED.has(key) && value !== DEFAULTS[key]) throw new Error(`Modular cannot play ${key}`);
  if (![p.osc1_waveform, p.osc2_waveform].every(wave => wave === 4 || wave in VCO_WAVE))
    throw new Error('Modular cannot play this oscillator waveform');
  // Active mod matrix slots as [source name, destination name, amount].
  const slots = [];
  for (let i = 1; i <= MOD_SLOTS; i++) {
    const source = MOD_SOURCES[p[`mod${i}_source`]], destination = MOD_DESTINATIONS[p[`mod${i}_destination`]]?.name;
    if (source === 'Off' || destination === 'Off' || !p[`mod${i}_amount`]) continue;
    if (source === 'Sidechain') throw new Error('Modular cannot play the Sidechain modulation source');
    if (!MOD_PATCHED.has(destination)) throw new Error(`Modular cannot play the ${destination} modulation destination`);
    slots.push([source, destination, p[`mod${i}_amount`]]);
  }
  const uses = source => slots.some(slot => slot[0] === source);
  if (!(p.lfo_waveform in LFO_WAVES)) throw new Error('Modular cannot play this LFO waveform');
  if (uses('LFO 2') && !(p.lfo2_waveform in LFO_WAVES)) throw new Error('Modular cannot play this LFO 2 waveform');

  const nodes = [], cables = [], rows = [0, 0, 0, 0, 0, 0, 0];
  const node = (id, type, params, column) => {
    nodes.push({ id, type, params, position: { x: 22 + column * COLUMN, y: 22 + rows[column]++ * ROW } });
    return id;
  };
  const wire = (from, port, to, input) => cables.push({ from, port, to, input });
  const scale = (id, source, port, factor, offset, column) => {
    node(id, 'cv', { scale: factor, offset }, column);
    if (source) wire(source, port, id, 'in');
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
  // One signal from a list of [node, port] terms of gain 1: the term itself, or their sum.
  const total = (prefix, terms, column) => terms.length === 0 ? null
    : terms.length === 1 ? terms[0][0] : sum(prefix, terms.map(([id, port]) => [id, port, 1]), column);

  const mono = p.voice_mode >= 1 || p.voice_count === 1;
  node('note', 'midi', { voices: p.voice_mode >= 1 ? p.voice_mode : mono ? 1 : 0,
    glide: p.glide_ms / 1000, glideMode: p.glide_mode }, 0);

  // Envelopes, velocity and LFOs.
  const env = (id, prefix) => node(id, 'adsr', {
    attack: Math.max(0.001, p[`${prefix}_attack_ms`] / 1000), decay: Math.max(0.001, p[`${prefix}_decay_ms`] / 1000),
    sustain: p[`${prefix}_sustain`], release: Math.max(0.001, p[`${prefix}_release_ms`] / 1000), curve: 1,
  }, 3);
  env('fenv', 'filter_env');
  wire('note', 'gate', 'fenv', 'gate');
  env('aenv', 'amp');
  wire('note', 'gate', 'aenv', 'gate');
  const lfoNode = (id, wave, rate) => LFO_WAVES[wave] === 'sample-and-hold'
    ? node(id, 'sh', { rate }, 0) : node(id, 'lfo', { rate, depth: 1, wave }, 0);
  let lfo = null;
  const usesTables = p.osc1_waveform === 4 || p.osc2_waveform === 4;
  const needsLfo = p.lfo_pitch_cents !== 0 || p.lfo_filter_oct !== 0 || p.lfo_amp !== 0 ||
    p.lfo_pulse_width !== 0 || (usesTables && p.wt_position_lfo !== 0) || uses('LFO 1');
  if (needsLfo) lfo = lfoNode('lfo', p.lfo_waveform, p.lfo_rate_hz);

  // Mod matrix sources, each a [node, port] with the Synth's range.
  const sources = {};
  if (uses('LFO 2')) sources['LFO 2'] = [lfoNode('lfo2', p.lfo2_waveform, p.lfo2_rate_hz), 'out'];
  if (uses('LFO 1')) sources['LFO 1'] = [lfo, 'out'];
  if (uses('Mod Env')) {
    sources['Mod Env'] = [env('menv', 'mod_env'), 'out'];
    wire('note', 'gate', 'menv', 'gate');
  }
  sources['Velocity'] = ['note', 'velocity'];
  sources['Mod Wheel'] = ['note', 'mod'];
  sources['Pressure'] = ['note', 'pressure'];
  // Key Track: octaves from middle C.
  if (uses('Key Track')) sources['Key Track'] = [scale('keytrack', 'note', 'pitch', 1 / 12, -5, 0), 'out'];
  // Random (per note): new noise held from each note-on.
  if (uses('Random (per note)')) {
    sources['Random (per note)'] = [node('random', 'sh', { rate: 0.01 }, 0), 'out'];
    wire('note', 'gate', 'random', 'trigger');
  }
  // CV terms for one destination, each scaled from the destination's unit by `unit`.
  let termCount = 0;
  const modTerms = (destination, unit, column) => slots.filter(slot => slot[1] === destination)
    .map(([source, , amount]) => [scale('mod' + ++termCount, ...sources[source], amount * unit, 0, column), 'out']);

  // Pitch modulation in octaves: the LFO and Pitch slots on both oscillators, the filter envelope
  // and Osc2 Pitch slots on osc2.
  const pitchTerms = modTerms('Pitch', 1 / 1200, 1);
  if (lfo && p.lfo_pitch_cents) pitchTerms.unshift([scale('vibrato', lfo, 'out', p.lfo_pitch_cents / 1200, 0, 1), 'out']);
  const pitchMod = total('pitchmod', pitchTerms, 1);
  const osc2Terms = [...(pitchMod ? [[pitchMod, 'out']] : []), ...modTerms('Osc2 Pitch', 1 / 1200, 1)];
  if (p.osc2_env_pitch_cents) osc2Terms.push([scale('sweep', 'fenv', 'out', p.osc2_env_pitch_cents / 1200, 0, 1), 'out']);
  const osc2Pitch = total('pitchsum', osc2Terms, 1);

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
  const audio = [];
  const sync = p.osc2_hard_sync >= 0.5;
  // FM index: the knob plus FM Index slots, multiplied into osc2's output per copy.
  const indexTerms = modTerms('FM Index', 1, 2);
  const fm = p.fm_index > 0 || indexTerms.length > 0;
  const fmIndex = indexTerms.length ? sum('fmindex', [[scale('fmbase', null, null, 0, p.fm_index, 2), 'out', 1],
    ...indexTerms.map(([id, port]) => [id, port, 1])], 2) : null;
  // LFO pulse-width modulation, shared by every pulse oscillator.
  const pwm = (base, id) => lfo && p.lfo_pulse_width ? scale(id, lfo, 'out', p.lfo_pulse_width, base, 0) : null;
  const pwm1 = p.osc1_waveform === 1 ? pwm(p.osc1_pulse_width, 'pwm') : null;
  const pwm2 = p.osc2_waveform === 1 ? pwm(p.osc2_pulse_width, 'pwm2') : null;
  const tableModulation = usesTables ? [
    [lfo, p.wt_position_lfo], ['fenv', p.wt_position_filter_env], ['aenv', p.wt_position_amp_env],
  ].filter(([source, depth]) => source && depth).map(([source, depth], index) =>
    [scale('wt_depth' + index, source, 'out', depth, 0, 2), 'out']) : [];
  const sharedPosition = total('wt_position', tableModulation, 2);
  const wavePosition = [1, 2].map(i => {
    if (p['osc' + i + '_waveform'] !== 4) return null;
    const own = modTerms('Osc' + i + ' WT Position', 1, 2);
    const modulation = own.length ? total('wt_position_osc' + i, [...(sharedPosition ? [[sharedPosition, 'out']] : []), ...own], 2)
      : sharedPosition;
    return modulation ? scale('wt_scan' + i, modulation, 'out', 1, p['osc' + i + '_wt_position'], 2) : null;
  });
  function oscillator(id, index, cents, phase) {
    const prefix = 'osc' + index + '_';
    const waveform = p[prefix + 'waveform'];
    const { octave, detune } = tune(cents);
    if (waveform === 4) {
      node(id, 'wavetable', { bank: p[prefix + 'wt_bank'], position: p[prefix + 'wt_position'],
        octave, tune: detune, level: 1, phase }, 1);
      if (wavePosition[index - 1]) wire(wavePosition[index - 1], 'out', id, 'param:position');
      return id;
    }
    return node(id, 'vco', { wave: VCO_WAVE[waveform], octave, detune, level: 1,
      pw: p[prefix + 'pulse_width'], phase: Math.round(phase * 100) / 100 }, 1);
  }
  for (let u = 0; u < copies; u++) {
    // Copies spread over +/- detune/2, bunched toward the centre by the curve.
    const pos = copies > 1 ? u / (copies - 1) - 0.5 : 0;
    const bunched = p.unison_detune_curve > 0
      ? (pos < 0 ? -0.5 : 0.5) * Math.pow(Math.abs(2 * pos), 1 + 2 * p.unison_detune_curve) : pos;
    const spread = bunched * p.unison_detune_cents;
    const suffix = copies > 1 ? String(u + 1) : '';
    const o1 = oscillator('osc' + suffix, 1, spread, spaced(START[p.osc1_waveform] ?? 0, u));
    const o2 = oscillator('osc2' + (suffix ? '_' + suffix : ''), 2,
      spread + p.osc2_transpose_cents + p.osc2_detune_cents, spaced((START[p.osc2_waveform] ?? 0) + 0.37, u));
    wire('note', 'pitch', o1, 'pitch');
    wire('note', 'pitch', o2, 'pitch');
    if (pitchMod) wire(pitchMod, 'out', o1, 'fm');
    if (osc2Pitch) wire(osc2Pitch, 'out', o2, 'fm');
    if (sync) wire(o1, 'sync', o2, 'sync');
    if (pwm1) wire(pwm1, 'out', o1, 'param:pw');
    if (pwm2) wire(pwm2, 'out', o2, 'param:pw');
    if (fmIndex) {
      node('index' + suffix, 'ring', { level: 1 }, 2);
      wire(o2, 'out', 'index' + suffix, 'a');
      wire(fmIndex, 'out', 'index' + suffix, 'b');
      wire('index' + suffix, 'out', o1, 'pm');
    } else if (fm) wire(scale('index' + suffix, o2, 'out', p.fm_index, 0, 2), 'out', o1, 'pm');
    const gain = weight(u) * norm;
    if (p.osc1_level) audio.push([o1, 'out', p.osc1_level * gain]);
    if (p.osc2_level) audio.push([o2, 'out', p.osc2_level * gain]);
  }
  if (p.sub_osc_level) {
    node('sub', 'vco', { wave: 2, octave: -1, level: 1 }, 1);
    wire('note', 'pitch', 'sub', 'pitch');
    audio.push(['sub', 'out', p.sub_osc_level]);
  }
  const noiseTerms = modTerms('Noise Level', 1, 2);
  if (p.noise_level || noiseTerms.length) {
    node('noise', 'noise', { color: 0, level: 1 }, 1);
    let noise = 'noise';
    if (p.noise_filter_mode > 0) {
      // The Synth's noise filter: a fixed SVF with k = 1.
      node('noisefilter', 'vcf', { cutoff: p.noise_filter_hz, resonance: 1 / 1.95, mode: p.noise_filter_mode - 1 }, 2);
      wire('noise', 'out', 'noisefilter', 'audio');
      noise = 'noisefilter';
    }
    if (noiseTerms.length) {
      // Noise Level slots add to the knob value.
      const level = p.noise_level ? sum('noiselevel', [[scale('noisebase', null, null, 0, p.noise_level, 2), 'out', 1],
        ...noiseTerms.map(([id, port]) => [id, port, 1])], 2) : total('noiselevel', noiseTerms, 2);
      node('noisevca', 'ring', { level: 1 }, 2);
      wire(noise, 'out', 'noisevca', 'a');
      wire(level, 'out', 'noisevca', 'b');
      audio.push(['noisevca', 'out', 1]);
    } else audio.push([noise, 'out', p.noise_level]);
  }
  if (audio.length === 0) throw new Error('The preset has no sound source');
  const mixed = sum('mix', audio, 2);

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
    cutoff.push([scale('fdepth', source, 'out', p.filter_env_amount_oct / 2, 0, 3), 'out']);
  }
  if (lfo && p.lfo_filter_oct) cutoff.push([scale('lfodepth', lfo, 'out', p.lfo_filter_oct / 2, 0, 3), 'out']);
  cutoff.push(...modTerms('Filter Cutoff', 1 / 2, 3));
  if (cutoff.length) wire(total('cutoff', cutoff, 3), 'out', 'filter', 'cutoff');

  // LFO 1 Rate slots: the Synth multiplies the rate by 2^amount; a linear CV matches it at
  // source values 0 and 1.
  const rateTerms = slots.filter(slot => slot[1] === 'LFO 1 Rate').map(([source, , amount]) =>
    [scale('mod' + ++termCount, ...sources[source], p.lfo_rate_hz * (2 ** amount - 1), 0, 0), 'out']);
  if (rateTerms.length && lfo) wire(sum('lforate', [[scale('lfobase', null, null, 0, p.lfo_rate_hz, 0), 'out', 1],
    ...rateTerms.map(([id, port]) => [id, port, 1])], 0), 'out', lfo, 'param:rate');

  // Amplifier with velocity, tremolo and master volume (the Synth halves its output). A Pan slot
  // places the voice with the Synth's constant-power law (+3 dB at the centre against Pan / Spread).
  const panTerms = modTerms('Pan', 1, 5);
  node('amp', 'vca', { level: Math.min(2, (panTerms.length ? Math.SQRT2 : 1) * 0.5 * 10 ** (p.master_volume_db / 20)) }, 5);
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
  let left = ['amp', 'out'], right = null;
  if (panTerms.length) {
    node('pan', 'pan', { pan: 0, spread: 0 }, 5);
    wire('amp', 'out', 'pan', 'in');
    wire(total('panmod', panTerms, 5), 'out', 'pan', 'param:pan');
    left = ['pan', 'left'];
    right = ['pan', 'right'];
  }

  // Effects run once for all voices, in the Synth's order: chorus, delay, reverb.
  const effects = [];
  if (p.fx_chorus_on >= 0.5) effects.push(['chorus', 'chorus', { rate: p.fx_chorus_rate_hz, depth: p.fx_chorus_depth_ms,
    delay: 7, spread: 1, mix: p.fx_chorus_mix }]);
  if (p.fx_delay_on >= 0.5) {
    const beats = DELAY_SYNC_BEATS[Math.round(p.fx_delay_sync)] ?? 0;
    const index = ECHO_BEATS.findIndex(value => Math.abs(value - beats) < 1e-9);
    if (beats && index < 0) throw new Error('Modular cannot play this delay note value');
    effects.push(['echo', 'echo', { time: p.fx_delay_time_ms, sync: beats ? 1 : 0, beats: Math.max(0, index),
      feedback: p.fx_delay_feedback, damping: Math.exp(-2 * Math.PI * p.fx_delay_high_cut_hz / 48000),
      pingPong: p.fx_delay_ping_pong >= 0.5 ? 1 : 0, mix: p.fx_delay_mix }]);
  }
  for (const [id, type, settings] of effects) {
    node(id, type, settings, 6);
    wire(...left, id, 'left');
    if (right) wire(...right, id, 'right');
    left = [id, 'left'];
    right = [id, 'right'];
  }
  // The reverb's wet path runs in parallel at mix 1 into its own FX output, so its level can match.
  const reverb = p.fx_reverb_on >= 0.5;
  if (reverb) {
    // Freeverb's comb feedback that reaches -60 dB in the Synth's decay time.
    const room = 10 ** (-3 * REVERB_COMB_SECONDS / (p.fx_reverb_decay_ms / 1000));
    node('reverb', 'reverb', { size: Math.max(0, Math.min(1, (room - 0.7) / 0.28)),
      damping: p.fx_reverb_damping, width: 1, mix: 1 }, 6);
    wire(...left, 'reverb', 'left');
    if (right) wire(...right, 'reverb', 'right');
    const wet = p.fx_reverb_mix * 10 ** (-reverbExcess(p.fx_reverb_decay_ms, p.fx_reverb_size) / 20);
    node('reverbout', 'fxOutput', { level: Math.round(wet * 1000) / 1000 }, 6);
    wire('reverb', 'left', 'reverbout', 'left');
    wire('reverb', 'right', 'reverbout', 'right');
  }
  const dry = reverb ? 1 - p.fx_reverb_mix : 1;
  if (effects.length) node('out', 'fxOutput', { level: dry }, 6);
  else node('out', 'output', { level: dry }, 5);
  wire(...left, 'out', effects.length ? 'left' : 'audio');
  if (right) wire(...right, 'out', 'right');
  if (nodes.length > 32 || cables.length > 128) throw new Error('Modular cannot play this preset within the rack limits');
  return { nodes, cables };
}

/** Synth presets whose sound Modular reproduces, by name. */
export const MODULAR_SYNTH_PORTS = SYNTH_PRESETS.filter(preset => {
  try { modularFromSynth(preset.params); return true; } catch { return false; }
}).map(preset => ({ name: preset.name, category: preset.category, description: preset.description,
  source: 'Synth', patch: () => modularFromSynth(preset.params) }));

// ---- Physical presets ------------------------------------------------------------------------
//
// A Physical preset is rebuilt from the Modular module with the same model. The stereo width
// pans each note by its pitch, as Physical does, and the Room becomes a patch Reverb added to the
// dry sound. Anything else a preset changes throws.

const PHYS_DEFAULTS = defaultValues(PHYS_PARAMS);
// Read by every model, or deliberately left out (performance controls and the sustain pedal).
const PHYS_COMMON = new Set(['phys_model', 'phys_volume_db', 'phys_release_ms', 'phys_stereo_width', 'phys_room_mix',
  'phys_room_decay_ms', 'phys_velocity_amount', 'phys_pitch_bend_range_cents', 'phys_sustain_mode',
  'phys_pressure_excitation', 'phys_pressure_brightness', 'phys_pressure_vibrato_cents',
  'tuning_divisions', 'tuning_period_cents', 'tuning_ref_note', 'tuning_ref_hz']);
const PHYS_MODELS = {
  0: new Set(['string_excitation', 'string_decay_ms', 'string_damping', 'string_pick_position', 'string_brightness',
    'string_sawari', 'string_plectrum', 'string_plectrum_hardness', 'string_body_mix', 'string_contact_gain',
    'string_sympathetic_mix', 'string_sympathetic_decay_ms', 'string_sympathetic_root',
    'amp_type', 'amp_gain', 'amp_tone', 'amp_level_db', 'phys_vibrato_cents', 'phys_vibrato_rate_hz']),
  3: new Set(['wind_type', 'breath_pressure', 'breath_noise', 'wind_attack_ms', 'wind_embouchure', 'free_reed_detune_cents',
    'phys_vibrato_cents', 'phys_vibrato_rate_hz']),
  7: new Set(['organ_drawbar_16', 'organ_drawbar_5_13', 'organ_drawbar_8', 'organ_drawbar_4', 'organ_drawbar_2_23',
    'organ_drawbar_2', 'organ_drawbar_1_35', 'organ_drawbar_1_13', 'organ_drawbar_1', 'organ_percussion', 'organ_perc_decay_ms',
    'organ_perc_level', 'organ_click', 'rotary_mode', 'rotary_mix', 'amp_type', 'amp_gain', 'amp_tone', 'amp_level_db']),
  4: new Set(['mesh_shape', 'mesh_size', 'mesh_decay_ms', 'mesh_high_damping', 'mesh_strike_x', 'mesh_strike_y', 'mesh_hardness']),
  5: new Set(['piano_inharmonicity', 'piano_hammer_hardness', 'piano_strike_position', 'piano_decay_ms', 'piano_damping',
    'piano_soundboard', 'piano_unison_detune_cents', 'amp_type', 'amp_gain', 'amp_tone', 'amp_level_db']),
  6: new Set(['brass_pressure', 'brass_lip', 'brass_attack_ms', 'brass_bell', 'phys_vibrato_cents', 'phys_vibrato_rate_hz']),
  2: new Set(['bow_pressure', 'bow_speed', 'bow_position', 'bow_attack_ms', 'bowed_brightness',
    'phys_vibrato_cents', 'phys_vibrato_rate_hz']),
  1: new Set(['modal_material', 'modal_decay_ms', 'modal_high_damping', 'modal_hardness', 'modal_strike_position',
    'modal_inharmonicity']),
};
// How much louder (dB) Modular's Reverb at mix 1 is than the Physical room, by room decay (ms),
// measured as wet against dry energy with Woodblock hits on four notes, then 3 dB less wet so
// sustained modal tones (Celesta, Steel Drums), whose reverb measures louder, come closer.
// Negative: Modular's is quieter, and the room's send and FX output turn it up.
const ROOM_DECAYS = [200, 400, 700, 1300, 2500, 4000, 6000];
const ROOM_EXCESS_DB = [-3.6, -9.8, -13.5, -14.6, -15, -15, -15];

function roomExcess(decayMs) {
  const logs = ROOM_DECAYS.map(Math.log), d = Math.log(decayMs);
  const row = Math.max(0, Math.min(logs.length - 2, logs.findLastIndex(value => value <= d)));
  return lerp(ROOM_EXCESS_DB, row + (d - logs[row]) / (logs[row + 1] - logs[row]));
}

/** A Modular patch that plays a Physical preset's parameters. */
export function modularFromPhysical(params) {
  const p = { ...PHYS_DEFAULTS, ...params };
  const model = Math.round(p.phys_model), supported = PHYS_MODELS[model];
  if (!supported) throw new Error(`Modular cannot play the ${PHYS_PARAMS.find(d => d.id === 'phys_model').options[model]} model`);
  for (const [key, value] of Object.entries(params))
    if (!PHYS_COMMON.has(key) && !supported.has(key) && value !== PHYS_DEFAULTS[key]) throw new Error(`Modular cannot play ${key}`);

  const nodes = [], cables = [], rows = [0, 0, 0, 0, 0, 0];
  const node = (id, type, settings, column, extra) => {
    nodes.push({ id, type, params: settings, ...extra, position: { x: 22 + column * COLUMN, y: 22 + rows[column]++ * ROW } });
    return id;
  };
  const wire = (from, port, to, input) => cables.push({ from, port, to, input });
  node('note', 'midi', {}, 0);
  // Physical scales its excitation by velocity this much.
  node('velocity', 'cv', { scale: p.phys_velocity_amount, offset: 1 - p.phys_velocity_amount }, 0);
  wire('note', 'velocity', 'velocity', 'in');
  // Physical's modal sum is scaled by 1.6, and its output by 0.5.
  const level = 0.8 * 10 ** (p.phys_volume_db / 20);

  // Physical's constant-power pan is +3 dB at the centre against Pan / Spread.
  const width = p.phys_stereo_width, panGain = width > 0 ? Math.SQRT2 : 1;
  // The guitar amp clips the voices' sum before Physical's output gain, so with an amp the
  // voices play at Physical's internal level and the output gain moves to the FX outputs.
  const amp = Math.round(p.amp_type) > 0;
  const outputGain = 0.5 * 10 ** (p.phys_volume_db / 20), voiceGain = amp ? 1 : outputGain;
  let pitch = ['note', 'pitch'];
  if (p.phys_vibrato_cents > 0 && model !== 1) {
    // Physical's vibrato: a sine on the pitch (the LFO restarts with each voice).
    node('vibrato', 'lfo', { rate: p.phys_vibrato_rate_hz, depth: 1, wave: 0 }, 0);
    node('pitch', 'mix4', { a: 1, b: p.phys_vibrato_cents / 100, c: 0, d: 0 }, 0);
    wire('note', 'pitch', 'pitch', 'a');
    wire('vibrato', 'out', 'pitch', 'b');
    pitch = ['pitch', 'out'];
  }
  let source;
  if (model === 6) {
    // The breath envelope (release at most 400 ms, as in Physical); velocity sets the level and,
    // inside the module, the blowing pressure.
    node('breath', 'adsr', { attack: Math.max(0.001, p.brass_attack_ms / 1000), decay: 0.001, sustain: 1,
      release: Math.max(0.001, Math.min(p.phys_release_ms, 400) / 1000), curve: 1 }, 0);
    wire('note', 'gate', 'breath', 'gate');
    source = node('brass', 'physBrass', { pressure: p.brass_pressure, lip: p.brass_lip, bell: p.brass_bell,
      attack: Math.max(0.001, p.brass_attack_ms / 1000), velocity: p.phys_velocity_amount, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('breath', 'out', source, 'breath');
    wire('note', 'velocity', source, 'velocity');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 7) {
    // The drawbars through Physical's organ envelope (1.5 ms attack), scaled by velocity.
    source = node('organ', 'physOrgan', { d16: p.organ_drawbar_16, d513: p.organ_drawbar_5_13, d8: p.organ_drawbar_8,
      d4: p.organ_drawbar_4, d223: p.organ_drawbar_2_23, d2: p.organ_drawbar_2, d135: p.organ_drawbar_1_35,
      d113: p.organ_drawbar_1_13, d1: p.organ_drawbar_1, percussion: Math.round(p.organ_percussion),
      percDecay: p.organ_perc_decay_ms / 1000, percLevel: p.organ_perc_level, click: p.organ_click, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('note', 'gate', source, 'gate');
    node('envelope', 'adsr', { attack: 0.0015, decay: 0.001, sustain: 1, release: Math.max(0.001, p.phys_release_ms / 1000), curve: 1 }, 0);
    wire('note', 'gate', 'envelope', 'gate');
    node('keying', 'vca', { level: 1 }, 1);
    wire(source, 'out', 'keying', 'audio');
    wire('envelope', 'out', 'keying', 'gain');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire('keying', 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 4) {
    // Raw velocity hardens the mallet; Physical scales the strike by velocity too.
    source = node('mesh', 'physMesh', { shape: Math.round(p.mesh_shape), size: Math.round(p.mesh_size),
      decay: p.mesh_decay_ms / 1000, release: p.phys_release_ms / 1000, highDamping: p.mesh_high_damping,
      strikeX: p.mesh_strike_x, strikeY: p.mesh_strike_y, hardness: p.mesh_hardness, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('note', 'gate', source, 'gate');
    wire('note', 'velocity', source, 'velocity');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 5) {
    // Raw velocity sets the hammer speed (and so the brightness); Physical scales the strings'
    // output by velocity too.
    source = node('piano', 'physPiano', { hardness: p.piano_hammer_hardness, position: p.piano_strike_position,
      decay: p.piano_decay_ms / 1000, release: p.phys_release_ms / 1000, damping: p.piano_damping,
      inharmonicity: p.piano_inharmonicity, detune: p.piano_unison_detune_cents, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('note', 'gate', source, 'gate');
    wire('note', 'velocity', source, 'velocity');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 3) {
    // The breath envelope (release at most 400 ms, as in Physical); velocity sets the level.
    node('breath', 'adsr', { attack: Math.max(0.001, p.wind_attack_ms / 1000), decay: 0.001, sustain: 1,
      release: Math.max(0.001, Math.min(p.phys_release_ms, 400) / 1000), curve: 1 }, 0);
    wire('note', 'gate', 'breath', 'gate');
    source = node('wind', 'physWind', { type: Math.round(p.wind_type), pressure: p.breath_pressure, noise: p.breath_noise,
      embouchure: p.wind_embouchure, musette: p.free_reed_detune_cents, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('breath', 'out', source, 'breath');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 2) {
    // The bow envelope, scaled by velocity, drives the bow speed.
    node('bowenv', 'adsr', { attack: Math.max(0.001, p.bow_attack_ms / 1000), decay: 0.001, sustain: 1,
      release: Math.max(0.001, p.phys_release_ms / 1000), curve: 1 }, 0);
    wire('note', 'gate', 'bowenv', 'gate');
    node('bowing', 'ring', { level: 1 }, 0);
    wire('bowenv', 'out', 'bowing', 'a');
    wire('velocity', 'out', 'bowing', 'b');
    source = node('bowed', 'physBowed', { speed: p.bow_speed, pressure: p.bow_pressure, position: p.bow_position,
      brightness: p.bowed_brightness, level: 1 }, 1);
    wire(...pitch, source, 'pitch');
    wire('bowing', 'out', source, 'bow');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    source = 'dynamics';
  }
  if (model === 0) {
    // Physical's string output is scaled by velocity and halved.
    source = node('string', 'physString', {
      excitation: p.string_excitation >= 0.5 ? 1 : 0, decay: p.string_decay_ms / 1000, release: p.phys_release_ms / 1000,
      damping: p.string_damping, pick: p.string_pick_position, brightness: p.string_brightness, level: 1,
      ...(p.string_sawari || p.string_plectrum || p.string_body_mix ? { sawari: p.string_sawari, plectrum: p.string_plectrum,
        hardness: p.string_plectrum_hardness, body: p.string_body_mix, contact: p.string_contact_gain } : {}),
    }, 1);
    wire(...pitch, source, 'pitch');
    wire('note', 'gate', source, 'gate');
    wire('note', 'velocity', source, 'velocity');
    node('dynamics', 'vca', { level: Math.min(2, Math.round(voiceGain * panGain * 1e4) / 1e4) }, 1);
    wire(source, 'out', 'dynamics', 'audio');
    wire('velocity', 'out', 'dynamics', 'gain');
    source = 'dynamics';
  }
  if (model === 1) {
    const material = Math.round(p.modal_material);
    const extra = {};
    if (p.modal_inharmonicity) {
      // Stretched ratios, as Physical's ratio^(1 + inharmonicity), in a custom table.
      const mat = MATERIALS[material];
      extra.modalTable = mat.ratios.slice(0, 8).map((ratio, k) => ({ ratio: ratio ** (1 + p.modal_inharmonicity),
        gain: mat.gains[k], decay: 1 }));
    }
    source = node('resonator', 'modal', {
      material, decay: p.modal_decay_ms / 1000, release: p.phys_release_ms / 1000,
      brightness: 1 - p.modal_high_damping, hardness: p.modal_hardness, strikePosition: p.modal_strike_position,
      level: Math.min(1, level),
    }, 1, extra);
    wire('note', 'pitch', source, 'pitch');
    wire('note', 'gate', source, 'gate');
    wire('velocity', 'out', source, 'velocity');
  }
  // A modal level above the module's maximum, and the pan gain, go on a VCA.
  const boost = model === 1 ? Math.max(1, level) * panGain : 1;
  let left = [source, 'out'], right = null;
  if (boost > 1 + 1e-9) {
    node('gain', 'vca', { level: Math.min(2, boost) }, 2);
    wire(source, 'out', 'gain', 'audio');
    left = ['gain', 'out'];
  }
  if (width > 0) {
    // Physical pans each note by (note - 60) / 36 x width.
    node('place', 'cv', { scale: width / 36, offset: -60 * width / 36 }, 2);
    wire('note', 'pitch', 'place', 'in');
    node('pan', 'pan', { pan: 0, spread: 0 }, 2);
    wire(...left, 'pan', 'in');
    wire('place', 'out', 'pan', 'param:pan');
    left = ['pan', 'left'];
    right = ['pan', 'right'];
  }
  // The piano soundboard rings on the sum of the strings, before the amp.
  const board = model === 5 && p.piano_soundboard > 0;
  if (board) {
    node('board', 'soundboard', { body: p.piano_soundboard }, 3);
    wire(...left, 'board', 'left');
    if (right) wire(...right, 'board', 'right');
    left = ['board', 'left'];
    right = ['board', 'right'];
  }
  // Sitar-style sympathetic strings ring on the sum of the voices, before the amp.
  const sympathetic = model === 0 && p.string_sympathetic_mix > 0;
  if (sympathetic) {
    node('tarab', 'sympathetic', { root: Math.round(p.string_sympathetic_root), decay: p.string_sympathetic_decay_ms / 1000,
      mix: p.string_sympathetic_mix }, 3);
    wire(...left, 'tarab', 'left');
    if (right) wire(...right, 'tarab', 'right');
    left = ['tarab', 'left'];
    right = ['tarab', 'right'];
  }
  if (amp) {
    node('amp', 'guitarAmp', { type: Math.round(p.amp_type) - 1, gain: p.amp_gain, tone: p.amp_tone,
      level: p.amp_level_db }, 3);
    wire(...left, 'amp', 'left');
    if (right) wire(...right, 'amp', 'right');
    left = ['amp', 'left'];
    right = ['amp', 'right'];
  }
  // The organ's rotary speaker follows the amp; Slow switches to Fast with the mod wheel.
  const rotary = model === 7 && Math.round(p.rotary_mode) > 0;
  if (rotary) {
    node('rotary', 'rotary', { speed: Math.round(p.rotary_mode) - 1, mix: p.rotary_mix }, 3);
    wire(...left, 'rotary', 'left');
    if (right) wire(...right, 'rotary', 'right');
    left = ['rotary', 'left'];
    right = ['rotary', 'right'];
  }
  const chain = board || sympathetic || amp || rotary;
  if (chain) {
    node('out', 'fxOutput', { level: amp ? Math.min(2, Math.round(outputGain * 1e4) / 1e4) : 1 }, 3);
    wire(...left, 'out', 'left');
    wire(...right, 'out', 'right');
  } else {
    node('out', 'output', { level: 1 }, 3);
    wire(...left, 'out', 'audio');
    if (right) wire(...right, 'out', 'right');
  }
  if (p.phys_room_mix > 0) {
    // The room's decay sets the Reverb size, as for the Synth reverb. Measured, Physical's room
    // decays in about 0.93 of its setting and the Reverb in about 1.03 of its target.
    const room = 10 ** (-3 * REVERB_COMB_SECONDS / (0.9 * p.phys_room_decay_ms / 1000));
    const gain = p.phys_room_mix * 10 ** (-roomExcess(p.phys_room_decay_ms) / 20) * (amp ? outputGain : 1);
    // FX output goes up to 2; before the amp, a per-voice send VCA supplies the rest.
    let send = left, sendRight = right;
    if (gain > 2 && !chain) {
      node('send', 'vca', { level: Math.min(2, Math.round(gain / 2 * 1000) / 1000) }, 3);
      wire(...left, 'send', 'audio');
      send = ['send', 'out'];
      if (right) {
        node('sendright', 'vca', { level: nodes.at(-1).params.level }, 3);
        wire(...right, 'sendright', 'audio');
        sendRight = ['sendright', 'out'];
      }
    }
    node('room', 'reverb', { size: Math.max(0, Math.min(1, (room - 0.7) / 0.28)), damping: 0.45, width: 1, mix: 1 }, 4);
    wire(...send, 'room', 'left');
    if (sendRight) wire(...sendRight, 'room', 'right');
    node('roomout', 'fxOutput', { level: Math.round(Math.min(2, gain) * 1000) / 1000 }, 4);
    wire('room', 'left', 'roomout', 'left');
    wire('room', 'right', 'roomout', 'right');
  }
  return { nodes, cables };
}

// Physical categories under the names the Modular library already uses.
const PHYS_CATEGORIES = { String: 'Strings', Mallet: 'Mallets', Bowed: 'Strings', Wind: 'Winds', Reed: 'Winds',
  'Free Reed': 'Winds' };

/** Physical presets whose sound Modular reproduces, by name. */
export const MODULAR_PHYSICAL_PORTS = PHYS_PRESETS.filter(preset => {
  try { modularFromPhysical(preset.params); return true; } catch { return false; }
}).map(preset => ({ name: preset.name + ' (Modular)', category: PHYS_CATEGORIES[preset.category] ?? preset.category,
  description: preset.description,
  source: 'Physical', patch: () => modularFromPhysical(preset.params) }));
