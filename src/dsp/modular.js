// AmiSynth Modular: a small, independent, serializable graph DSP (no Web Audio dependencies).
// All cables carry a per-voice, audio-rate scalar. A Unit Delay breaks a feedback loop.
export const MODULAR_TYPES = Object.freeze({
  midi: { label: 'MIDI / Note', inputs: [], outputs: ['pitch', 'gate', 'velocity'], params: {} },
  vco: { label: 'VCO', inputs: ['pitch', 'fm'], outputs: ['out'], params: {
    wave: { min: 0, max: 3, default: 1, step: 1 },
    octave: { min: -3, max: 3, default: 0, step: 1 },
    detune: { min: -1200, max: 1200, default: 0, step: 1 },
    level: { min: 0, max: 1, default: 0.4, step: 0.01 },
  } },
  lfo: { label: 'LFO', inputs: [], outputs: ['out'], params: {
    rate: { min: 0.01, max: 30, default: 2, step: 0.01 },
    depth: { min: 0, max: 1, default: 1, step: 0.01 },
    wave: { min: 0, max: 1, default: 0, step: 1 },
  } },
  adsr: { label: 'ADSR', inputs: ['gate'], outputs: ['out'], params: {
    attack: { min: 0.001, max: 5, default: 0.01, step: 0.001 },
    decay: { min: 0.001, max: 5, default: 0.18, step: 0.001 },
    sustain: { min: 0, max: 1, default: 0.65, step: 0.01 },
    release: { min: 0.001, max: 10, default: 0.3, step: 0.001 },
  } },
  vcf: { label: 'VCF (lowpass)', inputs: ['audio', 'cutoff'], outputs: ['out'], params: {
    cutoff: { min: 20, max: 18000, default: 2400, step: 1 },
    resonance: { min: 0, max: 0.95, default: 0.15, step: 0.01 },
  } },
  vca: { label: 'VCA', inputs: ['audio', 'gain'], outputs: ['out'], params: {
    level: { min: 0, max: 2, default: 1, step: 0.01 },
  } },
  mix: { label: 'Mixer (2)', inputs: ['a', 'b'], outputs: ['out'], params: {
    a: { min: 0, max: 2, default: 0.5, step: 0.01 },
    b: { min: 0, max: 2, default: 0.5, step: 0.01 },
  } },
  cv: { label: 'CV Scale / Offset', inputs: ['in'], outputs: ['out'], params: {
    scale: { min: -8, max: 8, default: 1, step: 0.01 },
    offset: { min: -8, max: 8, default: 0, step: 0.01 },
  } },
  macro: { label: 'Macro CV', inputs: [], outputs: ['out'], params: {
    index: { min: 1, max: 8, default: 1, step: 1 },
  } },
  delay: { label: 'Unit Delay', inputs: ['in'], outputs: ['out'], params: {} },
  output: { label: 'Audio output', inputs: ['audio'], outputs: [], params: {
    level: { min: 0, max: 1, default: 0.8, step: 0.01 },
  } },
});

// A separate port name preserves the legacy VCF cutoff modulation input.
export const modularParamInput = key => 'param:' + key;

