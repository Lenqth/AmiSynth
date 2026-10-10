<script>
  import { playable } from './touch.js';
  import { BLACK_12, isPianoLike, noteDegree, noteHz, noteLabel } from '../lib/tuning.js';
  import { isoKeyLabel, offsetToKeyLabel } from '../lib/pckeys.js';
  import { coarsePointerQuery, fitNotes, minKeyWidth } from '../lib/keysize.js';
  import { localFraction } from '../lib/rotate.js';
  import { hexPoints, isoCells } from '../lib/layouts.js';

  /**
   * @type {{ tuning: any, baseNote: number, held: Record<number, boolean>, playing?: Record<number, number>,
   *   noteOn: (n:number, vel:number)=>void, noteOff: (n:number)=>void, scale?: number,
   *   layout?: string, iso?: {right:number, up:number, rows:number}, fillHeight?: number }}
   */
  let {
    tuning, baseNote, held, playing = {}, noteOn, noteOff, scale = 1, layout = 'auto',
    iso = { right: 1, up: 5, rows: 4 }, fillHeight = 0,
  } = $props();

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
  // fillHeight (full-screen mode): use all the vertical space we are given
  const keyHeight = $derived(fillHeight > 0 ? fillHeight : Math.round(Math.min(240, Math.max(130, minKey * 3.6))));

  const pianoLike = $derived(isPianoLike(tuning));
  // piano only makes sense for 12 steps per octave; fall back to one row otherwise
  const mode = $derived(layout === 'auto' ? (pianoLike ? 'piano' : 'linear') : layout === 'piano' && !pianoLike ? 'linear' : layout);
  const piano = $derived(mode === 'piano');
  const notes = $derived(fitNotes(baseNote, width, minKey, (n) => piano && BLACK_12[n % 12]));
  const whites = $derived(piano ? notes.filter((n) => !BLACK_12[n % 12]) : notes);

  // ---- isomorphic layouts (grid / hex), drawn in SVG pixels
  const isoGeom = $derived.by(() => {
    if (mode !== 'grid' && mode !== 'hex') return null;
    const hex = mode === 'hex';
    const rows = Math.max(2, Math.min(8, Math.round(iso.rows)));
    // Cell width: normally the finger/mouse minimum. In full screen the chosen number of
    // rows is stretched to the available height, so cells grow instead of adding rows.
    let target = minKey;
    let maxW = Infinity; // hex: widest cell whose rows still fit the height
    if (fillHeight > 0) {
      const fromHeight = hex ? Math.sqrt(3) * (fillHeight / (0.5 + 1.5 * rows)) : fillHeight / rows;
      target = Math.max(minKey, Math.min(fromHeight, width / 4.5));
      if (hex) maxW = fromHeight;
    }
    const cols = Math.max(4, Math.min(32, Math.floor(width / target - (hex ? 0.5 : 0))));
    const w = Math.min(width / (cols + (hex ? 0.5 : 0)), maxW);
    const x0 = (width - w * (cols + (hex ? 0.5 : 0))) / 2; // centre when narrower than the box
    const R = w / Math.sqrt(3); // hex circumradius
    let ch = hex ? 1.5 * R : Math.max(minKey, Math.min(w, minKey * 1.4)); // row pitch
    if (fillHeight > 0 && !hex) ch = fillHeight / rows;
    const height = hex ? 2 * R + (rows - 1) * ch : rows * ch;
    const cells = isoCells({ cols, rows, base: baseNote, right: iso.right, up: iso.up, hex }).map((cell) => {
      const q = hex ? cell.c - (cell.r - (cell.r & 1)) / 2 : cell.c; // lattice column (same as the PC key mapping)
      const key = isoKeyLabel(q, cell.r, hex);
      const cx = x0 + (hex ? w / 2 + cell.c * w + (cell.r & 1) * (w / 2) : cell.c * w + w / 2);
      const cy = hex ? height - R - cell.r * ch : height - (cell.r + 0.5) * ch;
      return { ...cell, cx, cy, key };
    });
    return { hex, w, R, ch, height, cells };
  });

  function cellClass(n) {
    if (n < 0 || n > 127) return 'cell off';
    if (held[n]) return 'cell held';
    if (playing[n]) return 'cell playing';
    const { degree } = noteDegree(tuning, n);
    if (degree === 0) return 'cell root';
    return pianoLike && BLACK_12[((n % 12) + 12) % 12] ? 'cell dark' : 'cell light';
  }

  function cellLabel(n) {
    const { degree } = noteDegree(tuning, n);
    if (degree === 0) return noteLabel(tuning, n);
    return pianoLike ? noteLabel(tuning, n).replace(/-?\d+$/, '') : String(degree);
  }

  function blackLeft(n) {
    const whitesBefore = notes.filter((m) => m < n && !BLACK_12[m % 12]).length;
    return (whitesBefore / whites.length) * 100;
  }

  /** pointerId -> note */
  const active = new Map();

  function noteAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('[data-note]');
    if (!el) return { note: null, vel: 100 };
    const { fy } = localFraction(el, x, y);
    const vel = Math.round(40 + 87 * Math.min(1, Math.max(0, fy)));
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
  class:linear={mode === 'linear'}
  role="group"
  aria-label="On-screen keyboard"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  style={`height: ${isoGeom ? isoGeom.height : keyHeight}px`}
