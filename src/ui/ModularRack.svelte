<script>
  import { MODULAR_TYPES, compileModularPatch, defaultModularPatch } from '../dsp/modular.js';
  export let patch = $bindable(defaultModularPatch());
  export let onchange = () => {};
  let source = $state('');
  let sourcePort = $state('');
  let target = $state('');
  let targetPort = $state('');
  let error = $state('');
  const nodes = $derived(patch.nodes || []);
  const srcSpec = $derived(MODULAR_TYPES[nodes.find(n => n.id === source)?.type]);
  const dstSpec = $derived(MODULAR_TYPES[nodes.find(n => n.id === target)?.type]);
  const outputs = $derived(nodes.filter(n => MODULAR_TYPES[n.type]?.outputs.length));
  const inputs = $derived(nodes.filter(n => MODULAR_TYPES[n.type]?.inputs.length));
  function commit(next) {
    try {
      patch = compileModularPatch(next).patch;
      onchange(patch);
      error = '';
    } catch (e) { error = e.message; }
  }
  function add(type) {
    const id = 'module_' + Math.random().toString(36).slice(2, 10);
    commit({ ...patch, nodes: [...nodes, { id, type, params: {} }] });
  }
  function remove(id) {
    if (nodes.find(n => n.id === id)?.type === 'output' && nodes.filter(n => n.type === 'output').length === 1) {
      error = 'At least one output is required'; return;
    }
    commit({ nodes: nodes.filter(n => n.id !== id), cables: patch.cables.filter(c => c.from !== id && c.to !== id) });
  }
  function knob(id, key, value) {
    commit({ ...patch, nodes: nodes.map(n => n.id === id ? { ...n, params: { ...n.params, [key]: Number(value) } } : n) });
  }
  function connect() {
    const port = sourcePort || srcSpec?.outputs[0];
    const input = targetPort || dstSpec?.inputs[0];
    if (!port || !input) return;
    const cables = patch.cables.filter(c => !(c.to === target && c.input === input));
    commit({ ...patch, cables: [...cables, { from: source, port, to: target, input }] });
  }
  function disconnect(index) {
    commit({ ...patch, cables: patch.cables.filter((_, i) => i !== index) });
  }
  function reset() { commit(defaultModularPatch()); }
  function patchName(n) { return MODULAR_TYPES[n.type].label + ' · ' + n.id; }
</script>

<section class="card modular">
  <div class="modular-header">
    <div><h3>Modular</h3><p class="muted hint">Build an audio-rate patch using independent modules. Each connection is per voice; multiple outputs may feed separate destinations. Feedback is not supported yet.</p></div>
    <button onclick={reset}>Reset patch</button>
  </div>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="modular-toolbar">
    <label>Add module
      <select onchange={(e) => { if (e.currentTarget.value) add(e.currentTarget.value); e.currentTarget.value = ''; }}>
        <option value="">Select…</option>
        {#each Object.entries(MODULAR_TYPES) as [type, def]}
          <option value={type}>{def.label}</option>
        {/each}
      </select>
    </label>
    <span class="muted hint">{nodes.length} modules · {patch.cables.length} cables · max 32 modules</span>
  </div>
  <div class="modular-rack">
    {#each nodes as n (n.id)}
      <article class="modular-module">
        <header><strong>{MODULAR_TYPES[n.type].label}</strong><button title="Remove module" aria-label="Remove {n.id}" disabled={n.type === 'output' && nodes.filter(x => x.type === 'output').length === 1} onclick={() => remove(n.id)}>×</button></header>
        <small class="muted">{n.id}</small>
        {#each Object.entries(MODULAR_TYPES[n.type].params) as [key, def]}
          <label class="modular-param"><span>{key}</span>
            <input aria-label="{n.id} {key}" type="range" min={def.min} max={def.max} step={def.step} value={n.params[key]} oninput={(e) => knob(n.id, key, e.currentTarget.value)} />
            <output>{Number(n.params[key]).toFixed(def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0)}</output>
          </label>
        {/each}
        <div class="muted hint">IN: {MODULAR_TYPES[n.type].inputs.join(', ') || '—'}</div>
        <div class="muted hint">OUT: {MODULAR_TYPES[n.type].outputs.join(', ') || '—'}</div>
      </article>
    {/each}
  </div>
  <h4>Patch cables</h4>
  <div class="modular-cables">
    {#each patch.cables as c, i (`${c.from}/${c.port}/${c.to}/${c.input}`)}
      <div class="modular-cable"><code>{c.from}.{c.port} → {c.to}.{c.input}</code><button onclick={() => disconnect(i)} aria-label="Disconnect {c.from} to {c.to}">×</button></div>
    {/each}
  </div>
  <div class="modular-connect">
    <label>Source<select bind:value={source} onchange={() => sourcePort = ''}><option value="">Select…</option>{#each outputs as n}<option value={n.id}>{patchName(n)}</option>{/each}</select></label>
    <label>Port<select bind:value={sourcePort}><option value="">Select…</option>{#each srcSpec?.outputs || [] as port}<option value={port}>{port}</option>{/each}</select></label>
    <label>Destination<select bind:value={target} onchange={() => targetPort = ''}><option value="">Select…</option>{#each inputs as n}<option value={n.id}>{patchName(n)}</option>{/each}</select></label>
    <label>Input<select bind:value={targetPort}><option value="">Select…</option>{#each dstSpec?.inputs || [] as port}<option value={port}>{port}</option>{/each}</select></label>
    <button disabled={!source || !target} onclick={connect}>Connect / replace</button>
  </div>
</section>

<style>
  .modular-header,.modular-toolbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
  .modular-toolbar{margin:1rem 0}
  .modular-rack{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:0.8rem}
  .modular-module{border:1px solid var(--border,#555);border-radius:8px;padding:0.8rem;min-width:0}
  .modular-module header{display:flex;justify-content:space-between;align-items:center}
  .modular-module small{display:block;overflow-wrap:anywhere}
  .modular-param{display:grid;grid-template-columns:1fr;gap:0.2rem;margin:0.6rem 0}
  .modular-param input{width:100%}
  .modular-cables{display:flex;flex-wrap:wrap;gap:0.5rem}
  .modular-cable{display:flex;align-items:center;gap:0.4rem;border:1px solid var(--border,#555);border-radius:6px;padding:0.25rem 0.5rem}
  .modular-cable code{overflow-wrap:anywhere}
  .modular-connect{display:flex;align-items:flex-end;gap:0.5rem;flex-wrap:wrap;margin-top:1rem}
  .modular-connect label{display:grid;gap:0.3rem}
  select{max-width:200px;min-height:2rem}
  h4{margin:1rem 0 0.5rem}
</style>
