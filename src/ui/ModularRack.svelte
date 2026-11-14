<script>
  import { onMount } from 'svelte';
  import {
    MODULAR_MACROS, MODULAR_PATCH_BYTES, MODULAR_PRESETS, MODULAR_TYPES,
    compileModularPatch, defaultModularPatch,
  } from '../dsp/modular.js';

  let { patch = defaultModularPatch(), onchange = () => {} } = $props();
  let error = $state('');
  let drag = $state(null);
  let selected = $state(null);
  let rack = $state();
  let file = $state();
  let positions = $state({});
  let observer;
  const graph = $derived(compileModularPatch(patch).patch);
  const nodes = $derived(graph.nodes);
  const outputCount = $derived(nodes.filter(n => n.type === 'output').length);
  const colors = ['#ffb547', '#71c7ff', '#91e6b3', '#f499b8', '#c3a7ff'];
  const jackKey = (id, port, direction) => id + '/' + port + '/' + direction;

  function measure() {
    if (!rack) return;
    const bounds = rack.getBoundingClientRect();
    positions = Object.fromEntries(Array.from(rack.querySelectorAll('[data-jack]'), jack => {
      const rect = jack.getBoundingClientRect();
      return [jack.dataset.jack, { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top }];
    }));
  }

  onMount(() => {
    observer = new ResizeObserver(measure);
    observer.observe(rack);
    return () => observer.disconnect();
  });

  $effect(() => {
    // Wait for jack positions to settle after a module or parameter control changes.
    void nodes;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  });

  function commit(next) {
    try {
      onchange(compileModularPatch(next).patch);
      error = '';
    } catch (e) { error = e.message; }
  }

  function replace(next) {
    drag = selected = null;
    commit(next);
  }

  function add(type) {
    const id = 'module_' + crypto.randomUUID().slice(0, 8);
    commit({ ...graph, nodes: [...nodes, { id, type, params: {} }] });
  }

  function remove(id) {
    drag = selected = null;
    commit({ ...graph, nodes: nodes.filter(n => n.id !== id), cables: graph.cables.filter(c => c.from !== id && c.to !== id) });
  }

  function knob(id, key, value) {
    commit({ ...graph, nodes: nodes.map(n => n.id === id ? { ...n, params: { ...n.params, [key]: Number(value) } } : n) });
  }

  function connect(source, to, input) {
    if (!source) return;
    const cables = graph.cables.filter(c => c.to !== to || c.input !== input);
    commit({ ...graph, cables: [...cables, { from: source.from, port: source.port, to, input }] });
    selected = null;
  }

  function pointerStart(e, from, port) {
    if (!e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { from, port, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, point: null };
  }

  function pointerMove(e) {
    if (drag?.pointer !== e.pointerId) return;
    if (!drag.point && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    const rect = rack.getBoundingClientRect();
    drag.point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pointerEnd(e) {
    if (drag?.pointer !== e.pointerId) return;
    if (drag.point) {
      const input = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-input]');
      if (input && rack.contains(input)) connect(drag, input.dataset.node, input.dataset.input);
    }
    drag = null;
  }

  function curve(a, b) {
    const slack = Math.min(100, 22 + Math.abs(b.x - a.x) * 0.18 + Math.abs(b.y - a.y) * 0.12);
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + slack}, ${b.x} ${b.y + slack}, ${b.x} ${b.y}`;
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'amisynth.modular.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function upload(e) {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = '';
    if (!selectedFile) return;
    if (selectedFile.size > MODULAR_PATCH_BYTES) { error = 'Patch file is larger than 64 KiB'; return; }
    try { replace(JSON.parse(await selectedFile.text())); }
    catch (e) { error = e.message; }
  }
</script>

<section class="card modular" aria-label="Modular rack">
  <div class="modular-toolbar">
    <label>Add module
      <select disabled={nodes.length >= 32} onchange={(e) => { if (e.currentTarget.value) add(e.currentTarget.value); e.currentTarget.value = ''; }}>
        <option value="">Select…</option>
        {#each Object.entries(MODULAR_TYPES) as [type, def]}
          <option value={type}>{def.label}</option>
        {/each}
      </select>
    </label>
    <label>Preset
      <select onchange={(e) => {
        if (e.currentTarget.value !== '') replace(MODULAR_PRESETS[Number(e.currentTarget.value)].patch());
        e.currentTarget.value = '';
      }}>
        <option value="">Load…</option>
        {#each MODULAR_PRESETS as preset, i}<option value={i}>{preset.name}</option>{/each}
      </select>
    </label>
    <button onclick={download}>Save patch</button>
    <button onclick={() => file.click()}>Open patch</button>
    <input type="file" accept=".json,application/json" hidden bind:this={file} onchange={upload} />
  </div>
  <p class="muted hint">Drag from an output to an input, or select the two jacks in order. Add a Unit Delay to close a feedback loop.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="modular-rack" bind:this={rack}>
    {#each nodes as n (n.id)}
      <article class="modular-module">
        <header><strong>{MODULAR_TYPES[n.type].label}</strong><button title="Remove module" aria-label="Remove {n.id}" disabled={n.type === 'output' && outputCount === 1} onclick={() => remove(n.id)}>×</button></header>
        <small class="muted">{n.id}</small>
        {#each Object.entries(MODULAR_TYPES[n.type].params) as [key, def]}
          <label class="modular-param"><span>{key}</span>
            <input aria-label="{n.id} {key}" type="range" min={def.min} max={def.max} step={def.step} value={n.params[key]} oninput={(e) => knob(n.id, key, e.currentTarget.value)} />
            <output>{Number(n.params[key]).toFixed(def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0)}</output>
          </label>
        {/each}
        <div class="jacks">
          {#each MODULAR_TYPES[n.type].inputs as input}
            <button class="jack in" data-jack={jackKey(n.id, input, 'in')} data-node={n.id} data-input={input}
              class:patched={graph.cables.some(c => c.to === n.id && c.input === input)}
              aria-label="{n.id} input {input}" onclick={() => connect(selected, n.id, input)}>{input}</button>
          {/each}
          {#each MODULAR_TYPES[n.type].outputs as port}
            <button class="jack out" data-jack={jackKey(n.id, port, 'out')}
              aria-label="{n.id} output {port}" aria-pressed={selected?.from === n.id && selected?.port === port}
              onclick={() => selected = selected?.from === n.id && selected?.port === port ? null : { from: n.id, port }}
              onpointerdown={(e) => pointerStart(e, n.id, port)} onpointermove={pointerMove}
              onpointerup={pointerEnd} onpointercancel={() => drag = null}
              onkeydown={(e) => { if (e.key === 'Escape') selected = null; }}>{port}</button>
          {/each}
        </div>
      </article>
    {/each}
    <svg class="wires" aria-hidden="true">
      {#each graph.cables as c, i}
        {@const a = positions[jackKey(c.from, c.port, 'out')]}
        {@const b = positions[jackKey(c.to, c.input, 'in')]}
        {#if a && b}<path d={curve(a, b)} stroke={colors[i % colors.length]} />{/if}
      {/each}
      {#if drag?.point && positions[jackKey(drag.from, drag.port, 'out')]}
        <path d={curve(positions[jackKey(drag.from, drag.port, 'out')], drag.point)} stroke="#fff" stroke-dasharray="4 4" />
      {/if}
    </svg>
  </div>
  <h4>Patch cables</h4>
  <div class="modular-cables">
    {#each graph.cables as c, i (`${c.to}/${c.input}`)}
      <div class="modular-cable" style:border-color={colors[i % colors.length]}>
        <code>{c.from}.{c.port} → {c.to}.{c.input}</code>
        <button onclick={() => commit({ ...graph, cables: graph.cables.filter((_, index) => i !== index) })}
          aria-label="Disconnect {c.to} input {c.input}">×</button>
      </div>
    {/each}
  </div>
  <h4>Macros</h4>
  <div class="macros">
    {#each Array(MODULAR_MACROS) as _, i}
      <label>Macro {i + 1}
        <input type="range" min="0" max="1" step="0.01" value={graph.macros[i]}
          oninput={(e) => commit({ ...graph, macros: graph.macros.with(i, Number(e.currentTarget.value)) })} />
      </label>
    {/each}
  </div>
</section>

<style>
  .modular-toolbar,.modular-cables,.macros { display:flex; align-items:center; flex-wrap:wrap; gap:0.6rem }
  .modular-toolbar label { display:grid; gap:0.3rem }
  .modular-rack { position:relative; display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,185px),1fr)); gap:0.8rem; padding-bottom:1rem }
  .modular-module { display:flex; flex-direction:column; border:1px solid var(--border,#555); border-radius:8px; padding:0.8rem; min-width:0 }
  .modular-module header { display:flex; justify-content:space-between; align-items:center }
  .modular-module small,.modular-cable code { overflow-wrap:anywhere }
  .modular-param { display:grid; grid-template-columns:1fr auto; gap:0.2rem; margin:0.35rem 0 }
  .modular-param input { grid-column:1; width:100% }
  .modular-param output { grid-column:2; font-variant-numeric:tabular-nums }
  .jacks { display:flex; flex-wrap:wrap; gap:4px; margin-top:auto; padding-top:0.7rem }
  .jack { position:relative; z-index:1; touch-action:none; border-radius:12px; padding:3px 7px; font-size:0.75rem }
  .jack::before { content:''; display:inline-block; width:0.5rem; height:0.5rem; margin-right:0.3rem; border:1px solid currentColor; border-radius:50% }
  .jack.in { color:#71c7ff }
  .jack.out { color:#ffb547; cursor:grab }
  .jack.patched::before,.jack[aria-pressed=true]::before { background:currentColor }
  .wires { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; opacity:0.75 }
  .wires path { fill:none; stroke-width:2 }
  .modular-cable { display:flex; align-items:center; gap:0.4rem; border:1px solid; border-radius:6px; padding:0.15rem 0.35rem }
  .macros label { display:grid; gap:0.35rem; font-size:0.8rem }
  .macros input { width:6rem }
  h4 { margin:0.8rem 0 0.5rem }
</style>
