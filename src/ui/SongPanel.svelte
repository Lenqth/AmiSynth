<script>
  import {
    addPattern, addSlot, deletePattern, duplicatePattern, MAX_PATTERNS, MAX_REPEAT, MAX_SLOTS, moveSlot, removeSlot,
    renamePattern, setSlotPattern, setSlotRepeat, songBars,
  } from '../lib/song.js';
  import { app, editSong, persist, redo, undo } from '../lib/state.svelte.js';

  const song = $derived(app.song);
  const cur = $derived(song.patterns[song.current]);
  const bars = $derived(songBars(song));
  const nameOf = (id) => song.patterns.find((p) => p.id === id)?.name ?? '?';
  const indexOf = (id) => song.patterns.findIndex((p) => p.id === id);

  function select(i) {
    app.song.current = i;
    persist();
  }

  function setMode(mode) {
    app.playMode = mode;
    persist();
  }
</script>

<section class="card song">
  <div class="row">
    <div class="seg" role="group" aria-label="再生モード">
      <button class:active={app.playMode === 'pattern'} aria-pressed={app.playMode === 'pattern'} onclick={() => setMode('pattern')}
        title="編集中のパターンだけを繰り返し再生">パターンループ</button>
      <button class:active={app.playMode === 'song'} aria-pressed={app.playMode === 'song'} onclick={() => setMode('song')}
        title="下の曲順 (アレンジ) どおりに再生し、最後まで行ったら先頭に戻る">ソング</button>
    </div>
    <span class="spacer"></span>
    <button onclick={undo} disabled={!app.canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す">↶ 戻す</button>
    <button onclick={redo} disabled={!app.canRedo} title="やり直し (Ctrl+Shift+Z / Ctrl+Y)" aria-label="やり直し">↷ やり直し</button>
  </div>

  <div class="row">
    <span class="muted label">パターン</span>
    <div class="chips">
      {#each song.patterns as p, i (p.id)}
        <button class="chip" class:active={i === song.current} class:playing={app.playing && i === app.playIndex}
          aria-pressed={i === song.current} onclick={() => select(i)}>{p.name}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <label class="muted label">名前
      <input class="name" type="text" maxlength="24" value={cur.name} aria-label="パターン名"
        onchange={(e) => editSong((s) => renamePattern(s, s.current, e.currentTarget.value))} />
    </label>
    <button onclick={() => editSong((s) => addPattern(s))} disabled={song.patterns.length >= MAX_PATTERNS} title="空のパターンを追加">+ 新規</button>
    <button onclick={() => editSong((s) => duplicatePattern(s, s.current))} disabled={song.patterns.length >= MAX_PATTERNS}
      title="このパターンをコピーして新しいパターンを作る">複製</button>
    <button onclick={() => editSong((s) => deletePattern(s, s.current))} disabled={song.patterns.length <= 1}
      title="このパターンと、曲順の中のこのパターンを削除 (元に戻せます)">削除</button>
  </div>

  <div class="row arr-head">
    <span class="muted label">曲順</span>
    <span class="muted">{bars} 小節{song.arrangement.length === 0 ? ' (空のときはソングモードでも編集中のパターンをループ)' : ''}</span>
    <span class="spacer"></span>
    <button onclick={() => editSong((s) => addSlot(s, s.current))} disabled={song.arrangement.length >= MAX_SLOTS}
      title="編集中のパターンを曲順の最後に追加">+ {cur.name} を追加</button>
  </div>
  <ol class="slots">
    {#each song.arrangement as slot, k (k)}
      <li class="slot" class:playing={app.playing && app.playMode === 'song' && k === app.playSlot}>
        <span class="num muted">{k + 1}</span>
        <select value={indexOf(slot.pattern)} aria-label={`${k + 1} 番目のパターン`}
          onchange={(e) => editSong((s) => setSlotPattern(s, k, Number(e.currentTarget.value)))}>
          {#each song.patterns as p, i (p.id)}<option value={i}>{p.name}</option>{/each}
        </select>
        <button class="sm" onclick={() => editSong((s) => setSlotRepeat(s, k, slot.repeat - 1))} disabled={slot.repeat <= 1} aria-label="回数を減らす">−</button>
        <span class="rep" title={`${nameOf(slot.pattern)} を ${slot.repeat} 回`}>×{slot.repeat}</span>
        <button class="sm" onclick={() => editSong((s) => setSlotRepeat(s, k, slot.repeat + 1))} disabled={slot.repeat >= MAX_REPEAT} aria-label="回数を増やす">+</button>
        <button class="sm" onclick={() => editSong((s) => moveSlot(s, k, -1))} disabled={k === 0} aria-label="前へ">◀</button>
        <button class="sm" onclick={() => editSong((s) => moveSlot(s, k, 1))} disabled={k === song.arrangement.length - 1} aria-label="後ろへ">▶</button>
        <button class="sm" onclick={() => editSong((s) => removeSlot(s, k))} aria-label="曲順から外す">✕</button>
      </li>
    {/each}
  </ol>
</section>

<style>
  .song { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .label { display: flex; gap: 6px; align-items: center; }
  .seg { display: inline-flex; }
  .seg button { border-radius: 0; }
  .seg button:first-child { border-radius: 8px 0 0 8px; }
  .seg button:last-child { border-radius: 0 8px 8px 0; margin-left: -1px; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip { min-width: 40px; min-height: 36px; padding: 4px 10px; font-weight: 600; }
  .chip.playing, .slot.playing { box-shadow: inset 0 -3px 0 var(--accent-2); }
  .name { width: 9em; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; }
  .slots { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .slot { display: flex; align-items: center; gap: 3px; padding: 3px 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); }
  .slot select { min-height: 32px; }
  .num { min-width: 1.5em; text-align: right; }
  .rep { min-width: 2.2em; text-align: center; font-family: ui-monospace, Menlo, monospace; }
  .sm { min-width: 32px; min-height: 32px; padding: 2px 6px; }
  @media (pointer: coarse) {
    .sm { min-width: 40px; min-height: 40px; }
    .chip { min-height: 44px; min-width: 48px; }
  }
</style>
