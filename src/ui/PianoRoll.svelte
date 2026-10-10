<script>
  import { onMount } from 'svelte';
  import { DRUM_PARTS } from '../dsp/params.js';
  import { STEPS, STEPS_PER_BEAT, BEATS_PER_BAR } from '../lib/pattern.js';
  import { BLACK_12, isPianoLike, noteDegree, noteLabel } from '../lib/tuning.js';

  /**
   * @type {{ pattern: import('../lib/pattern.js').Pattern, tuning: any, playStep: number,
   *   preview: (note:number)=>void, previewDrum: (note:number)=>void, onedit: ()=>void }}
   */
  let { pattern, tuning, playStep, preview, previewDrum, onedit } = $props();

  const LOW = 24;
  const HIGH = 108;
  const CW = 18;
  const CH = 13;
  const DH = 22;
  const rows = Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i);
  const W = STEPS * CW;
  const H = rows.length * CH;
  const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

  let noteLen = $state(2);
  /** @type {HTMLDivElement} */ let rollEl;
  /** @type {HTMLDivElement} */ let drumEl;

  onMount(() => {
    rollEl.scrollTop = (HIGH - 76) * CH;
  });

  function syncScroll(from, to) {
    if (to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  }

  function shade(note) {
    if (isPianoLike(tuning)) return BLACK_12[((note % 12) + 12) % 12] ? 'dark' : 'light';
    const { degree } = noteDegree(tuning, note);
    return degree === 0 ? 'root' : degree % 2 ? 'dark' : 'light';
  }

  // ---- synth notes ------------------------------------------------------
  let drag = null;

  function cellFrom(e, el, rowH) {
    const r = el.getBoundingClientRect();
    const step = Math.min(STEPS - 1, Math.max(0, Math.floor((e.clientX - r.left) / CW)));
    const row = Math.floor((e.clientY - r.top) / rowH);
    return { step, row, x: (e.clientX - r.left) / CW };
  }

  function findNote(note, step) {
    for (let i = pattern.notes.length - 1; i >= 0; i--) {
      const n = pattern.notes[i];
      if (n.note === note && step >= n.start && step < n.start + n.len) return i;
    }
    return -1;
  }

  function rollDown(e) {
    if (e.button !== 0) return;
    const svg = e.currentTarget;
    svg.setPointerCapture(e.pointerId);
    const { step, row, x } = cellFrom(e, svg, CH);
    const note = HIGH - row;
    const idx = findNote(note, step);
    if (idx >= 0) {
      const n = pattern.notes[idx];
      const nearEnd = x > n.start + n.len - 0.4 && n.len >= 1;
      drag = nearEnd
        ? { mode: 'resize', n, moved: false }
        : { mode: 'move', n, offset: step - n.start, moved: false, origin: `${n.note}:${n.start}` };
    } else {
      const n = { note, start: step, len: Math.min(noteLen, STEPS - step), vel: 100 };
      pattern.notes.push(n);
      drag = { mode: 'resize', n: pattern.notes[pattern.notes.length - 1], created: true, anchor: step, moved: false };
      preview(note);
    }
  }

  function rollMove(e) {
    if (!drag) return;
    const { step, row } = cellFrom(e, e.currentTarget, CH);
    const n = drag.n;
    if (drag.mode === 'resize') {
      const len = Math.max(1, Math.min(STEPS - n.start, step - n.start + 1));
      if (len !== n.len && (!drag.created || step !== drag.anchor || drag.moved)) {
        n.len = len;
        drag.moved = true;
      }
    } else {
      const note = Math.min(HIGH, Math.max(LOW, HIGH - row));
      const start = Math.min(STEPS - n.len, Math.max(0, step - drag.offset));
      if (note !== n.note || start !== n.start) {
        if (note !== n.note) preview(note);
        n.note = note;
        n.start = start;
        drag.moved = true;
      }
    }
  }

  function rollUp() {
    if (!drag) return;
    if (drag.mode === 'move' && !drag.moved) {
      const i = pattern.notes.indexOf(drag.n);
      if (i >= 0) pattern.notes.splice(i, 1);
    } else if (drag.mode === 'resize' && !drag.created) {
      noteLen = drag.n.len;
    }
    drag = null;
    onedit();
  }

  // ---- drums -------------------------------------------------------------
  let paint = null;

  function hitIndex(note, step) {
    return pattern.drums.findIndex((h) => h.note === note && h.step === step);
  }

  function applyPaint(note, step) {
    const i = hitIndex(note, step);
    if (paint.add && i < 0) {
      pattern.drums.push({ note, step, vel: paint.vel });
      previewDrum(note);
    } else if (!paint.add && i >= 0) pattern.drums.splice(i, 1);
  }

  function drumDown(e) {
    if (e.button !== 0) return;
    const svg = e.currentTarget;
    svg.setPointerCapture(e.pointerId);
    const { step, row } = cellFrom(e, svg, DH);
    const part = DRUM_PARTS[row];
    if (!part) return;
    paint = { add: hitIndex(part.note, step) < 0, row, vel: e.shiftKey ? 60 : 110, last: -1 };
    paint.last = step;
    applyPaint(part.note, step);
  }

  function drumMove(e) {
    if (!paint) return;
    const { step } = cellFrom(e, e.currentTarget, DH);
    if (step === paint.last) return;
    paint.last = step;
    applyPaint(DRUM_PARTS[paint.row].note, step);
  }

  function drumUp() {
    if (paint) onedit();
    paint = null;
  }
</script>

<div class="roll-tools">
  <label>新規ノート長
    <select bind:value={noteLen}>
      <option value={1}>1/16</option>
      <option value={2}>1/8</option>
      <option value={4}>1/4</option>
      <option value={8}>1/2</option>
      <option value={16}>1 小節</option>
    </select>
  </label>
  <span class="muted help">空きセルをクリック/ドラッグで追加・長さ指定 · ノートをクリックで削除 · ドラッグで移動 · 右端ドラッグで長さ変更 · ドラムは Shift+クリックで弱打</span>
</div>

<div class="roll card">
  <div class="scroller synth" bind:this={rollEl} onscroll={() => syncScroll(rollEl, drumEl)}>
    <div class="inner" style={`width: ${W + 56}px`}>
      <svg class="labels" width="56" height={H} aria-hidden="true">
        {#each rows as note, i (note)}
          <rect x="0" y={i * CH} width="56" height={CH} class={`lab ${shade(note)}`} />
          {#if shade(note) === 'root' || (isPianoLike(tuning) && note % 12 === 0) || !isPianoLike(tuning)}
            <text x="52" y={i * CH + CH - 3} text-anchor="end">{noteLabel(tuning, note)}</text>
          {/if}
        {/each}
      </svg>
      <svg
        class="grid"
        width={W}
        height={H}
        role="application"
        aria-label="Piano roll"
        onpointerdown={rollDown}
        onpointermove={rollMove}
        onpointerup={rollUp}
        onpointercancel={rollUp}
      >
        {#each rows as note, i (note)}
          <rect x="0" y={i * CH} width={W} height={CH} class={`row ${shade(note)}`} />
        {/each}
        {#each { length: STEPS + 1 } as _, s}
          <line x1={s * CW} x2={s * CW} y1="0" y2={H} class={s % STEPS_PER_BAR === 0 ? 'bar' : s % STEPS_PER_BEAT === 0 ? 'beat' : 'sub'} />
        {/each}
        {#if playStep >= 0}
          <rect x={playStep * CW} y="0" width={CW} height={H} class="playhead" />
        {/if}
        {#each pattern.notes as n, i (i)}
          <rect x={n.start * CW + 1} y={(HIGH - n.note) * CH + 1} width={n.len * CW - 2} height={CH - 2} rx="2"
            class="note" style={`opacity: ${0.45 + (0.55 * n.vel) / 127}`} />
        {/each}
      </svg>
    </div>
  </div>

  <div class="scroller drums" bind:this={drumEl} onscroll={() => syncScroll(drumEl, rollEl)}>
    <div class="inner" style={`width: ${W + 56}px`}>
      <svg class="labels" width="56" height={DRUM_PARTS.length * DH} aria-hidden="true">
        {#each DRUM_PARTS as part, i (part.note)}
          <rect x="0" y={i * DH} width="56" height={DH} class="lab light" />
          <text x="52" y={i * DH + DH - 7} text-anchor="end">{part.name.replace('Closed Hi-Hat', 'C.HH').replace('Open Hi-Hat', 'O.HH')}</text>
        {/each}
      </svg>
      <svg
        class="grid"
        width={W}
        height={DRUM_PARTS.length * DH}
        role="application"
        aria-label="Drum steps"
        onpointerdown={drumDown}
        onpointermove={drumMove}
        onpointerup={drumUp}
        onpointercancel={drumUp}
      >
        {#each DRUM_PARTS as part, i (part.note)}
          <rect x="0" y={i * DH} width={W} height={DH} class={`row ${i % 2 ? 'dark' : 'light'}`} />
        {/each}
        {#each { length: STEPS + 1 } as _, s}
          <line x1={s * CW} x2={s * CW} y1="0" y2={DRUM_PARTS.length * DH} class={s % STEPS_PER_BAR === 0 ? 'bar' : s % STEPS_PER_BEAT === 0 ? 'beat' : 'sub'} />
        {/each}
        {#if playStep >= 0}
          <rect x={playStep * CW} y="0" width={CW} height={DRUM_PARTS.length * DH} class="playhead" />
        {/if}
        {#each pattern.drums as h, i (i)}
          {@const row = DRUM_PARTS.findIndex((p) => p.note === h.note)}
          {#if row >= 0}
            <rect x={h.step * CW + 3} y={row * DH + 4} width={CW - 6} height={DH - 8} rx="3" class="hit"
              style={`opacity: ${0.35 + (0.65 * h.vel) / 127}`} />
          {/if}
        {/each}
      </svg>
    </div>
  </div>
</div>

<style>
  .roll-tools { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; font-size: 12px; }
  .roll-tools label { display: flex; gap: 6px; align-items: center; }
  .help { font-size: 11px; }
  .roll { padding: 0; overflow: hidden; }
  .scroller { overflow: auto; }
  .scroller.synth { height: 340px; border-bottom: 2px solid var(--line); }
  .scroller.drums { overflow-y: hidden; }
  .inner { display: flex; }
  .labels { position: sticky; left: 0; z-index: 2; flex: none; }
  .grid { flex: none; touch-action: none; cursor: crosshair; display: block; }
  .lab.light, .lab.root { fill: #222a38; }
  .lab.dark { fill: #161b24; }
  .lab.root { fill: #2c3547; }
  text { fill: var(--muted); font-size: 9px; font-family: ui-monospace, Menlo, monospace; pointer-events: none; }
  .row.light { fill: #1b212c; }
  .row.dark { fill: #161b24; }
  .row.root { fill: #222a38; }
  line.sub { stroke: #232a37; }
  line.beat { stroke: #2f3a4d; }
  line.bar { stroke: #4a5873; }
  .playhead { fill: rgba(90, 209, 200, 0.16); pointer-events: none; }
  .note { fill: var(--accent); stroke: #8a5a10; stroke-width: 1; }
  .hit { fill: var(--accent-2); }
</style>