>
  {#if isoGeom}
    <svg class="iso" viewBox={`0 0 ${width} ${isoGeom.height}`} height={isoGeom.height} aria-hidden="true">
      {#each isoGeom.cells as cell (cell.c + ':' + cell.r)}
        {#if isoGeom.hex}
          <polygon points={hexPoints(cell.cx, cell.cy, isoGeom.w - 2)} class={cellClass(cell.note)}
            data-note={cell.note >= 0 && cell.note <= 127 ? cell.note : undefined}><title>{cell.note >= 0 && cell.note <= 127 ? title(cell.note) : ''}</title></polygon>
        {:else}
          <rect x={cell.cx - isoGeom.w / 2 + 1} y={cell.cy - isoGeom.ch / 2 + 1} width={isoGeom.w - 2} height={isoGeom.ch - 2} rx="4"
            class={cellClass(cell.note)} data-note={cell.note >= 0 && cell.note <= 127 ? cell.note : undefined}><title>{cell.note >= 0 && cell.note <= 127 ? title(cell.note) : ''}</title></rect>
        {/if}
        {#if cell.note >= 0 && cell.note <= 127}
          <text x={cell.cx} y={cell.cy + 4} text-anchor="middle" class="cell-label">{cellLabel(cell.note)}</text>
          {#if cell.key}<text x={cell.cx} y={cell.cy + 4 + Math.min(16, isoGeom.ch * 0.3)} text-anchor="middle" class="cell-key">{cell.key.toLowerCase()}</text>{/if}
        {/if}
      {/each}
    </svg>
  {:else if piano}
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
  .fit { width: 100%; min-width: 0; overflow: hidden; }
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

  /* width comes from CSS so the SVG never props its container open (it is measured from it) */
  .iso { display: block; width: 100%; }
  .cell { stroke: #0b0d12; stroke-width: 1; }
  .cell.light { fill: #2a3242; }
  .cell.dark { fill: #181d27; }
  .cell.root { fill: #3a4660; }
  .cell.off { fill: #11151c; }
  .cell.held { fill: var(--accent); }
  .cell.playing { fill: var(--accent-2); }
  .cell-label { fill: var(--muted); font-size: 11px; pointer-events: none; font-family: ui-monospace, Menlo, monospace; }
  .cell-key { fill: #6b7488; font-size: 9px; pointer-events: none; font-family: ui-monospace, Menlo, monospace; }

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
