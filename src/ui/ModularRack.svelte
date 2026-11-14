<script>
  import { onMount, tick } from 'svelte';
  import { engine } from '../lib/engine.js';
  import {
    MODULAR_MACROS, MODULAR_PATCH_BYTES, MODULAR_POSITION_MAX, MODULAR_PRESETS, MODULAR_TYPES,
    compileModularPatch, defaultModularPatch, modularParamInput,
  } from '../dsp/modular.js';

  let { patch = defaultModularPatch(), onchange = () => {} } = $props();
  let showSignals = $state(false);
  let activeSignals = $state(new Set());
  let menu = $state(null);
  let menuElement = $state();
  let error = $state('');
  let drag = $state(null);
  let selected = $state(null);
  let moving = $state(null);
  let foreground = $state('');
  let pan = $state(null);
  let suppressJackClick = false;
  let rack = $state();
  let file = $state();
  let positions = $state({});
  let observer;
  const graph = $derived(compileModularPatch(patch).patch);
  const nodes = $derived(graph.nodes);
  const cardWidth = 224;
  const columnPitch = 274;
  const rowPitch = 340;
  const pad = 22;
  const anchor = (column, row) => ({ x: pad + column * columnPitch, y: pad + row * rowPitch });
  const defaultSlots = { note: [0, 0], osc: [1, 0], filter: [2, 0], amp: [3, 0], out: [4, 0], env: [2, 1] };
  const cards = $derived(nodes.map((node, index) => {
    const defaultSlot = Object.hasOwn(defaultSlots, node.id) ? defaultSlots[node.id] : null;
    const fallback = defaultSlot ? anchor(...defaultSlot) : anchor(index % 5, 1 + Math.floor(index / 5));
    const point = moving?.id === node.id ? moving.point : node.position ?? fallback;
    return { node, ...point };
  }));
  const rackWidth = $derived(Math.max(5 * columnPitch - 10, ...cards.map(c => c.x + cardWidth + 100)));
  const rackHeight = $derived(Math.max(420, ...cards.map(c => c.y + rowPitch)));
  const jackKey = (id, port, direction) => id + '/' + port + '/' + direction;
  const wiredInputs = $derived(new Set(graph.cables.map(c => jackKey(c.to, c.input, 'in'))));
  const wiredOutputs = $derived(new Set(graph.cables.map(c => jackKey(c.from, c.port, 'out'))));
  const outputCount = $derived(nodes.filter(n => n.type === 'output').length);
  const colors = ['#ffb547', '#71c7ff', '#91e6b3', '#f499b8', '#c3a7ff'];

  function measure() {
    if (!rack) return;
    const bounds = rack.getBoundingClientRect();
    positions = Object.fromEntries(Array.from(rack.querySelectorAll('[data-jack]'), jack => {
      const rect = jack.querySelector('.socket').getBoundingClientRect();
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
    void cards;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!showSignals) return;
    engine.setModularSignals(keys => activeSignals = new Set(keys));
    return () => engine.setModularSignals(null);
  });

  function toggleSignals(e) {
    showSignals = e.currentTarget.checked;
    activeSignals = new Set();
  }

  function closeMenu(restoreFocus = false) {
    const trigger = menu?.trigger;
    menu = null;
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  function outsideMenu(e) {
    if (menu && !menuElement?.contains(e.target)) closeMenu();
  }

  function escape(e) {
    if (e.key !== 'Escape') return;
    if (menu) closeMenu(true);
    else selected = drag = null;
  }

  async function openMenu(e, id) {
    e.preventDefault();
    const point = rack.getBoundingClientRect();
    const target = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || target.left + target.width / 2;
    const y = e.clientY || target.top + target.height / 2;
    const card = id && cards.find(c => c.node.id === id);
    menu = { id, left: x, top: y, trigger: e.target instanceof HTMLElement && e.target.closest('button'),
      position: card ? boundedPoint(card.x + 30, card.y + 46) : boundedPoint(x - point.left, y - point.top) };
    await tick();
    if (!menu || !menuElement) return;
    const bounds = menuElement.getBoundingClientRect();
    menu.left = Math.max(4, Math.min(x, innerWidth - bounds.width - 4));
    menu.top = Math.max(4, Math.min(y, innerHeight - bounds.height - 4));
    menuElement.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function contextMenu(e) {
    if (e.target.closest('[data-jack]')) return;
    openMenu(e, e.target.closest('[data-module]')?.dataset.module);
  }

  function menuKey(e) {
    if (e.key === 'Tab') { closeMenu(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...menuElement.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }

  function commit(next, options) {
    try {
      onchange(compileModularPatch(next).patch, options);
      error = '';
    } catch (e) { error = e.message; }
  }

  function replace(next) {
    drag = selected = moving = null;
    foreground = '';
    commit(next);
  }

  function add(type, preferred, params = {}) {
    if (nodes.length >= 32) return;
    const id = 'module_' + crypto.randomUUID().slice(0, 8);
    // Put new modules in an open slot near the current viewport.
    const viewport = rack.parentElement;
    const startColumn = Math.floor(viewport.scrollLeft / columnPitch);
    const startRow = Math.floor(viewport.scrollTop / rowPitch);
    let position = preferred;
    for (let i = 0; !position && i <= nodes.length; i++) {
      const candidate = anchor(startColumn + i % 3, startRow + Math.floor(i / 3));
      if (!cards.some(c => Math.abs(c.x - candidate.x) < cardWidth + 16 && Math.abs(c.y - candidate.y) < 250)) {
        position = candidate;
        break;
      }
    }
    commit({ ...graph, nodes: [...nodes, { id, type, params, position }] });
    foreground = id;
    closeMenu();
  }

  function duplicate(card, position = boundedPoint(card.x + 30, card.y + 46)) {
    add(card.node.type, position, { ...card.node.params });
  }

  function remove(id) {
    drag = selected = moving = null;
    closeMenu();
    commit({ ...graph, nodes: nodes.filter(n => n.id !== id), cables: graph.cables.filter(c => c.from !== id && c.to !== id) });
  }

  function knob(id, key, value) {
    commit({ ...graph, nodes: nodes.map(n => n.id === id ? { ...n, params: { ...n.params, [key]: Number(value) } } : n) });
  }

  function connect(a, b) {
    if (!a || !b || a.dir === b.dir) return;
    const [output, input] = a.dir === 'out' ? [a, b] : [b, a];
    const cables = graph.cables.filter(c => c.to !== input.id || c.input !== input.port);
    commit({ ...graph, cables: [...cables, { from: output.id, port: output.port, to: input.id, input: input.port }] });
    selected = null;
  }

  function disconnect(id, port) {
    commit({ ...graph, cables: graph.cables.filter(c => c.to !== id || c.input !== port) });
    selected = null;
  }

  function boundedPoint(x, y) {
    return {
      x: Math.round(Math.max(0, Math.min(MODULAR_POSITION_MAX, x))),
      y: Math.round(Math.max(0, Math.min(MODULAR_POSITION_MAX, y))),
    };
  }

  function place(id, position) {
    commit({ ...graph, nodes: nodes.map(n => n.id === id ? { ...n, position } : n) }, { layoutOnly: true });
  }

  function panStart(e) {
    if (e.target !== rack || e.pointerType !== 'mouse' || e.button !== 0) return;
    const viewport = rack.parentElement;
    rack.setPointerCapture(e.pointerId);
    pan = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  }

  function panMove(e) {
    if (pan?.pointer !== e.pointerId) return;
    rack.parentElement.scrollTo(pan.left + pan.x - e.clientX, pan.top + pan.y - e.clientY);
  }

  function moveStart(e, card) {
    if (!e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = rack.getBoundingClientRect();
    foreground = card.node.id;
    moving = {
      id: card.node.id, pointer: e.pointerId,
      offsetX: e.clientX - rect.left - card.x, offsetY: e.clientY - rect.top - card.y,
      point: { x: card.x, y: card.y }, changed: false,
    };
  }

  function moveCard(e) {
    if (moving?.pointer !== e.pointerId) return;
    const rect = rack.getBoundingClientRect();
    const point = boundedPoint(e.clientX - rect.left - moving.offsetX, e.clientY - rect.top - moving.offsetY);
    if (point.x !== moving.point.x || point.y !== moving.point.y) moving.changed = true;
    moving.point = point;
  }

  function moveEnd(e) {
    if (moving?.pointer !== e.pointerId) return;
    moveCard(e);
    if (moving.changed) place(moving.id, moving.point);
    moving = null;
  }

  function moveKey(e, card) {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[e.key];
    if (!offset) return;
    e.preventDefault();
    foreground = card.node.id;
    const step = e.shiftKey ? 40 : 10;
    place(card.node.id, boundedPoint(card.x + offset[0] * step, card.y + offset[1] * step));
  }

  function chooseJack(e, id, port, dir) {
    if (e.detail && suppressJackClick) return;
    const jack = { id, port, dir };
    if (selected && selected.dir !== dir) return connect(selected, jack);
    if (dir === 'in' && wiredInputs.has(jackKey(id, port, dir))) return disconnect(id, port);
    selected = selected?.id === id && selected?.port === port && selected?.dir === dir ? null : jack;
  }

  function pointerStart(e, id, port, dir) {
    if (!e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressJackClick = false;
    drag = { id, port, dir, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, point: null };
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
      suppressJackClick = true;
      selected = null;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const jack = hit?.closest('[data-jack]');
      if (jack && rack.contains(jack) && jack.dataset.dir !== drag.dir) {
        connect(drag, { id: jack.dataset.node, port: jack.dataset.port, dir: jack.dataset.dir });
      } else if (drag.dir === 'in') {
        // A single-output card is unambiguous even when the drop misses its jack.
        const card = hit?.closest('[data-module]');
        if (card && rack.contains(card)) {
          const node = nodes.find(n => n.id === card.dataset.module);
          const ports = MODULAR_TYPES[node.type].outputs;
          if (ports.length === 1) connect(drag, { id: node.id, port: ports[0], dir: 'out' });
        }
      }
    }
    drag = null;
  }

  function curve(a, b) {
    const slack = Math.min(170, 40 + Math.abs(b.x - a.x) * 0.42 + Math.abs(b.y - a.y) * 0.15);
    return `M ${a.x} ${a.y} C ${a.x + slack} ${a.y}, ${b.x - slack} ${b.y}, ${b.x} ${b.y}`;
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

<svelte:window onpointerdown={outsideMenu} onkeydown={escape} />

{#snippet jack(n, port, dir, label, parameter = false)}
  {@const key = jackKey(n.id, port, dir)}
  {@const connected = dir === 'in' ? wiredInputs.has(key) : wiredOutputs.has(key)}
  <button type="button" class="jack" class:in={dir === 'in'} class:out={dir === 'out'}
    class:parameter class:patched={connected} data-jack={key} data-node={n.id} data-port={port} data-dir={dir}
    aria-label="{n.id} {dir === 'in' ? 'input' : 'output'} {parameter ? 'parameter ' : ''}{label}"
    title={dir === 'out' ? label + ': drag or click to connect' : connected ? label + ': click to disconnect or drag to rewire' : label + ': drag or click to connect'}
    aria-pressed={selected?.id === n.id && selected?.port === port && selected?.dir === dir}
    onclick={(e) => chooseJack(e, n.id, port, dir)}
    onpointerdown={(e) => pointerStart(e, n.id, port, dir)} onpointermove={pointerMove}
    onpointerup={pointerEnd} onpointercancel={() => drag = null} onlostpointercapture={() => drag = null}>
    {#if dir === 'out'}{label}{/if}<span class="socket"></span>{#if dir === 'in' && !parameter}{label}{/if}
  </button>
{/snippet}

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
    <label class="signal-toggle"><input type="checkbox" checked={showSignals} onchange={toggleSignals} /> Cable activity</label>
    <button onclick={download}>Save patch</button>
    <button onclick={() => file.click()}>Open patch</button>
    <input type="file" accept=".json,application/json" hidden bind:this={file} onchange={upload} />
  </div>
  <p class="muted hint">Right-click the rack to add a module. Drag either jack to connect. Click a connected input to unplug it.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p class="muted selection" role="status">
    {#if selected}Selected {selected.dir === 'out' ? 'output' : 'input'} {selected.id}.{selected.port.replace('param:', '')}. Choose {selected.dir === 'out' ? 'an input' : 'an output'}.{/if}
  </p>
  <div class="rack-scroll">
    <div class="modular-rack" role="group" aria-label="Patch canvas" class:panning={pan} bind:this={rack} style:width={rackWidth + 'px'}
      style:height={rackHeight + 'px'} style:--card-width={cardWidth + 'px'}
      oncontextmenu={contextMenu} onpointerdown={panStart} onpointermove={panMove} onlostpointercapture={() => pan = null}>
      {#each cards as card (card.node.id)}
        {@const n = card.node}
        <article class="modular-module" class:foreground={foreground === n.id}
          style:left={card.x + 'px'} style:top={card.y + 'px'} data-module={n.id}>
          <header>
            <button class="module-handle" data-move-module title="Drag to move, or use arrow keys" aria-label="Move {n.id}"
              onpointerdown={(e) => moveStart(e, card)} onpointermove={moveCard}
              onpointerup={moveEnd} onpointercancel={() => moving = null} onkeydown={(e) => moveKey(e, card)}>
              {MODULAR_TYPES[n.type].label}
            </button>
            <button class="node-action" title="Duplicate module" aria-label="Duplicate {n.id}"
              disabled={nodes.length >= 32} onclick={() => duplicate(card)}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor">
                <path d="M5 5V2H2v9h3M5 5h9v9H5z" />
              </svg>
            </button>
            <button class="node-action" title="Remove module" aria-label="Remove {n.id}" disabled={n.type === 'output' && outputCount === 1} onclick={() => remove(n.id)}>×</button>
          </header>
          <small class="muted">{n.id}</small>
          {#each Object.entries(MODULAR_TYPES[n.type].params) as [key, def]}
            {@const input = modularParamInput(key)}
            {@const connected = wiredInputs.has(jackKey(n.id, input, 'in'))}
            <div class="parameter-row">
              {@render jack(n, input, 'in', key, true)}
              <label class="modular-param" class:driven={connected}>
                <span>{key}</span>
                <input aria-label="{n.id} {key}" type="range" min={def.min} max={def.max} step={def.step}
                  value={n.params[key]} disabled={connected} oninput={(e) => knob(n.id, key, e.currentTarget.value)} />
                <output>{Number(n.params[key]).toFixed(def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0)}</output>
              </label>
            </div>
          {/each}
          <div class="jacks">
            <div class="jack-column inputs">
              {#each MODULAR_TYPES[n.type].inputs as input}
                {@render jack(n, input, 'in', n.type === 'vcf' && input === 'cutoff' ? 'cutoff mod' : input)}
              {/each}
            </div>
            <div class="jack-column outputs">
              {#each MODULAR_TYPES[n.type].outputs as port}
                {@render jack(n, port, 'out', port)}
              {/each}
            </div>
          </div>
        </article>
      {/each}
      <svg class="wires" aria-hidden="true">
        {#each graph.cables as c, i}
          {@const a = positions[jackKey(c.from, c.port, 'out')]}
          {@const b = positions[jackKey(c.to, c.input, 'in')]}
          {#if a && b}
            <path class:signal-active={showSignals && activeSignals.has(c.from + '/' + c.port)}
              data-wire={c.to + '/' + c.input} d={curve(a, b)} stroke={colors[i % colors.length]} />
          {/if}
        {/each}
        {#if drag?.point && positions[jackKey(drag.id, drag.port, drag.dir)]}
          {@const origin = positions[jackKey(drag.id, drag.port, drag.dir)]}
          <path d={drag.dir === 'out' ? curve(origin, drag.point) : curve(drag.point, origin)}
            stroke="#fff" stroke-dasharray="4 4" />
        {/if}
      </svg>
    </div>
  </div>
  <h4>Patch cables</h4>
  <div class="modular-cables">
    {#each graph.cables as c, i (`${c.to}/${c.input}`)}
      <div class="modular-cable" style:border-color={colors[i % colors.length]}>
        <code>{c.from}.{c.port} → {c.to}.{c.input}</code>
        <button onclick={() => disconnect(c.to, c.input)}
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
  {#if menu}
    <div class="context-actions" role="menu" tabindex="-1" data-modular-menu aria-label={menu.id ? 'Module actions' : 'Add module at cursor'}
      style:left={menu.left + 'px'} style:top={menu.top + 'px'} bind:this={menuElement} onkeydown={menuKey}>
      {#if menu.id}
        {@const card = cards.find(c => c.node.id === menu.id)}
        <button role="menuitem" disabled={nodes.length >= 32} onclick={() => duplicate(card, menu.position)}>Duplicate module</button>
        <button role="menuitem" disabled={card.node.type === 'output' && outputCount === 1} onclick={() => remove(card.node.id)}>Remove module</button>
      {:else}
        {#each Object.entries(MODULAR_TYPES) as [type, def]}
          <button role="menuitem" disabled={nodes.length >= 32} onclick={() => add(type, menu.position)}>{def.label}</button>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .modular-toolbar,.modular-cables,.macros { display:flex; align-items:center; flex-wrap:wrap; gap:0.6rem }
  .modular-toolbar label { display:grid; gap:0.3rem }
  .modular-toolbar .signal-toggle { display:flex; align-items:center }
  .context-actions { position:fixed; z-index:20; display:grid; min-width:185px; max-height:calc(100dvh - 8px);
    overflow:auto; padding:4px; background:var(--panel-2); border:1px solid var(--line); border-radius:8px; box-shadow:0 5px 20px #0008 }
  .context-actions button { text-align:left; border-color:transparent; padding:5px 8px }
  .context-actions button:hover,.context-actions button:focus-visible { background:var(--panel) }
  .selection { min-height:1.2em; margin:0 0 0.4rem; font-size:0.8rem }
  .rack-scroll { overflow:auto; max-height:70vh; min-height:250px; border:1px solid var(--line,#555); border-radius:8px }
  .modular-rack { position:relative; min-width:100%; isolation:isolate; cursor:grab; background-image:radial-gradient(#46505e 1px,transparent 1px); background-size:18px 18px }
  .modular-rack.panning { cursor:grabbing; user-select:none }
  .modular-module { position:absolute; cursor:auto; z-index:1; width:var(--card-width); box-sizing:border-box; border:1px solid var(--line,#555); border-radius:8px; background:var(--panel,#202631); box-shadow:0 3px 14px #0005; padding:0 0.7rem 0.65rem }
  .modular-module.foreground { z-index:2 }
  .modular-module header { display:flex; align-items:center; margin:0 -0.7rem 0.4rem; border-bottom:1px solid var(--line,#555) }
  .module-handle { flex:1; min-width:0; padding:0.5rem 0.6rem; text-align:left; font-weight:bold; border:0; background:transparent; cursor:grab; touch-action:none; user-select:none }
  .module-handle:active { cursor:grabbing }
  .node-action { flex:none; display:grid; place-items:center; width:24px; height:24px; margin-right:0.25rem; padding:0; color:var(--muted) }
  .node-action:hover { color:inherit }
  .parameter-row { display:grid; grid-template-columns:22px minmax(0,1fr); align-items:center; margin-left:-0.7rem }
  .jack.parameter { width:22px; min-height:28px; }
  .modular-param.driven { opacity:0.45 }
  .modular-module small,.modular-cable code { overflow-wrap:anywhere }
  .modular-param { display:grid; grid-template-columns:1fr auto; gap:0.15rem; margin:0.25rem 0 }
  .modular-param input { grid-column:1; width:100%; min-width:0; margin:0 }
  .modular-param output { grid-column:2; font-variant-numeric:tabular-nums }
  .jacks { display:grid; grid-template-columns:1fr 1fr; gap:2px; margin:0 -0.7rem; padding-top:0.45rem }
  .jack-column { display:grid; min-width:0; gap:2px; align-content:start }
  .jack { display:flex; align-items:center; gap:0.35rem; min-height:25px; touch-action:none; padding:2px 5px; border:0; background:transparent; font-size:0.76rem }
  .jack.in { justify-content:flex-start; color:#71c7ff }
  .jack.out { justify-content:flex-end; color:#ffb547; cursor:grab }
  .socket { display:inline-block; flex:none; width:0.65rem; height:0.65rem; border:1px solid currentColor; border-radius:50%; background:var(--panel,#202631) }
  .jack.patched .socket,.jack[aria-pressed=true] .socket { background:currentColor }
  .jack[aria-pressed=true] .socket { outline:2px solid currentColor; outline-offset:2px }
  .wires { position:absolute; z-index:3; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; opacity:0.72 }
  .wires path { fill:none; stroke-width:2 }
  .wires .signal-active { stroke-width:3; stroke-dasharray:8 6; animation:signal-flow 0.65s linear infinite }
  @keyframes signal-flow { to { stroke-dashoffset:-28 } }
  @media (prefers-reduced-motion: reduce) { .wires .signal-active { animation:none; stroke-width:4 } }
  .modular-cable { display:flex; align-items:center; gap:0.4rem; border:1px solid; border-radius:6px; padding:0.15rem 0.35rem }
  .macros label { display:grid; gap:0.35rem; font-size:0.8rem }
  .macros input { width:6rem }
  h4 { margin:0.8rem 0 0.5rem }
</style>
