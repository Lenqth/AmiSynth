<script>
  import { onMount } from 'svelte';
  import { DRUM_PARAMS, DRUM_PARTS, SYNTH_PARAMS } from './dsp/params.js';
  import { engine } from './lib/engine.js';
  import { demoPattern, emptyPattern, Sequencer } from './lib/pattern.js';
  import { codeToOffset, DRUM_KEYS, isTypingTarget } from './lib/pckeys.js';
  import {
    app, drumHit, flashDrum, persist, resetParams, setBend, setModwheel, setParam, setScale,
    startAudio, synthNoteOff, synthNoteOn,
  } from './lib/state.svelte.js';
  import { makeTuning } from './lib/tuning.js';
  import DrumPads from './ui/DrumPads.svelte';
  import Keyboard from './ui/Keyboard.svelte';
  import ParamPanel from './ui/ParamPanel.svelte';
  import PianoRoll from './ui/PianoRoll.svelte';
  import Scope from './ui/Scope.svelte';
  import TuningPanel from './ui/TuningPanel.svelte';
  import Wheels from './ui/Wheels.svelte';

  const tuning = $derived(makeTuning(app.synth, app.scale));
  const synthGroups = [...new Set(SYNTH_PARAMS.map((d) => d.group))].filter((g) => g !== 'Tuning');

  // Start the on-screen keyboard on a period boundary (degree 0) whenever the scale size changes.
  let lastSize = 0;
  $effect(() => {
    const size = tuning.size;
    if (size === lastSize) return;
    lastSize = size;
    app.baseNote = Math.max(0, 60 - size * Math.max(1, Math.round(12 / size)));
  });

  const seq = new Sequencer(engine, () => app.pattern, (note, time) => flashDrum(note, time));

  /** Start audio lazily on the first gesture, then run fn. */
  async function withAudio(fn) {
    if (!app.started) await startAudio();
    if (app.started) fn();
  }

  function noteOn(n, vel) {
    withAudio(() => synthNoteOn(n, vel));
  }

  function hit(note, vel) {
    withAudio(() => drumHit(note, vel));
  }

  function preview(note) {
    if (!app.started || app.playing) return;
    synthNoteOn(note, 90);
    setTimeout(() => synthNoteOff(note), 180);
  }

  function previewDrum(note) {
    if (!app.started || app.playing) return;
    drumHit(note, 100);
  }

  async function togglePlay() {
    if (app.playing) {
      seq.stop();
      app.playing = false;
      app.playStep = -1;
      app.held = {};
      return;
    }
    await withAudio(() => {
      seq.start();
      app.playing = true;
    });
  }

  function shiftOctave(dir) {
    const size = tuning.size;
    app.baseNote = Math.max(0, Math.min(127 - size, app.baseNote + dir * size));
  }

  // ---- PC keyboard --------------------------------------------------------
  /** @type {Map<string, {kind:'synth'|'drum', note:number}>} */
  const pressed = new Map();

  function keydown(e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.code === 'BracketLeft') return shiftOctave(-1);
    if (e.code === 'BracketRight') return shiftOctave(1);
    if (app.tab === 'drums') {
      const i = DRUM_KEYS.indexOf(e.code);
      if (i >= 0) {
        e.preventDefault();
        hit(DRUM_PARTS[i].note, 110);
      }
      return;
    }
    const off = codeToOffset(e.code, tuning.size);
    if (off == null) return;
    e.preventDefault();
    const note = app.baseNote + off;
    if (note > 127) return;
    pressed.set(e.code, { kind: 'synth', note });
    noteOn(note, 100);
  }

  function keyup(e) {
    const p = pressed.get(e.code);
    if (!p) return;
    pressed.delete(e.code);
    synthNoteOff(p.note);
  }

  /** Long-press on touch devices opens the context menu; suppress it except on text. */
  function contextmenu(e) {
    if (isTypingTarget(e.target) || e.target.closest?.('table, code')) return;
    e.preventDefault();
  }

  function releaseAll() {
    for (const p of pressed.values()) synthNoteOff(p.note);
    pressed.clear();
  }

  // ---- Web MIDI input -----------------------------------------------------
  async function enableMidi() {
    if (!navigator.requestMIDIAccess) {
      app.midiStatus = 'このブラウザは Web MIDI 非対応です';
      return;
    }
    try {
      await startAudio();
      const access = await navigator.requestMIDIAccess();
      const bind = () => {
        let count = 0;
        for (const input of access.inputs.values()) {
          count++;
          input.onmidimessage = (m) => onMidi(m.data);
        }
        app.midiStatus = count ? `MIDI 入力 ${count} 台 (ch10 = ドラム)` : 'MIDI 機器が見つかりません';
      };
      bind();
      access.onstatechange = bind;
    } catch (err) {
      app.midiStatus = `MIDI を有効化できません: ${err?.message ?? err}`;
    }
  }

  function onMidi(data) {
    const [status, d1, d2] = data;
    const type = status & 0xf0;
    if ((status & 0x0f) === 9) {
      if (type === 0x90 && d2 > 0) drumHit(d1, d2);
      return;
    }
    if (type === 0x90 && d2 > 0) app.held[d1] = true;
    else if (type === 0x80 || type === 0x90) delete app.held[d1];
    else if (type === 0xe0) app.bend = ((d2 << 7) | d1) / 8192 - 1;
    else if (type === 0xb0 && d1 === 1) app.modwheel = d2 / 127;
    engine.midi('synth', [status, d1 ?? 0, d2 ?? 0]);
  }

  onMount(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = seq.currentStep();
      if (s !== app.playStep) app.playStep = s;
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      seq.stop();
    };
  });

  const TABS = [
    { id: 'synth', label: 'Synth' },
    { id: 'drums', label: 'Drums' },
    { id: 'roll', label: 'Piano Roll' },
    { id: 'params', label: 'Parameters' },
  ];
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} onblur={releaseAll} oncontextmenu={contextmenu} />

