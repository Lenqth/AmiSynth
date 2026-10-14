<script>
  import { playable } from './touch.js';
  import { DRUM_PARTS } from '../dsp/params.js';
  import { DRUM_KEYS } from '../lib/pckeys.js';

  /** @type {{ flash: Record<number, number>, onhit: (note:number, vel:number)=>void }} */
  let { flash, onhit } = $props();
  const KEYS = DRUM_KEYS.map((c) => c.replace('Key', '').replace('Comma', ',').replace('Period', '.').replace('Slash', '/'));

  function down(e, note) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    // higher on the pad = louder
    const vel = Math.round(127 - 77 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    onhit(note, vel);
  }
</script>

<div class="pads" use:playable>
  {#each DRUM_PARTS as part, i (part.note)}
    {#key flash[part.note]}
      <button class="pad" class:flash={flash[part.note]} onpointerdown={(e) => down(e, part.note)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onhit(part.note, 110))}>
        <span class="name">{part.name}</span>
        <span class="meta mono">note {part.note} · <kbd>{KEYS[i]}</kbd></span>
      </button>
    {/key}
  {/each}
</div>

<style>
  .pads {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 10px;
  }
  .pad {
    height: 96px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px;
    border-radius: 10px;
    background: linear-gradient(180deg, #252e3e, #1b212d);
    touch-action: none;
    user-select: none;
  }
  .pad.flash { animation: hit 220ms ease-out; }
  @keyframes hit {
    from { background: var(--accent); color: #1b1408; }
    to { background: linear-gradient(180deg, #252e3e, #1b212d); }
  }
  .name { font-weight: 600; font-size: 15px; }
  .meta { font-size: 11px; color: var(--muted); }
</style>
