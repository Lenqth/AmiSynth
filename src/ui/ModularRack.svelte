<script>
  import { onMount, tick } from 'svelte';
  import {
    BEAT_GRID_LANES, BEAT_GRID_STEPS,
    MODULAR_MACROS, MODULAR_MODAL_FIELDS, MODULAR_MODES, MODULAR_PATCH_BYTES, MODULAR_POSITION_MAX, MODULAR_PRESETS, MODULAR_TYPES,
    compileModularPatch, defaultModularPatch, modularMaterialTable, modularParamInput, modularPresetIndex, searchModularTypes,
  } from '../dsp/modular.js';

  let { patch = defaultModularPatch(), onchange = () => {}, signalSource = null } = $props();
  let showSignals = $state(false);
  let probe = $state('');
  let trace = $state(null);
  // Smoothed cable activity per source key: swing and level (0..1), dash period and offset.
  let flow = $state({});
  let menu = $state(null);
  let menuElement = $state();
  let menuQuery = $state('');
  const menuResults = $derived(searchModularTypes(menuQuery));
  let error = $state('');
  let drag = $state(null);
  let selected = $state(null);
  let moving = $state(null);
  let foreground = $state('');
  let pan = $state(null);
  let suppressJackClick = false;
  let rack = $state();
  let viewport = $state();
  let viewWidth = $state(0);
  let viewHeight = $state(0);
  let zoom = $state(1);
  let file = $state();
  let fragmentFile = $state();
  let marked = $state([]);
  let past = $state.raw([]);
  let future = $state.raw([]);
  let lastEdit = null;
  let positions = $state({});
  let observer;
  const graph = $derived(compileModularPatch(patch).patch);
  const presetIndex = $derived(modularPresetIndex(graph));
  const nodes = $derived(graph.nodes);
  let modalId = $state('');
  let modeRows = $state([]);
  let modalEditor = $state();
  const editedModal = $derived(nodes.find(n => n.id === modalId && n.type === 'modal'));
  const modeFields = Object.entries(MODULAR_MODAL_FIELDS);
  const probes = $derived(nodes.flatMap(n => MODULAR_TYPES[n.type].outputs.map(port => ({
    key: n.id + '/' + port, label: n.id + '.' + port,
  }))));
  const scope = $derived(probes.some(item => item.key === probe) ? probe : '');
  const scopePlot = $derived.by(() => {
    if (!trace?.waveform.length) return null;
    const samples = trace.waveform;
    const min = Math.min(...samples), max = Math.max(...samples);
    const lower = Math.min(0, min), span = Math.max(0.01, max - lower, -lower);
    const y = value => 72 - (value - lower) * 64 / span;
    const points = samples.map((value, i) => `${4 + i * 312 / Math.max(1, samples.length - 1)},${y(value)}`).join(' ');
    return { points, zero: y(0), last: samples.at(-1), min, max, ms: trace.seconds * 1000 };
  });
  const cardWidth = 224;
  const columnPitch = 274;
  const rowPitch = 420;
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
  // Fill the viewport with canvas when zoomed out.
  const stageWidth = $derived(Math.max(rackWidth, viewWidth / zoom));
  const stageHeight = $derived(Math.max(rackHeight, viewHeight / zoom));
  const zoomMin = 0.3;
  const zoomMax = 2;
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
      return [jack.dataset.jack, { x: (rect.left + rect.width / 2 - bounds.left) / zoom, y: (rect.top + rect.height / 2 - bounds.top) / zoom }];
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
    const source = scope;
    if ((!showSignals && !source) || !signalSource) return;
    let targets = {};
    signalSource.setModularSignals(signals => {
      targets = Object.fromEntries(signals.filter(signal => !signal.waveform).map(signal => [signal.key, signal]));
      trace = signals.find(signal => signal.waveform && signal.key === source) ?? null;
    }, source);
    if (!showSignals) return () => { signalSource.setModularSignals(null); trace = null; };
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previous = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      // Snapshots arrive about 24 times a second; ease between them.
      const ease = 1 - Math.exp(-dt * 14);
      const next = {};
      for (const [key, target] of Object.entries(targets)) {
        const last = flow[key] ?? { swing: 0, level: 0, period: 20, offset: 0 };
        const swing = last.swing + (1 - Math.exp(-target.span * 2) - last.swing) * ease;
        const level = last.level + (1 - Math.exp(-target.level * 1.5) - last.level) * ease;
        // Faster signals flow faster with shorter dashes.
        const octaves = Math.log2(1 + target.rate);
        const period = last.period + (Math.max(8, 24 - 2.2 * octaves) - last.period) * ease;
        const speed = still || target.span < 1e-4 ? 0 : (20 + 40 * octaves) * (0.3 + 0.7 * swing);
        next[key] = { swing, level, period, offset: (last.offset - speed * dt) % 1000 };
      }
      flow = next;
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      signalSource.setModularSignals(null);
      flow = {};
      trace = null;
    };
  });

  $effect(() => {
    // Ctrl/Cmd + wheel (and trackpad pinch) zooms; the listener must not be passive to stop page zoom.
    if (!viewport) return;
    const wheel = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomTo(zoom * Math.exp(-delta * 0.002), e.clientX, e.clientY);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  });

  async function zoomTo(next, clientX, clientY) {
    next = Math.max(zoomMin, Math.min(zoomMax, next));
    if (next === zoom) return;
    // Keep the canvas point under the cursor (or the view centre) in place.
    const bounds = viewport.getBoundingClientRect();
    const x = (clientX ?? bounds.left + viewport.clientLeft + viewport.clientWidth / 2) - bounds.left - viewport.clientLeft;
    const y = (clientY ?? bounds.top + viewport.clientTop + viewport.clientHeight / 2) - bounds.top - viewport.clientTop;
    const point = { x: (viewport.scrollLeft + x) / zoom, y: (viewport.scrollTop + y) / zoom };
    zoom = next;
    await tick();
    viewport.scrollTo(point.x * next - x, point.y * next - y);
  }

  async function zoomToFit() {
    const modules = [...rack.querySelectorAll('[data-module]')];
    if (!modules.length) return;
    const left = Math.max(0, Math.min(...modules.map(m => m.offsetLeft)) - pad);
    const top = Math.max(0, Math.min(...modules.map(m => m.offsetTop)) - pad);
    const right = Math.max(...modules.map(m => m.offsetLeft + m.offsetWidth)) + pad;
    const bottom = Math.max(...modules.map(m => m.offsetTop + m.offsetHeight)) + pad;
    zoom = Math.max(zoomMin, Math.min(1, viewport.clientWidth / (right - left), viewport.clientHeight / (bottom - top)));
    await tick();
    viewport.scrollTo(left * zoom, top * zoom);
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
    menuQuery = '';
    menu = { id, left: x, top: y, trigger: e.target instanceof HTMLElement && e.target.closest('button'),
      position: card ? boundedPoint(card.x + 30, card.y + 46) : boundedPoint((x - point.left) / zoom, (y - point.top) / zoom) };
    await tick();
    if (!menu || !menuElement) return;
    const bounds = menuElement.getBoundingClientRect();
    menu.left = Math.max(4, Math.min(x, innerWidth - bounds.width - 4));
    menu.top = Math.max(4, Math.min(y, innerHeight - bounds.height - 4));
    menuElement.querySelector('input, button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function contextMenu(e) {
    if (e.target.closest('[data-jack]')) return;
    openMenu(e, e.target.closest('[data-module]')?.dataset.module);
  }

  function menuKey(e) {
    if (e.key === 'Tab') { closeMenu(true); return; }
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      const first = menuResults[0];
      if (first && nodes.length < 32) add(first.type, menu.position);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menuElement.querySelectorAll('input, button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }

  function commit(next, options) {
    try {
      const normalized = compileModularPatch(next).patch;
      if (JSON.stringify(normalized) === JSON.stringify(graph)) return false;
      if (!options?.skipHistory) {
        const now = performance.now();
        if (!options?.gesture || lastEdit?.key !== options.gesture || now - lastEdit.time > 400)
          past = [...past.slice(-49), graph];
        lastEdit = options?.gesture ? { key: options.gesture, time: now } : null;
        future = [];
      }
      onchange(normalized, options);
      error = '';
      return true;
    } catch (e) { error = e.message; return false; }
  }

  function history(redo) {
    const source = redo ? future : past;
    if (!source.length) return;
    const before = graph;
    const next = source.at(-1);
    // Host automation owns the current macro values, independent of rack edits.
    commit({ ...next, macros: before.macros }, { skipHistory: true });
    if (redo) {
      past = [...past, before];
      future = future.slice(0, -1);
    } else {
      future = [...future, before];
      past = past.slice(0, -1);
    }
    marked = [];
    modalId = '';
    lastEdit = null;
  }

  function toggleMarked(id) {
    marked = marked.includes(id) ? marked.filter(item => item !== id) : [...marked, id];
  }

  function fragment() {
    return {
      format: 'amisynth-modular-fragment',
      version: 1,
      nodes: cards.filter(c => marked.includes(c.node.id)).map(c => ({
        ...c.node, position: { x: c.x, y: c.y },
      })),
      cables: graph.cables.filter(c => marked.includes(c.from) && marked.includes(c.to)),
    };
  }

  function insertFragment(part, x, y) {
    if (part?.format !== 'amisynth-modular-fragment' || part.version !== 1 ||
        !Array.isArray(part.nodes) || !part.nodes.length || !Array.isArray(part.cables) ||
        nodes.length + part.nodes.length > 32)
      throw new Error('Invalid fragment or the rack would exceed 32 modules');
    const ids = new Map();
    for (const node of part.nodes) {
      if (typeof node?.id !== 'string' || ids.has(node.id) ||
          !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y))
        throw new Error('Invalid fragment module');
      ids.set(node.id, 'module_' + Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join(''));
    }
    const minX = Math.min(...part.nodes.map(n => n.position.x));
    const minY = Math.min(...part.nodes.map(n => n.position.y));
    const inserted = part.nodes.map(n => ({ ...n, id: ids.get(n.id),
      position: boundedPoint(x + n.position.x - minX, y + n.position.y - minY) }));
    const cables = part.cables.map(c => ({ ...c, from: ids.get(c?.from), to: ids.get(c?.to) }));
    if (commit({ ...graph, nodes: [...nodes, ...inserted], cables: [...graph.cables, ...cables] }))
      marked = inserted.map(n => n.id);
  }

  function duplicateFragment() {
    const part = fragment();
    insertFragment(part, Math.min(...part.nodes.map(n => n.position.x)) + 30,
      Math.min(...part.nodes.map(n => n.position.y)) + 46);
  }

  function replace(next) {
    drag = selected = moving = null;
    foreground = '';
    marked = [];
    modalId = '';
    commit(next);
  }

  function add(type, preferred, params = {}, modalTable) {
    if (nodes.length >= 32) return;
    // Embedded offline pages do not always expose randomUUID (secure-context API).
    const id = 'module_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), n => n.toString(16).padStart(2, '0')).join('');
    // Put new modules in an open slot near the current viewport.
    const startColumn = Math.floor(viewport.scrollLeft / zoom / columnPitch);
    const startRow = Math.floor(viewport.scrollTop / zoom / rowPitch);
    let position = preferred;
    for (let i = 0; !position && i <= nodes.length; i++) {
      const candidate = anchor(startColumn + i % 3, startRow + Math.floor(i / 3));
      if (!cards.some(c => Math.abs(c.x - candidate.x) < cardWidth + 16 && Math.abs(c.y - candidate.y) < 250)) {
        position = candidate;
        break;
      }
    }
    commit({ ...graph, nodes: [...nodes, { id, type, params, position, modalTable }] });
    foreground = id;
    closeMenu();
  }

  function duplicate(card, position = boundedPoint(card.x + 30, card.y + 46)) {
    add(card.node.type, position, { ...card.node.params }, card.node.modalTable);
  }

  async function editModes(node) {
    modalId = node.id;
    modeRows = node.modalTable?.map(row => ({ ...row })) ?? modularMaterialTable(node.params.material);
    await tick();
    modalEditor?.scrollIntoView({ block: 'nearest' });
    modalEditor?.querySelector('input')?.focus({ preventScroll: true });
  }

  function setModalTable(modalTable) {
    const next = { ...graph, nodes: nodes.map(n => n.id === modalId ? { ...n, modalTable } : n) };
    if (commit(next) || JSON.stringify(modalTable) === JSON.stringify(editedModal?.modalTable)) modalId = '';
  }

  function remove(id) {
    drag = selected = moving = null;
    closeMenu();
    marked = marked.filter(item => item !== id);
    if (modalId === id) modalId = '';
    commit({ ...graph, nodes: nodes.filter(n => n.id !== id), cables: graph.cables.filter(c => c.from !== id && c.to !== id) });
  }

  function knob(id, key, value, group = true) {
    commit({ ...graph, nodes: nodes.map(n => n.id === id ? { ...n, params: { ...n.params, [key]: Number(value) } } : n) },
      group ? { gesture: id + '/' + key } : undefined);
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
    rack.setPointerCapture(e.pointerId);
    pan = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  }

  function panMove(e) {
    if (pan?.pointer !== e.pointerId) return;
    viewport.scrollTo(pan.left + pan.x - e.clientX, pan.top + pan.y - e.clientY);
  }

  function moveStart(e, card) {
    if (!e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = rack.getBoundingClientRect();
    foreground = card.node.id;
    moving = {
      id: card.node.id, pointer: e.pointerId,
      offsetX: (e.clientX - rect.left) / zoom - card.x, offsetY: (e.clientY - rect.top) / zoom - card.y,
      point: { x: card.x, y: card.y }, changed: false,
    };
  }

  function moveCard(e) {
    if (moving?.pointer !== e.pointerId) return;
    const rect = rack.getBoundingClientRect();
    const point = boundedPoint((e.clientX - rect.left) / zoom - moving.offsetX, (e.clientY - rect.top) / zoom - moving.offsetY);
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
    drag.point = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
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

  function download(value = graph, name = 'amisynth.modular.json') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
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

  async function uploadFragment(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > MODULAR_PATCH_BYTES) throw new Error('Fragment file is larger than 64 KiB');
      insertFragment(JSON.parse(await file.text()), viewport.scrollLeft / zoom + pad, viewport.scrollTop / zoom + pad);
    } catch (e) { error = e.message; }
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
      <select value={presetIndex} onchange={(e) => {
        const preset = MODULAR_PRESETS[Number(e.currentTarget.value)];
        if (preset) replace(preset.patch());
      }}>
        <option value={-1} disabled>Custom</option>
        {#each MODULAR_PRESETS as preset, i}<option value={i}>{preset.name}</option>{/each}
      </select>
    </label>
    {#if signalSource}
      <label class="signal-toggle"><input type="checkbox" bind:checked={showSignals} /> Cable activity</label>
      <label>Scope <select bind:value={probe}><option value="">Off</option>
        {#each probes as item (item.key)}<option value={item.key}>{item.label}</option>{/each}
      </select></label>
    {/if}
    <button onclick={() => download()}>Save patch</button>
    <button onclick={() => file.click()}>Open patch</button>
    <input type="file" accept=".json,application/json" hidden bind:this={file} onchange={upload} />
    <button disabled={!past.length} onclick={() => history(false)}>Undo</button>
    <button disabled={!future.length} onclick={() => history(true)}>Redo</button>
    <button disabled={!marked.length || nodes.length + marked.length > 32} onclick={duplicateFragment}>Duplicate selection</button>
    <button disabled={!marked.length} onclick={() => download(fragment(), 'amisynth.modular-fragment.json')}>Save selection</button>
    <button onclick={() => fragmentFile.click()}>Insert fragment</button>
    <input type="file" accept=".json,application/json" hidden bind:this={fragmentFile} onchange={uploadFragment} />
    <div class="zoom-controls" role="group" aria-label="Zoom">
      <button title="Zoom out" aria-label="Zoom out" disabled={zoom <= zoomMin} onclick={() => zoomTo(zoom / 1.25)}>−</button>
      <button class="zoom-level" title="Reset zoom to 100%" aria-label="Reset zoom (now {Math.round(zoom * 100)}%)" onclick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
      <button title="Zoom in" aria-label="Zoom in" disabled={zoom >= zoomMax} onclick={() => zoomTo(zoom * 1.25)}>+</button>
      <button title="Fit all modules in view" onclick={zoomToFit}>Fit</button>
    </div>
  </div>
  {#if scope}
    <div class="scope-panel" aria-label="Signal scope">
      <svg viewBox="0 0 320 80" role="img" aria-label="Signal waveform">
        {#if scopePlot}
          <line x1="4" x2="316" y1={scopePlot.zero} y2={scopePlot.zero} stroke="currentColor" opacity="0.35" />
          <polyline points={scopePlot.points} fill="none" stroke="currentColor" />
        {/if}
      </svg>
      {#if scopePlot}<small>Value {scopePlot.last.toFixed(3)} · Min {scopePlot.min.toFixed(3)} · Max {scopePlot.max.toFixed(3)} · {scopePlot.ms.toFixed(1)} ms</small>
      {:else}<small>Waiting for signal</small>{/if}
    </div>
  {/if}
  <p class="muted hint">Right-click the rack to add a module. Drag either jack to connect. Click a connected input to unplug it. Ctrl + wheel zooms.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if editedModal}
    <form class="modal-editor" aria-label="Resonance table for {modalId}" bind:this={modalEditor}
      onsubmit={(event) => { event.preventDefault(); setModalTable($state.snapshot(modeRows)); }}>
      <h4>Resonance table · {modalId}</h4>
      <table>
        <thead><tr><th scope="col">Mode</th>
          {#each modeFields as [, field]}<th scope="col">{field.label}</th>{/each}
          <th scope="col">Remove</th>
        </tr></thead>
        <tbody>
          {#each modeRows as row, i (row)}
            <tr><th scope="row">{i + 1}</th>
              {#each modeFields as [key, field]}
                <td><input type="number" step="any" min={field.min} max={field.max} required
                  aria-label="Mode {i + 1} {field.label}" bind:value={row[key]} /></td>
              {/each}
              <td><button type="button" disabled={modeRows.length === 1} aria-label="Remove mode {i + 1}"
                onclick={() => modeRows = modeRows.filter((_, index) => index !== i)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="modal-actions">
        <button type="button" disabled={modeRows.length >= MODULAR_MODES}
          onclick={() => modeRows = [...modeRows, { ratio: 1, gain: 0.25, decay: 1 }]}>Add mode</button>
        <button type="button" onclick={() => modeRows = modularMaterialTable(editedModal.params.material)}>Copy selected material</button>
        <button type="submit">Apply table</button>
        <button type="button" disabled={!editedModal.modalTable} onclick={() => setModalTable(undefined)}>Use built-in material</button>
        <button type="button" onclick={() => modalId = ''}>Cancel</button>
      </div>
    </form>
  {/if}
  <p class="muted selection" role="status">
    {#if selected}Selected {selected.dir === 'out' ? 'output' : 'input'} {selected.id}.{selected.port.replace('param:', '')}. Choose {selected.dir === 'out' ? 'an input' : 'an output'}.{/if}
  </p>
  <div class="rack-scroll" bind:this={viewport} bind:clientWidth={viewWidth} bind:clientHeight={viewHeight}>
    <div class="rack-zoom" style:width={stageWidth * zoom + 'px'} style:height={stageHeight * zoom + 'px'}>
    <div class="modular-rack" role="group" aria-label="Patch canvas" class:panning={pan} bind:this={rack} style:width={stageWidth + 'px'}
      style:height={stageHeight + 'px'} style:transform="scale({zoom})" style:--card-width={cardWidth + 'px'}
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
          <label class="muted"><input type="checkbox" checked={marked.includes(n.id)} onchange={() => toggleMarked(n.id)}
            aria-label="Select {n.id}" /> <small>{n.id}</small></label>
          {#if n.type === 'modal'}
            <button type="button" class="resonance-button" aria-label="Edit resonance table for {n.id}"
              aria-expanded={modalId === n.id} onclick={() => editModes(n)}>{n.modalTable ? 'Edit custom resonance' : 'Edit resonance'}</button>
          {/if}
          {#if n.type === 'beatGrid'}
            <table class="beat-grid" aria-label="Beat Grid {n.id}">
              <thead>
                <tr><th scope="col">Out</th>
                  {#each BEAT_GRID_STEPS as key, step}<th scope="col">{step + 1}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each BEAT_GRID_LANES as lane, row}
                  <tr><th scope="row">{lane.toUpperCase()}</th>
                    {#each BEAT_GRID_STEPS as key, step}
                      {@const on = (n.params[key] & (1 << row)) !== 0}
                      <td><button type="button" class:enabled={on} aria-pressed={on}
                        aria-label="{n.id} output {lane.toUpperCase()}, step {step + 1}"
                        disabled={step >= n.params.length}
                        onclick={() => knob(n.id, key, n.params[key] ^ (1 << row), false)}></button></td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#each Object.entries(MODULAR_TYPES[n.type].params).filter(([, def]) => !def.gridStep) as [key, def]}
            {@const input = modularParamInput(key)}
            {@const connected = wiredInputs.has(jackKey(n.id, input, 'in'))}
            <div class="parameter-row">
              {#if def.fixed}<span aria-hidden="true"></span>{:else}{@render jack(n, input, 'in', key, true)}{/if}
              <label class="modular-param" class:driven={connected}>
                <span>{key}</span>
                {#if n.type === 'macro' && (key === 'from' || key === 'to')}
                  <input aria-label="{n.id} {key}" type="number" min={def.min} max={def.max} step={def.step}
                    value={n.params[key]} disabled={connected} onchange={(e) => {
                      if (e.currentTarget.value !== '') knob(n.id, key, e.currentTarget.value);
                      else e.currentTarget.value = String(n.params[key]);
                    }} />
                {:else}
                  <input aria-label="{n.id} {key}" type="range" min={def.min} max={def.max} step={def.step}
                    value={n.params[key]} disabled={connected || (key === 'material' && !!n.modalTable)}
                    oninput={(e) => knob(n.id, key, e.currentTarget.value)} />
                {/if}
                <output>{key === 'material' && n.modalTable ? 'Custom' : def.choices ? def.choices[n.params[key] - def.min] : Number(n.params[key]).toFixed(def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0)}</output>
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
            {@const d = curve(a, b)}
            {@const f = showSignals ? flow[c.from + '/' + c.port] : null}
            {#if f && f.level > 0.01}
              <path class="signal-glow" {d} stroke={colors[i % colors.length]} style:stroke-width={6 + 10 * f.level} stroke-opacity={0.55 * f.level} />
            {/if}
            <path data-wire={c.to + '/' + c.input} {d} stroke={colors[i % colors.length]} style:stroke-width={f ? 2 + 3 * f.swing : null} />
            {#if f && f.swing > 0.02}
              <path class="signal-flow" {d} style:stroke-width={2 + 3 * f.swing} stroke-opacity={0.25 + 0.65 * f.swing}
                stroke-dasharray="{f.period * 0.55} {f.period * 0.45}" stroke-dashoffset={f.offset % f.period} />
            {/if}
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
      <label>
        <input type="text" aria-label="Macro {i + 1} name" placeholder="Macro {i + 1}" value={graph.macroNames[i]}
          onchange={(e) => commit({ ...graph, macroNames: graph.macroNames.with(i, e.currentTarget.value.trim()) })} />
        <input type="range" aria-label={graph.macroNames[i] || 'Macro ' + (i + 1)} min="0" max="1" step="0.01" value={graph.macros[i]}
          oninput={(e) => commit({ ...graph, macros: graph.macros.with(i, Number(e.currentTarget.value)) }, { skipHistory: true })} />
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
        <input type="search" class="menu-search" placeholder="Search modules" aria-label="Search modules"
          autocomplete="off" spellcheck="false" bind:value={menuQuery} />
        {#each menuResults as { type, def }, i (type)}
          {#if !menuQuery && def.category !== menuResults[i - 1]?.def.category}
            <span class="menu-group" role="presentation">{def.category}</span>
          {/if}
          <button role="menuitem" disabled={nodes.length >= 32} onclick={() => add(type, menu.position)}>{def.label}</button>
        {:else}
          <span class="menu-empty muted" role="presentation">No module matches “{menuQuery}”.</span>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .modular-toolbar,.modular-cables,.macros { display:flex; align-items:center; flex-wrap:wrap; gap:0.6rem }
  .modular-toolbar label { display:grid; gap:0.3rem }
  .modular-toolbar .signal-toggle { display:flex; align-items:center }
  .zoom-controls { display:flex; gap:2px; margin-left:auto }
  .zoom-controls button { min-width:2rem; padding:4px 8px }
  .zoom-level { min-width:3.6rem; font-variant-numeric:tabular-nums }
  .context-actions { position:fixed; z-index:20; display:grid; min-width:185px; max-height:calc(100dvh - 8px);
    overflow:auto; padding:4px; background:var(--panel-2); border:1px solid var(--line); border-radius:8px; box-shadow:0 5px 20px #0008 }
  .context-actions button { text-align:left; border-color:transparent; padding:5px 8px }
  .context-actions button:hover,.context-actions button:focus-visible { background:var(--panel) }
  .menu-search { margin:0 0 4px; padding:5px 8px; min-width:0 }
  .menu-group { padding:6px 8px 2px; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted) }
  .menu-empty { padding:5px 8px; font-size:0.8rem }
  .selection { min-height:1.2em; margin:0 0 0.4rem; font-size:0.8rem }
  .rack-scroll { overflow:auto; max-height:70vh; min-height:250px; border:1px solid var(--line,#555); border-radius:8px }
  .rack-zoom { overflow:clip }
  .modular-rack { position:relative; transform-origin:0 0; isolation:isolate; cursor:grab; background-image:radial-gradient(#46505e 1px,transparent 1px); background-size:18px 18px }
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
  .wires .signal-glow { stroke-linecap:round }
  .wires .signal-flow { stroke:#fff }
  .modular-cable { display:flex; align-items:center; gap:0.4rem; border:1px solid; border-radius:6px; padding:0.15rem 0.35rem }
  .macros label { display:grid; gap:0.35rem; font-size:0.8rem }
  .macros input { width:6rem }
  .scope-panel { width:min(100%, 320px); margin:0.5rem 0; }
  .scope-panel svg { display:block; width:100%; background:var(--panel, #172033); color:#71c7ff; }
  .modal-editor { margin:0.6rem 0; padding:0.7rem; border:1px solid var(--border, #34405a); overflow-x:auto; }
  .modal-editor h4 { margin:0 0 0.5rem; }
  .modal-editor table { border-spacing:0.35rem; text-align:left; }
  .modal-editor input { width:6rem; }
  .modal-actions { display:flex; flex-wrap:wrap; gap:0.4rem; }
  .resonance-button { margin:0.25rem 0; }
  .beat-grid { width:100%; border-spacing:0.1rem; margin:0.35rem 0; font-size:0.7rem; text-align:center }
  .beat-grid th, .beat-grid td { padding:0; }
  .beat-grid button { box-sizing:border-box; width:100%; min-width:1.05rem; height:1.15rem; padding:0; border-radius:0.2rem }
  .beat-grid button.enabled { background:var(--accent, #71c7ff); border-color:var(--accent, #71c7ff) }
  .beat-grid button:disabled { opacity:0.3 }
  h4 { margin:0.8rem 0 0.5rem }
</style>
