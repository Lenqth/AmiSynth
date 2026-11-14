<script>
  import { onMount } from 'svelte';
  import ModularRack from '../../src/ui/ModularRack.svelte';
  import { compileModularPatch } from '../../src/dsp/modular.js';

  let patch = $state(null);
  let error = $state('');
  let pending = null;
  let busy = false;
  let alive = true;

  async function update(next, options = {}) {
    const previous = patch;
    patch = next;
    // Keep the latest full graph when a slider generates changes faster than the bridge.
    const macroMask = next.macros.reduce((mask, value, i) => mask | (value !== previous.macros[i] ? 1 << i : 0), 0);
    pending = { patch: next, layoutOnly: !!options.layoutOnly, macroMask: macroMask | (pending?.macroMask ?? 0) };
    if (busy) return;
    busy = true;
    try {
      while (pending && alive) {
        const edit = pending;
        pending = null;
        const reply = await window.amisynthBridge({ action: 'edit', ...edit });
        if (!reply.ok) throw new Error(reply.error);
        if (!pending) patch = reply.patch;
      }
      error = '';
    } catch (e) {
      error = e.message;
      pending = null;
      patch = (await window.amisynthBridge({ action: 'read' })).patch;
    } finally { busy = false; }
  }

  onMount(() => {
    let polling = false;
    const refresh = async () => {
      if (busy || polling || !alive) return;
      polling = true;
      try {
        const reply = await window.amisynthBridge({ action: 'read' });
        if (!busy && alive) {
          const next = compileModularPatch(reply.patch).patch;
          if (JSON.stringify(next) !== JSON.stringify(patch)) patch = next;
        }
      } catch (e) { error = e.message; }
      finally { polling = false; }
    };
    refresh();
    const timer = setInterval(refresh, 200);
    return () => { alive = false; clearInterval(timer); };
  });
</script>

<main>
  <h1>AmiSynth Modular</h1>
  <p class="muted">Edits play through your DAW and are saved in its project.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if patch}<ModularRack {patch} onchange={update} />{:else}<p>Opening patch…</p>{/if}
</main>

<style>
  main { padding:12px; }
  h1 { font-size:18px; margin:0 0 4px; }
  p { margin:0 0 10px; }
</style>