export function defaultModularPatch() {
  return {
    nodes: [
      { id: 'note', type: 'midi', params: {} },
      { id: 'osc', type: 'vco', params: {} },
      { id: 'env', type: 'adsr', params: {} },
      { id: 'filter', type: 'vcf', params: {} },
      { id: 'amp', type: 'vca', params: {} },
      { id: 'out', type: 'output', params: {} },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'osc', port: 'out', to: 'filter', input: 'audio' },
      { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  };
}

export const MODULAR_MACROS = 8;
export const MODULAR_PATCH_BYTES = 64 * 1024;
export const MODULAR_POSITION_MAX = 8192;
const MAX_RELEASE = 10;
const RELEASE_FADE = 0.005;
export const MODULAR_MAX_TAIL = MAX_RELEASE + RELEASE_FADE;

export const MODULAR_PRESETS = [
  { name: 'Subtractive', patch: defaultModularPatch },
  { name: 'Vibrato Lead', patch() {
    const patch = defaultModularPatch();
    patch.nodes.push({ id: 'vibrato', type: 'lfo', params: { rate: 5.2, depth: 0.035 } });
    patch.cables.push({ from: 'vibrato', port: 'out', to: 'osc', input: 'fm' });
    return patch;
  } },
  { name: 'Feedback Bass', patch() {
    const patch = defaultModularPatch();
    patch.nodes.push(
      { id: 'sum', type: 'mix', params: { a: 1, b: 0.45 } },
      { id: 'memory', type: 'delay', params: {} },
      { id: 'brightness', type: 'macro', params: { index: 1 } },
    );
    patch.nodes.find(n => n.id === 'filter').params.cutoff = 360;
    patch.cables = patch.cables.filter(c => c.to !== 'filter');
    patch.cables.push(
      { from: 'osc', port: 'out', to: 'sum', input: 'a' },
      { from: 'memory', port: 'out', to: 'sum', input: 'b' },
      { from: 'sum', port: 'out', to: 'filter', input: 'audio' },
      { from: 'filter', port: 'out', to: 'memory', input: 'in' },
      { from: 'brightness', port: 'out', to: 'filter', input: 'cutoff' },
    );
    return patch;
  } },
];

/** Validate and normalize a portable patch before publishing it to the DSP. */
export function compileModularPatch(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.cables) ||
      raw.nodes.length < 1 || raw.nodes.length > 32 || raw.cables.length > 128)
    throw new Error('Invalid modular patch size');
  if (raw.version !== undefined && raw.version !== 1) throw new Error('Unsupported modular patch version');
  const ids = new Map();
  const nodes = raw.nodes.map((n, i) => {
    if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(n.id) ||
        ids.has(n.id) || !Object.hasOwn(MODULAR_TYPES, n.type))
      throw new Error('Invalid or duplicate module');
    ids.set(n.id, i);
    const spec = MODULAR_TYPES[n.type];
    const params = {};
    for (const [key, def] of Object.entries(spec.params)) {
      const rawValue = n.params?.[key];
      params[key] = typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? Math.max(def.min, Math.min(def.max, rawValue)) : def.default;
      if (def.step >= 1) params[key] = Math.round(params[key]);
    }
    return { id: n.id, type: n.type, params, links: {}, paramLinks: {} };
  });
  if (!nodes.some((n) => n.type === 'output')) throw new Error('An audio output is required');
  const adjacency = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  for (const cable of raw.cables) {
    const src = ids.get(cable?.from);
    const dst = ids.get(cable?.to);
    if (src === undefined || dst === undefined) throw new Error('Invalid cable endpoint');
    const dest = MODULAR_TYPES[nodes[dst].type];
    const parameter = typeof cable.input === 'string' && cable.input.startsWith('param:') &&
      Object.hasOwn(dest.params, cable.input.slice(6));
    if (!MODULAR_TYPES[nodes[src].type].outputs.includes(cable.port) ||
        (!dest.inputs.includes(cable.input) && !parameter) ||
        nodes[dst].links[cable.input]) throw new Error('Invalid or duplicate cable');
    const link = { index: src, port: cable.port };
    nodes[dst].links[cable.input] = link;
    if (parameter) nodes[dst].paramLinks[cable.input.slice(6)] = link;
    // Delay writes happen after all current-sample readers, including self-feedback.
    if (nodes[dst].type !== 'delay') {
      adjacency[src].push(dst);
      degree[dst]++;
    }
  }
  const queue = [];
  for (let i = 0; i < nodes.length; i++) if (degree[i] === 0) queue.push(i);
  const order = [];
  for (let pos = 0; pos < queue.length; pos++) {
    const i = queue[pos];
    order.push(i);
    for (const j of adjacency[i]) if (--degree[j] === 0) queue.push(j);
  }
  if (order.length !== nodes.length) throw new Error('Add a Unit Delay to each feedback loop');
  const delays = order.filter(i => nodes[i].type === 'delay');
  const outputs = order.filter(i => nodes[i].type === 'output');
  const audible = new Set(outputs);
  for (const i of audible) for (const link of Object.values(nodes[i].links)) audible.add(link.index);
  const envelopes = [...audible].filter(i => nodes[i].type === 'adsr');
  const macros = Array.from({ length: MODULAR_MACROS }, (_, i) =>
    Number.isFinite(raw.macros?.[i]) ? clamp(raw.macros[i], 0, 1) : 0);
  return {
    nodes, order, delays, outputs, envelopes,
    meterSources: [...new Map(raw.cables.map(c => {
      const key = c.from + '/' + c.port;
      return [key, { key, index: ids.get(c.from), port: c.port }];
    })).values()],
    patch: { version: 1, macros, nodes: nodes.map(({ id, type, params }, i) => {
      const position = raw.nodes[i].position;
      return Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { id, type, params, position: {
          x: Math.round(clamp(position.x, 0, MODULAR_POSITION_MAX)),
          y: Math.round(clamp(position.y, 0, MODULAR_POSITION_MAX)),
        } }
        : { id, type, params };
    }),
      cables: raw.cables.map(({ from, port, to, input }) => ({ from, port, to, input })) },
  };
}

