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

  /** A group made only of Off/On switches (arp rhythm steps, drum outputs) is shown as toggle buttons. */
  const isToggleGroup = (items) => items.length > 1 && items.every((d) => d.options?.length === 2 && d.options[0] === 'Off');
  const shortName = (def, items) => {
    // "Arp Step 3" -> "3", "Kick Out In Main Mix" -> "Kick Out"
    const words = items.map((d) => d.name.split(' '));
    let common = 0;
    while (words.every((w) => w[common] === words[0][common])) common++;
    const rest = def.name.split(' ').slice(common).join(' ');
    return rest.replace(/ In Main Mix$/, '') || def.name;
  };
</script>

<div class="panel">
  {#each grouped as [group, items] (group)}
    <section class="card">
      <h3>{group}</h3>
      {#if isToggleGroup(items)}
        <div class="toggles">
          {#each items as def (def.id)}
            <button class="toggle" class:active={values[def.id] >= 0.5} title={`${def.name}
${def.description}
[${def.id}]`}
              onclick={() => onchange(def.id, values[def.id] >= 0.5 ? 0 : 1)}>{shortName(def, items)}</button>
          {/each}
        </div>
      {:else}
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
      {/if}
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
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .toggle {
    min-width: 34px;
    padding: 4px 6px;
    font-size: 11px;
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