<header>
  <div class="brand">
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path d="M4 22 L10 10 L10 22 L16 10 L16 22 L22 10 L22 22 L28 10" fill="none" stroke="#ffb547" stroke-width="2.5" stroke-linejoin="round"/></svg>
    <div>
      <h1>AmiSynth</h1>
      <p class="muted">LLM-friendly synth &amp; drums · AudioWorklet → JSFX</p>
    </div>
  </div>

  <div class="transport">
    {#if !app.started}
      <button class="primary" onclick={startAudio} disabled={app.starting}>{app.starting ? '起動中…' : '▶ オーディオ開始'}</button>
    {/if}
    <button class:active={app.playing} onclick={togglePlay} title="Space">{app.playing ? '■ Stop' : '▶ Play'}</button>
    <label class="bpm">BPM
      <input type="number" min="40" max="240" step="1" value={app.pattern.bpm}
        onchange={(e) => { app.pattern.bpm = Math.max(40, Math.min(240, Number(e.currentTarget.value) || 120)); persist(); }} />
    </label>
    <button onclick={enableMidi} title="Web MIDI 入力 (ch10 はドラムへ)">MIDI</button>
  </div>

  <div class="scope"><Scope /></div>
</header>

{#if app.error}<p class="error">{app.error}</p>{/if}
{#if app.midiStatus}<p class="muted status">{app.midiStatus}</p>{/if}

<nav>
  {#each TABS as t (t.id)}
    <button class:active={app.tab === t.id} onclick={() => (app.tab = t.id)}>{t.label}</button>
  {/each}
</nav>

<main>
  {#if app.tab === 'synth'}
    <section class="card play">
      <Wheels bend={app.bend} modwheel={app.modwheel} onbend={setBend} onmod={setModwheel} />
      <div class="kb">
        <Keyboard {tuning} baseNote={app.baseNote} held={app.held} {noteOn} noteOff={synthNoteOff} />
        <div class="kb-tools muted">
          <button onclick={() => shiftOctave(-1)} title="[">◀ 周期</button>
          <span>PC キー: <kbd>Z</kbd>〜<kbd>/</kbd> と <kbd>Q</kbd>〜<kbd>P</kbd> · <kbd>[</kbd><kbd>]</kbd> で周期シフト · <kbd>Space</kbd> 再生</span>
          <button onclick={() => shiftOctave(1)} title="]">周期 ▶</button>
        </div>
      </div>
    </section>
    <div class="two">
      <TuningPanel values={app.synth} scale={app.scale} {tuning}
        onchange={(id, v) => setParam('synth', id, v)} onscale={setScale} />
      <div class="grow">
        <ParamPanel defs={SYNTH_PARAMS} values={app.synth} groups={synthGroups} onchange={(id, v) => setParam('synth', id, v)} />
        <button class="reset" onclick={() => resetParams('synth')}>シンセの音色を初期化</button>
      </div>
    </div>
  {:else if app.tab === 'drums'}
    <section class="card">
      <DrumPads flash={app.drumFlash} onhit={hit} />
      <p class="muted hint">パッドの上側ほど強く鳴ります · PC キー <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> · クローズ HH はオープン HH を止めます(チョーク)</p>
    </section>
    <ParamPanel defs={DRUM_PARAMS} values={app.drums} onchange={(id, v) => setParam('drums', id, v)} />
    <button class="reset" onclick={() => resetParams('drums')}>ドラムを初期化</button>
  {:else if app.tab === 'roll'}
    <div class="roll-head">
      <button onclick={() => { app.pattern = { ...demoPattern(), bpm: app.pattern.bpm }; persist(); }}>デモパターン</button>
      <button onclick={() => { app.pattern.notes = []; persist(); }}>ノート全消去</button>
      <button onclick={() => { app.pattern.drums = []; persist(); }}>ドラム全消去</button>
      <button onclick={() => { app.pattern = emptyPattern(app.pattern.bpm); persist(); }}>すべて消去</button>
      <span class="muted">4 小節ループ · 行は現在のチューニングのステップ</span>
    </div>
    <PianoRoll pattern={app.pattern} {tuning} playStep={app.playStep} {preview} {previewDrum} onedit={persist} />
  {:else}
    <section class="card">
      <h3>Parameter reference</h3>
      <p class="muted hint">JSFX の slider 宣言にそのまま対応します (<code>npm run gen:jsfx</code> で生成)。id は REAPER のオートメーション / MCP から見える名前です。</p>
      {#each [['Synth', SYNTH_PARAMS], ['Drums', DRUM_PARAMS]] as [title, defs] (title)}
        <h4>{title}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>id</th><th>name</th><th>range</th><th>default</th><th>description</th></tr></thead>
            <tbody>
              {#each defs as d (d.id)}
                <tr>
                  <td class="mono">{d.id}</td>
                  <td>{d.name}</td>
                  <td class="mono">{d.options ? d.options.map((o, i) => `${i}=${o}`).join(', ') : `${d.min} – ${d.max} ${d.unit}`}{d.scale === 'log' ? ' (log)' : ''}</td>
                  <td class="mono">{d.default}</td>
                  <td class="muted">{d.description}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    </section>
  {/if}
</main>

<footer class="muted">
  DSP はすべて AudioWorklet 内のサンプル単位ループ(Web Audio 組み込みノード不使用)。共通 DSP → <code>src/dsp/lib.js</code>、シンセ → <code>src/dsp/synth.js</code>、ドラム → <code>src/dsp/drums.js</code>。
</footer>

<style>
  header {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 16px;
    align-items: center;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    background: #121620;
  }
  .brand { display: flex; gap: 10px; align-items: center; }
  h1 { margin: 0; font-size: 20px; letter-spacing: 0.02em; }
  .brand p { margin: 0; font-size: 11px; }
  .transport { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .bpm { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
  .bpm input { width: 64px; }
  .scope { height: 48px; min-width: 120px; background: #0b0e14; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  @media (max-width: 760px) {
    header { grid-template-columns: 1fr; }
  }
  nav { display: flex; gap: 6px; padding: 12px 20px 0; flex-wrap: wrap; }
  main { padding: 12px 20px 20px; display: flex; flex-direction: column; gap: 12px; }
  .error { color: var(--danger); padding: 0 20px; }
  .status { padding: 0 20px; margin: 8px 0 0; font-size: 12px; }
  .play { display: flex; gap: 12px; align-items: stretch; }
  .kb { flex: 1; min-width: 0; overflow-x: auto; }
  .kb-tools { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
  .two { display: grid; grid-template-columns: 300px 1fr; gap: 12px; align-items: start; }
  @media (max-width: 900px) {
    .two { grid-template-columns: 1fr; }
  }
  .grow { min-width: 0; }
  .reset { align-self: flex-start; margin-top: 10px; font-size: 12px; }
  .hint { font-size: 12px; margin: 10px 0 0; }
  .roll-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  h4 { margin: 16px 0 6px; }
  footer { padding: 16px 20px 28px; font-size: 11px; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 0.95em; }
</style>