export function safeModularPatch(raw) {
  try { return compileModularPatch(raw).patch; }
  catch { return defaultModularPatch(); }
}

const MAX_VOICES = 8;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const blep = (t, dt) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
function newVoice(nodeCount) {
  return { active: false, keyDown: false, held: false, channel: 0, note: -1, velocity: 0,
    age: 0, tail: 0,
    stages: Array.from({ length: nodeCount }, () => ({})),
    signals: Array.from({ length: nodeCount }, () => ({})) };
}

export function modular_init(s, sampleRate) {
  s.sampleRate = sampleRate;
  s.bend = new Float64Array(16);
  s.sustain = new Uint8Array(16);
  s.tick = 0;
  s.out_l = 0; s.out_r = 0;
  modular_set_patch(s, defaultModularPatch());
}

export function modular_set_patch(s, patch) {
  const graph = compileModularPatch(patch);
  const old = s.graph;
  s.graph = graph;
  if (s.meter) modular_meter_enable(s, true);
  if (old && old.nodes.length === graph.nodes.length &&
      old.patch.cables.length === graph.patch.cables.length &&
      old.nodes.every((n, i) => n.id === graph.nodes[i].id && n.type === graph.nodes[i].type) &&
      old.patch.cables.every((c, i) => Object.keys(c).every(k => c[k] === graph.patch.cables[i][k]))) return;
  s.voices = Array.from({ length: MAX_VOICES }, () => newVoice(graph.nodes.length));
}

export function modular_all_notes_off(s) {
  s.sustain.fill(0);
  for (const v of s.voices) v.active = false;
}

export function modular_midi(s, status, d1, d2) {
  const op = status & 0xf0, channel = status & 0x0f;
  if (op === 0xe0) { s.bend[channel] = (((d2 << 7) | d1) - 8192) / 4096; return; }
  if (op === 0xb0) {
    if (d1 === 64) s.sustain[channel] = d2 >= 64;
    for (const v of s.voices) {
      if (v.channel !== channel) continue;
      if (d1 === 120) v.active = false;
      if (d1 === 123) v.keyDown = false;
      if ((d1 === 64 || d1 === 123) && !v.keyDown && !s.sustain[channel]) v.held = false;
    }
    return;
  }
  if (!Number.isInteger(d1) || d1 < 0 || d1 > 127) return;
  if (op === 0x80 || (op === 0x90 && !d2)) {
    let oldest;
    for (const v of s.voices) {
      if (v.active && v.keyDown && v.channel === channel && v.note === d1 && (!oldest || v.age < oldest.age)) oldest = v;
    }
    if (oldest) { oldest.keyDown = false; oldest.held = !!s.sustain[channel]; }
    return;
  }
  if (op !== 0x90 || !Number.isFinite(d2) || d2 < 1 || d2 > 127) return;
  let v = s.voices.find(voice => !voice.active);
  if (!v) v = s.voices.reduce((a, b) => a.held === b.held ? (a.age < b.age ? a : b) : a.held ? b : a);
  for (let i = 0; i < v.stages.length; i++) {
    const st = v.stages[i], sig = v.signals[i];
    st.phase = st.env = st.mode = st.release = st.ic1 = st.ic2 = st.memory = 0;
    st.lastGate = false;
    sig.out = sig.pitch = sig.gate = sig.velocity = 0;
  }
  v.active = v.held = v.keyDown = true;
  v.channel = channel; v.note = d1; v.velocity = d2 / 127; v.age = ++s.tick; v.tail = 0;
}

