<script>
  import { playable } from './touch.js';
  import { BLACK_12, isPianoLike, noteDegree, noteHz, noteLabel } from '../lib/tuning.js';
  import { offsetToKeyLabel } from '../lib/pckeys.js';
  import { coarsePointerQuery, fitNotes, minKeyWidth } from '../lib/keysize.js';

  /**
   * @type {{ tuning: any, baseNote: number, held: Record<number, boolean>, playing?: Record<number, number>,
   *   noteOn: (n:number, vel:number)=>void, noteOff: (n:number)=>void, scale?: number }}
   */
  let { tuning, baseNote, held, playing = {}, noteOn, noteOff, scale = 1 } = $props();

  // Fit as many keys as the width allows at a finger/mouse friendly minimum size.
  let width = $state(800);
  let coarse = $state(false);
  $effect(() => {
    const q = coarsePointerQuery();
    if (!q) return;
    coarse = q.matches;
    const on = () => (coarse = q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  });
  const minKey = $derived(minKeyWidth(coarse, scale));
  const keyHeight = $derived(Math.round(Math.min(240, Math.max(130, minKey * 3.6))));

  const piano = $derived(isPianoLike(tuning));
  const notes = $derived(fitNotes(baseNote, width, minKey, (n) => piano && BLACK_12[n % 12]));
  const whites = $derived(piano ? notes.filter((n) => !BLACK_12[n % 12]) : notes);

  function blackLeft(n) {
    const whitesBefore = notes.filter((m) => m < n && !BLACK_12[m % 12]).length;
    return (whitesBefore / whites.length) * 100;
  }

  /** pointerId -> note */
  const active = new Map();

  function noteAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('[data-note]');
    if (!el) return { note: null, vel: 100 };
    const r = el.getBoundingClientRect();
    const vel = Math.round(40 + 87 * Math.min(1, Math.max(0, (y - r.top) / r.height)));
    return { note: Number(el.getAttribute('data-note')), vel };
  }

  function down(e) {
    const { note, vel } = noteAt(e.clientX, e.clientY);
    if (note == null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    active.set(e.pointerId, note);
    noteOn(note, vel);
  }

  function move(e) {
    if (!active.has(e.pointerId)) return;
    const { note, vel } = noteAt(e.clientX, e.clientY);
    const prev = active.get(e.pointerId);
    if (note === prev) return;
    if (prev != null) noteOff(prev);
    active.set(e.pointerId, note);
    if (note != null) noteOn(note, vel);
  }

  function up(e) {
    const prev = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (prev != null) noteOff(prev);
  }

  function title(n) {
    return `${noteLabel(tuning, n)}  note ${n}  ${noteHz(tuning, n).toFixed(2)} Hz`;
  }
</script>

<div class="fit" bind:clientWidth={width}>
<div
  use:playable
  class="keyboard"
  class:linear={!piano}
  role="group"
  aria-label="On-screen keyboard"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  style={`height: ${keyHeight}px`}
>
  {#if piano}
    {#each whites as n (n)}
      <div class="white" class:held={held[n]} class:playing={!held[n] && playing[n]} data-note={n} title={title(n)}>
        <span class="kbd">{offsetToKeyLabel(n - baseNote, 12)}</span>
        {#if n % 12 === 0}<span class="name">{noteLabel(tuning, n)}</span>{/if}
      </div>
    {/each}
    {#each notes.filter((n) => BLACK_12[n % 12]) as n (n)}
      <div
        class="black"
        class:held={held[n]}
        class:playing={!held[n] && playing[n]}
        data-note={n}
        title={title(n)}
        style={`left: calc(${blackLeft(n)}% - ${(100 / whites.length) * 0.32}%); width: ${(100 / whites.length) * 0.64}%`}
      >
        <span class="kbd">{offsetToKeyLabel(n - baseNote, 12)}</span>
      </div>
    {/each}
  {:else}
    {#each notes as n (n)}
      {@const d = noteDegree(tuning, n)}
      <div class="step" class:root={d.degree === 0} class:held={held[n]} class:playing={!held[n] && playing[n]} data-note={n} title={title(n)}>
        <span class="kbd">{offsetToKeyLabel(n - baseNote, tuning.size)}</span>
        <span class="name">{d.degree === 0 ? noteLabel(tuning, n) : d.degree}</span>
      </div>
    {/each}
  {/if}
</div>
</div>

<style>
  .fit { width: 100%; min-width: 0; }
  .keyboard {
    position: relative;
    display: flex;
    touch-action: none;
    user-select: none;
    border-radius: 6px;
    overflow: hidden;
  }
  .white {
    flex: 1;
    background: var(--key-white);
    border-right: 1px solid #b8bfcc;
    position: relative;
    color: #59627a;
  }
  .white.held { background: var(--accent); }
  /* notes played by the sequencer (teal, like the drum steps) */
  .white.playing { background: var(--accent-2); }
  .black {
    position: absolute;
    top: 0;
    height: 60%;
    background: var(--key-black);
    border: 1px solid #0b0d12;
    border-radius: 0 0 4px 4px;
    z-index: 1;
    color: #9aa3b5;
  }
  .black.held { background: #c98420; }
  .black.playing { background: #2f9d95; }
  .kbd, .name {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 10px;
    pointer-events: none;
  }
  .kbd { bottom: 22px; text-transform: lowercase; opacity: 0.8; }
  .name { bottom: 4px; font-weight: 600; }
  .black .kbd { bottom: 6px; }

  .linear { gap: 2px; }
  .step {
    flex: 1;
    min-width: 20px;
    position: relative;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--muted);
  }
  .step.root { background: #2b3446; color: var(--text); }
  .step.held { background: var(--accent); color: #1b1408; }
  .step.playing { background: var(--accent-2); color: #0b1a19; }
</style>
