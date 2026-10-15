<script>
  import Knob from './Knob.svelte';
  import { MOD_DESTINATIONS, MOD_SLOTS, MOD_SOURCES, SYNTH_PARAMS } from '../dsp/params.js';

  /** @type {{ values: Record<string, number>, onchange: (id:string, v:number)=>void }} */
  let { values, onchange } = $props();

  const slots = Array.from({ length: MOD_SLOTS }, (_, i) => ({
    n: i + 1,
    src: SYNTH_PARAMS.find((d) => d.id === `mod${i + 1}_source`),
    dst: SYNTH_PARAMS.find((d) => d.id === `mod${i + 1}_destination`),
    amt: SYNTH_PARAMS.find((d) => d.id === `mod${i + 1}_amount`),
  }));

  /**
   * The amount slider covers -4800..4800 for every destination (JSFX sliders cannot change their
   * range); the knob here is sized to the chosen destination's unit instead.
   */
  function amountDef(slot) {
    const d = MOD_DESTINATIONS[Math.round(values[slot.dst.id])] ?? MOD_DESTINATIONS[0];
    return { ...slot.amt, name: 'Amount', min: -d.range, max: d.range, step: d.step, unit: d.unit };
  }

  /** Changing the destination keeps the amount inside the new knob range. */
  function setDestination(slot, v) {
    onchange(slot.dst.id, v);
    if (!(v > 0)) return; // Off keeps the amount for when a destination is chosen again
    const r = MOD_DESTINATIONS[v]?.range ?? 1;
    const a = values[slot.amt.id];
    if (Math.abs(a) > r) onchange(slot.amt.id, Math.sign(a) * r);
  }

  const active = (slot) => values[slot.src.id] > 0 && values[slot.dst.id] > 0 && values[slot.amt.id] !== 0;
</script>

<section class="card matrix">
  <h3>Mod Matrix</h3>
  <p class="muted hint">
    ソース → 行き先 × 量 (行き先の単位: cents / oct / dB など)。ソース値 1 のときに量だけ動きます。LFO 1・LFO 2・Random は -1〜1、
    Mod Env・Velocity・Mod Wheel・Pressure は 0〜1、Key Track は中央 C からのオクターブ数。LFO Rate の行き先はグローバルなので、LFO・Mod Wheel・チャンネルプレッシャーだけが効きます。
  </p>
  <div class="slots">
    {#each slots as slot (slot.n)}
      <div class="slot" class:on={active(slot)}>
        <span class="num">{slot.n}</span>
        <label class="enum" title={`${slot.src.name}\n${slot.src.description}\n[${slot.src.id}]`}>
          <span class="muted">Source</span>
          <select value={values[slot.src.id]} onchange={(e) => onchange(slot.src.id, Number(e.currentTarget.value))}>
            {#each MOD_SOURCES as opt, i (opt)}<option value={i}>{opt === 'Sidechain' ? 'Sidechain (REAPER only)' : opt}</option>{/each}
          </select>
        </label>
        <span class="arrow" aria-hidden="true">→</span>
        <label class="enum" title={`${slot.dst.name}\n${slot.dst.description}\n[${slot.dst.id}]`}>
          <span class="muted">Destination</span>
          <select value={values[slot.dst.id]} onchange={(e) => setDestination(slot, Number(e.currentTarget.value))}>
            {#each MOD_DESTINATIONS as d, i (d.name)}<option value={i}>{d.name}</option>{/each}
          </select>
        </label>
        <Knob def={amountDef(slot)} value={values[slot.amt.id]} onchange={(v) => onchange(slot.amt.id, v)}
          disabled={!(values[slot.src.id] > 0 && values[slot.dst.id] > 0)} />
      </div>
    {/each}
  </div>
</section>

<style>
  .matrix { margin-top: 10px; }
  .hint { font-size: 11px; margin: 0 0 8px; }
  .slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 8px; }
  .slot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
    min-width: 0;
  }
  .slot.on { border-color: var(--accent-2); }
  .num { font-size: 12px; color: var(--muted); width: 12px; }
  .arrow { color: var(--muted); }
  .enum {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    min-width: 0;
    flex: 1;
  }
  .enum select { max-width: 100%; }
</style>