function read(v, node, key, fallback = 0) {
  const link = node.links[key];
  return link ? v.signals[link.index][link.port] : fallback;
}
function parameter(v, node, key) {
  const link = node.paramLinks[key];
  const normal = node.params[key];
  if (!link) return normal;
  const def = MODULAR_TYPES[node.type].params[key];
  const value = clamp(v.signals[link.index][link.port], def.min, def.max);
  return def.step >= 1 ? Math.round(value) : value;
}

export function modular_meter_enable(s, enabled) {
  s.meter = enabled ? {
    remaining: 1,
    interval: 15,
    low: new Float64Array(s.graph.meterSources.length).fill(Infinity),
    high: new Float64Array(s.graph.meterSources.length).fill(-Infinity),
  } : null;
}

export function modular_meter_snapshot(s) {
  const { low, high } = s.meter;
  const moving = s.graph.meterSources.filter((_, i) => high[i] - low[i] > 1e-4).map(source => source.key);
  low.fill(Infinity);
  high.fill(-Infinity);
  return moving;
}

function measureSignals(s, voice) {
  const { low, high } = s.meter;
  const sources = s.graph.meterSources;
  for (let i = 0; i < sources.length; i++) {
    const { index, port } = sources[i];
    const value = voice ? voice.signals[index][port] : 0;
    if (value < low[i]) low[i] = value;
    if (value > high[i]) high[i] = value;
  }
}

