<script>
  import Knob from './Knob.svelte';

  /**
   * @type {{ defs: import('../dsp/params.js').ParamDef[], values: Record<string, number>,
   *   onchange: (id:string, v:number)=>void, groups?: string[], disabledIds?: string[] }}
   */
  let { defs, values, onchange, groups, disabledIds = [] } = $props();

  const grouped = $derived.by(() => {
    /** @type {Map<string, import('../dsp/params.js').ParamDef[]>} */
    const m = new Map();
    for (const d of defs) {
      if (groups && !groups.includes(d.group)) continue;
      if (!m.has(d.group)) m.set(d.group, []);
      m.get(d.group).push(d);
    }
    // in the order the caller lists the groups (definition order otherwise)
    const entries = [...m.entries()];
    return groups ? entries.sort((a, b) => groups.indexOf(a[0]) - groups.indexOf(b[0])) : entries;
  });
</script>

<div class="panel">
  {#each grouped as [group, items] (group)}
    <section class="card">
      <h3>{group}</h3>
      <div class="controls">
        {#each items as def (def.id)}
          {#if def.options}
            <label class="enum" title={`${def.name}\n${def.description}\n[${def.id}]`}>
              <span class="muted">{def.name.replace(/^Filter /, '')}</span>
              <select value={values[def.id]} onchange={(e) => onchange(def.id, Number(e.currentTarget.value))}>
                {#each def.options as opt, i (opt)}
                  <option value={i}>{opt}</option>
                {/each}
              </select>
            </label>
          {:else}
            <Knob {def} value={values[def.id]} onchange={(v) => onchange(def.id, v)} disabled={disabledIds.includes(def.id)} />
          {/if}
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .panel {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 4px;
    align-items: flex-start;
  }
  .enum {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    min-width: 96px;
    max-width: 100%;
    padding-top: 6px;
  }
</style>
