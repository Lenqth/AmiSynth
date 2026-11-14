// AmiSynth Modular: a small, independent, serializable graph DSP (no Web Audio dependencies).
// All edges are per-voice and carry a single audio-rate scalar. Graphs are acyclic in v1.
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
  output: { label: 'Audio output', inputs: ['audio'], outputs: [], params: {
    level: { min: 0, max: 1, default: 0.8, step: 0.01 },
  } },
});

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

/** Validate untrusted saved patches, clamp knobs, reject cycles and invalid connections. */
export function compileModularPatch(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.cables) ||
      raw.nodes.length < 1 || raw.nodes.length > 32 || raw.cables.length > 128)
    throw new Error('Invalid modular patch size');
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
    return { id: n.id, type: n.type, params, links: {} };
  });
  if (!nodes.some((n) => n.type === 'output')) throw new Error('An audio output is required');
  const adjacency = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  for (const cable of raw.cables) {
    const src = ids.get(cable?.from);
    const dst = ids.get(cable?.to);
    if (src === undefined || dst === undefined || src === dst) throw new Error('Invalid cable endpoint');
    if (!MODULAR_TYPES[nodes[src].type].outputs.includes(cable.port) ||
        !MODULAR_TYPES[nodes[dst].type].inputs.includes(cable.input) ||
        nodes[dst].links[cable.input]) throw new Error('Invalid or duplicate cable');
    nodes[dst].links[cable.input] = { index: src, port: cable.port };
    adjacency[src].push(dst);
    degree[dst]++;
  }
  const queue = [];
  for (let i = 0; i < nodes.length; i++) if (degree[i] === 0) queue.push(i);
  const order = [];
  for (let pos = 0; pos < queue.length; pos++) {
    const i = queue[pos];
    order.push(i);
    for (const j of adjacency[i]) if (--degree[j] === 0) queue.push(j);
  }
  if (order.length !== nodes.length) throw new Error('Feedback loops need a delay module (not yet supported)');
  return {
    nodes, order,
    patch: { nodes: nodes.map(({ id, type, params }) => ({ id, type, params })),
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
  return { active: false, held: false, note: -1, velocity: 0, age: 0,
    stages: Array.from({ length: nodeCount }, () => ({ phase: 0, env: 0, mode: 0, lastGate: false, release: 0, ic1: 0, ic2: 0 })),
    signals: Array.from({ length: nodeCount }, () => ({ out: 0, pitch: 0, gate: 0, velocity: 0 })) };
}
export function modular_init(s, sampleRate) {
  s.sampleRate = sampleRate;
  s.pitchBend = 0;
  s.tick = 0;
  s.out_l = 0; s.out_r = 0;
  modular_set_patch(s, defaultModularPatch());
}
export function modular_set_patch(s, patch) {
  const graph = compileModularPatch(patch);
  // Parameter updates on an unchanged graph do not interrupt held notes.
  if (s.graph && s.graph.nodes.length === graph.nodes.length &&
      s.graph.patch.cables.length === graph.patch.cables.length &&
      s.graph.nodes.every((n, i) => n.id === graph.nodes[i].id && n.type === graph.nodes[i].type) &&
      s.graph.patch.cables.every((c, i) => Object.keys(c).every(k => c[k] === graph.patch.cables[i][k]))) {
    s.graph = graph;
    return;
  }
  // Structural changes reset voices, so no partially rewired graph is audible.
  s.graph = graph;
  s.voices = Array.from({ length: MAX_VOICES }, () => newVoice(graph.nodes.length));
}
export function modular_all_notes_off(s) {
  for (const v of s.voices) { v.held = false; v.active = false; }
}
export function modular_midi(s, status, d1, d2) {
  const op = status & 0xf0;
  if (op === 0xe0) { s.pitchBend = (((d2 << 7) | d1) - 8192) / 8192 * 2; return; }
  if (op === 0xb0 && (d1 === 120 || d1 === 123)) { modular_all_notes_off(s); return; }
  if (op === 0x80 || (op === 0x90 && !d2)) {
    for (const v of s.voices) if (v.active && v.note === d1) v.held = false;
    return;
  }
  if (op !== 0x90 || d1 > 127 || d2 < 1) return;
  let v = s.voices.find((voice) => !voice.active);
  if (!v) v = s.voices.reduce((a, b) => a.age < b.age ? a : b);
  const fresh = newVoice(s.graph.nodes.length);
  Object.assign(v, fresh, { active: true, held: true, note: d1, velocity: d2 / 127, age: ++s.tick });
}

function read(v, node, key, fallback = 0) {
  const link = node.links[key];
  return link ? v.signals[link.index][link.port] : fallback;
}
function sampleNode(s, v, i) {
  const n = s.graph.nodes[i], p = n.params, st = v.stages[i], sig = v.signals[i];
  switch (n.type) {
    case 'midi':
      sig.pitch = v.note + s.pitchBend; sig.gate = v.held ? 1 : 0; sig.velocity = v.velocity;
      break;
    case 'vco': {
      const note = read(v, n, 'pitch', 69) + 12 * p.octave + p.detune / 100 + read(v, n, 'fm') * 12;
      const frequency = clamp(440 * Math.pow(2, (note - 69) / 12), 0.01, s.sampleRate * 0.45);
      const dt = frequency / s.sampleRate, phase = st.phase;
      let wave;
      if (p.wave === 0) wave = Math.sin(TAU * phase);
      else if (p.wave === 1) wave = 2 * phase - 1 - blep(phase, dt);
      else if (p.wave === 2) {
        wave = phase < 0.5 ? 1 : -1;
        wave += blep(phase, dt) - blep((phase + 0.5) % 1, dt);
      } else wave = 2 / Math.PI * Math.asin(Math.sin(TAU * phase));
      sig.out = wave * p.level;
      st.phase = (phase + dt) % 1;
      break;
    }
    case 'lfo': {
      const phase = st.phase;
      sig.out = (p.wave ? 1 - 4 * Math.abs(phase - 0.5) : Math.sin(TAU * phase)) * p.depth;
      st.phase = (phase + p.rate / s.sampleRate) % 1;
      break;
    }
    case 'adsr': {
      const gate = read(v, n, 'gate') >= 0.5;
      if (gate && !st.lastGate) st.mode = 1;
      if (!gate && st.lastGate) { st.mode = 4; st.release = st.env; }
      st.lastGate = gate;
      if (st.mode === 1) {
        st.env += 1 / Math.max(1, p.attack * s.sampleRate);
        if (st.env >= 1) { st.env = 1; st.mode = 2; }
      } else if (st.mode === 2) {
        st.env -= (1 - p.sustain) / Math.max(1, p.decay * s.sampleRate);
        if (st.env <= p.sustain) { st.env = p.sustain; st.mode = 3; }
      } else if (st.mode === 3) st.env = p.sustain;
      else if (st.mode === 4) {
        st.env -= st.release / Math.max(1, p.release * s.sampleRate);
        if (st.env <= 0) { st.env = 0; st.mode = 0; }
      }
      sig.out = st.env;
      break;
    }
    case 'vcf': {
      const cutoff = clamp(p.cutoff * Math.pow(2, read(v, n, 'cutoff') * 2), 20, s.sampleRate * 0.45);
      const g = Math.tan(Math.PI * cutoff / s.sampleRate);
      const k = 2 - 1.95 * p.resonance;
      const a1 = 1 / (1 + g * (g + k));
      const input = read(v, n, 'audio');
      const hp = (input - (g + k) * st.ic1 - st.ic2) * a1;
      const bp = g * hp + st.ic1;
      const lp = g * bp + st.ic2;
      st.ic1 = 2 * bp - st.ic1; st.ic2 = 2 * lp - st.ic2;
      sig.out = Number.isFinite(lp) ? clamp(lp, -16, 16) : 0;
      break;
    }
    case 'vca': sig.out = read(v, n, 'audio') * read(v, n, 'gain', 1) * p.level; break;
    case 'mix': sig.out = read(v, n, 'a') * p.a + read(v, n, 'b') * p.b; break;
    case 'output': sig.out = read(v, n, 'audio') * p.level; break;
  }
}
export function modular_render(s) {
  let out = 0;
  const hasADSR = s.graph.nodes.some((n) => n.type === 'adsr');
  for (const v of s.voices) {
    if (!v.active) continue;
    for (const i of s.graph.order) sampleNode(s, v, i);
    for (let i = 0; i < s.graph.nodes.length; i++)
      if (s.graph.nodes[i].type === 'output') out += v.signals[i].out;
    if (!v.held && (!hasADSR || v.stages.every((st, i) => s.graph.nodes[i].type !== 'adsr' || st.env <= 0))) v.active = false;
  }
  s.out_l = s.out_r = Math.tanh(out);
}