function sampleNode(s, v, i) {
  const n = s.graph.nodes[i], st = v.stages[i], sig = v.signals[i];
  switch (n.type) {
    case 'midi':
      sig.pitch = v.note + s.bend[v.channel]; sig.gate = v.held ? 1 : 0; sig.velocity = v.velocity;
      break;
    case 'vco': {
      const waveType = parameter(v, n, 'wave');
      const note = read(v, n, 'pitch', 69) + 12 * parameter(v, n, 'octave') + parameter(v, n, 'detune') / 100 + read(v, n, 'fm') * 12;
      const frequency = clamp(440 * Math.pow(2, (note - 69) / 12), 0.01, s.sampleRate * 0.45);
      const dt = frequency / s.sampleRate, phase = st.phase;
      let wave;
      if (waveType === 0) wave = Math.sin(TAU * phase);
      else if (waveType === 1) wave = 2 * phase - 1 - blep(phase, dt);
      else if (waveType === 2) {
        wave = phase < 0.5 ? 1 : -1;
        wave += blep(phase, dt) - blep((phase + 0.5) % 1, dt);
      } else wave = 2 / Math.PI * Math.asin(Math.sin(TAU * phase));
      sig.out = wave * parameter(v, n, 'level');
      st.phase = (phase + dt) % 1;
      break;
    }
    case 'lfo': {
      const phase = st.phase;
      sig.out = (parameter(v, n, 'wave') ? 1 - 4 * Math.abs(phase - 0.5) : Math.sin(TAU * phase)) * parameter(v, n, 'depth');
      st.phase = (phase + parameter(v, n, 'rate') / s.sampleRate) % 1;
      break;
    }
    case 'adsr': {
      const sustain = parameter(v, n, 'sustain');
      const gate = read(v, n, 'gate') >= 0.5;
      if (gate && !st.lastGate) st.mode = 1;
      if (!gate && st.lastGate) { st.mode = 4; st.release = st.env; }
      st.lastGate = gate;
      if (st.mode === 1) {
        st.env += 1 / Math.max(1, parameter(v, n, 'attack') * s.sampleRate);
        if (st.env >= 1) { st.env = 1; st.mode = 2; }
      } else if (st.mode === 2) {
        st.env -= (1 - sustain) / Math.max(1, parameter(v, n, 'decay') * s.sampleRate);
        if (st.env <= sustain) { st.env = sustain; st.mode = 3; }
      } else if (st.mode === 3) st.env = sustain;
      else if (st.mode === 4) {
        st.env -= st.release / Math.max(1, parameter(v, n, 'release') * s.sampleRate);
        if (st.env <= 0) { st.env = 0; st.mode = 0; }
      }
      sig.out = st.env;
      break;
    }
    case 'vcf': {
      const cutoff = clamp(parameter(v, n, 'cutoff') * Math.pow(2, read(v, n, 'cutoff') * 2), 20, s.sampleRate * 0.45);
      const g = Math.tan(Math.PI * cutoff / s.sampleRate);
      const k = 2 - 1.95 * parameter(v, n, 'resonance');
      const a1 = 1 / (1 + g * (g + k));
      const input = read(v, n, 'audio');
      const hp = (input - (g + k) * st.ic1 - st.ic2) * a1;
      const bp = g * hp + st.ic1;
      const lp = g * bp + st.ic2;
      st.ic1 = 2 * bp - st.ic1; st.ic2 = 2 * lp - st.ic2;
      sig.out = Number.isFinite(lp) ? clamp(lp, -16, 16) : 0;
      break;
    }
    case 'vca': sig.out = read(v, n, 'audio') * read(v, n, 'gain', 1) * parameter(v, n, 'level'); break;
    case 'mix': sig.out = read(v, n, 'a') * parameter(v, n, 'a') + read(v, n, 'b') * parameter(v, n, 'b'); break;
    case 'cv': sig.out = read(v, n, 'in') * parameter(v, n, 'scale') + parameter(v, n, 'offset'); break;
    case 'macro': sig.out = s.graph.patch.macros[parameter(v, n, 'index') - 1]; break;
    case 'delay': sig.out = st.memory; break;
    case 'output': sig.out = read(v, n, 'audio') * parameter(v, n, 'level'); break;
  }
  // Bound every intermediate so a cascade of multipliers cannot overflow.
  sig.out = clamp(sig.out, -1e6, 1e6);
}
export function modular_render(s) {
  let out = 0;
  const { nodes, order, delays, outputs, envelopes } = s.graph;
  let meterVoice;
  for (const v of s.voices) {
    if (!v.active) continue;
    meterVoice ??= v;
    for (const i of order) sampleNode(s, v, i);
    for (const i of delays) v.stages[i].memory = clamp(read(v, nodes[i], 'in'), -4, 4);
    let sample = 0;
    for (const i of outputs) sample += v.signals[i].out;
    if (!v.held) {
      v.tail++;
      const fade = Math.max(1, Math.round(RELEASE_FADE * s.sampleRate));
      if (envelopes.length === 0 || v.tail > MAX_RELEASE * s.sampleRate) {
        const elapsed = envelopes.length ? v.tail - MAX_RELEASE * s.sampleRate : v.tail;
        sample *= clamp(1 - elapsed / fade, 0, 1);
        if (elapsed >= fade) v.active = false;
      } else if (envelopes.every(i => v.stages[i].mode === 0 && !v.stages[i].lastGate)) {
        v.active = false;
      }
    }
    out += sample;
  }
  if (s.meter && --s.meter.remaining === 0) {
    measureSignals(s, meterVoice);
    // Vary the stride to avoid measuring the same phase of a periodic signal.
    s.meter.remaining = s.meter.interval;
    s.meter.interval = s.meter.interval === 17 ? 15 : s.meter.interval + 1;
  }
  s.out_l = s.out_r = Math.tanh(out);
}
