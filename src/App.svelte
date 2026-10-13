<script>
  import { onMount } from 'svelte';
  import { DRUM_PARAMS, DRUM_PARTS, PHYS_PARAMS, SYNTH_PARAMS } from './dsp/params.js';
  import { engine } from './lib/engine.js';
  import { demoPattern, emptyPattern, pianoDemoPattern, Sequencer } from './lib/pattern.js';
  import { downloadPatternMidi } from './lib/midifile.js';
  import { codeToOffset, DRUM_KEYS, eventCode, isImeEvent, isoKeyCell, isTypingTarget } from './lib/pckeys.js';
  import {
    app, applyPreset, clearSeqHighlights, drumHit, flashDrum, flashSeqNote, persist, setBend, setMelodic, setModwheel,
    setParam, setScale, setSustain, startAudio, synthNoteOff, synthNoteOn,
  } from './lib/state.svelte.js';
  import { makeTuning } from './lib/tuning.js';
  import { coarsePointerQuery } from './lib/keysize.js';
  import { ISO_PRESETS, isoSteps, LAYOUTS } from './lib/layouts.js';
  import DrumPads from './ui/DrumPads.svelte';
  import Keyboard from './ui/Keyboard.svelte';
  import ParamPanel from './ui/ParamPanel.svelte';
  import PianoRoll from './ui/PianoRoll.svelte';
  import PresetBar from './ui/PresetBar.svelte';
  import { SYNTH_PRESETS } from './presets/synth.js';
  import { DRUM_PRESETS } from './presets/drums.js';
  import { PHYS_PRESETS } from './presets/phys.js';
  import PhysViz from './ui/PhysViz.svelte';
  import Scope from './ui/Scope.svelte';
  import TuningPanel from './ui/TuningPanel.svelte';
  import Wheels from './ui/Wheels.svelte';

  const tuning = $derived(makeTuning(app.synth, app.scale));
  // Grey out knobs that currently have no effect.
  const synthDisabled = $derived([
    ...(app.synth.osc1_waveform === 1 ? [] : ['osc1_pulse_width']),
    ...(app.synth.osc2_waveform === 1 ? [] : ['osc2_pulse_width']),
    ...(app.synth.osc1_waveform === 1 || app.synth.osc2_waveform === 1 ? [] : ['lfo_pulse_width']),
    ...(app.synth.unison_voices > 1 ? [] : ['unison_detune_cents', 'unison_stereo_width', 'unison_detune_curve', 'unison_side_level']),
    ...(app.synth.lfo_sync > 0 ? ['lfo_rate_hz'] : []),
    ...(app.synth.arp_mode > 0 ? [] : ['arp_octaves', 'arp_gate', 'arp_swing_percent', 'arp_steps']),
  ]);
  // CPU grows with (notes sounding) x (unison copies): show the worst case
  const synthLoad = $derived.by(() => {
    const voices = app.synth.voice_mode >= 0.5 ? 1 : Math.round(app.synth.voice_count);
    const unison = Math.round(app.synth.unison_voices);
    return { voices, unison, total: voices * unison };
  });
  const isoSettings = $derived(app.kbLayout === 'grid' || app.kbLayout === 'hex' ? app.iso[app.kbLayout] : null);
  const isoResolved = $derived(
    isoSettings ? { ...isoSteps(app.kbLayout, isoSettings.preset, tuning, isoSettings), rows: isoSettings.rows } : undefined,
  );
  // Physical tab: show only the controls of the selected model
  // only the knobs of the selected model (+ shared ones) are shown
  const PHYS_MODEL_GROUPS = ['String', 'Modal', 'Bowed', 'Wind', 'Mesh', 'Stiff String', 'Brass'];
  const physModel = $derived(Math.round(app.phys.phys_model));
  const physGroups = $derived(['Model', PHYS_MODEL_GROUPS[Math.round(app.phys.phys_model)] ?? 'String', 'Amp', 'Output']);

  function toggleViz() {
    app.physViz = !app.physViz;
    engine.setPhysViz(app.physViz);
  }

  /** Tabs with a keyboard also choose which instrument it plays. */
  function selectTab(id) {
    app.tab = id;
    if (id === 'synth' || id === 'phys') setMelodic(id);
    persist();
  }

  // ---- full-screen keyboard -------------------------------------------------
  let fullscreen = $state(false);
  let fsBodyHeight = $state(0);
  let fsToolsOpen = $state(false);
  const fsHeight = $derived(Math.max(120, fsBodyHeight - 16));

  // In-page rotation: a touch device held upright gets the overlay turned 90 deg by CSS, so the
  // keyboard is landscape without asking the OS to rotate (which some tablets fight).
  // fsRotMode: 'auto' (90 deg while portrait), 'flip' (-90 deg while portrait), 'off'.
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
  let fsRotMode = $state(loadRotMode());
  const coarse = coarsePointerQuery();
  let isCoarse = $state(coarse?.matches ?? false);
  coarse?.addEventListener?.('change', (e) => (isCoarse = e.matches));
  const portrait = $derived(vh > vw);
  const fsRot = $derived(!isCoarse || !portrait || fsRotMode === 'off' ? 0 : fsRotMode === 'flip' ? -90 : 90);

  function loadRotMode() {
    try {
      const v = localStorage.getItem('amisynth.fsRot');
      return v === 'flip' || v === 'off' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  function cycleRot() {
    fsRotMode = fsRotMode === 'auto' ? 'flip' : fsRotMode === 'flip' ? 'off' : 'auto';
    try {
      localStorage.setItem('amisynth.fsRot', fsRotMode);
    } catch {
      /* private mode etc. */
    }
  }

  async function enterFullscreen() {
    fullscreen = true;
    document.body.style.overflow = 'hidden';
    // Real fullscreen hides the browser UI where supported; the overlay alone works everywhere (e.g. iPhone).
    // No orientation lock: on some tablets (e.g. Xiaomi HyperOS) forcing landscape fights the OS rotation
    // setting, the OS rotates back and the browser drops out of fullscreen.
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      /* not supported / not allowed: overlay only */
    }
  }

  function exitFullscreen() {
    fullscreen = false;
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  // ---- audio export (offline render in a worker, same DSP as playback) --------------------
  let exportFormat = $state('wav');
  let exportLoops = $state(1);
  let exportNormalize = $state(false);
  let exportBusy = $state(false);
  let exportProgress = $state(0);
  let exportMsg = $state('');

  function exportAudio() {
    exportBusy = true;
    exportProgress = 0;
    exportMsg = '';
    const worker = new Worker(new URL('./lib/render-worker.js', import.meta.url), { type: 'module' });
    const format = exportFormat;
    const bpm = app.pattern.bpm;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        exportProgress = m.value;
        return;
      }
      worker.terminate();
      exportBusy = false;
      if (m.type === 'error') {
        exportMsg = `失敗しました: ${m.message}`;
        return;
      }
      const url = URL.createObjectURL(new Blob([m.bytes], { type: m.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `amisynth-pattern-${bpm}bpm.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const db = 20 * Math.log10(Math.max(m.peak, 1e-9));
      exportMsg = `${m.seconds.toFixed(1)} 秒 · ピーク ${db.toFixed(1)} dBFS · ${Number.isFinite(m.lufs) ? m.lufs.toFixed(1) : '-inf'} LUFS${m.peak > 1 ? ' (クリップあり: ノーマライズ推奨)' : ''}`;
    };
    worker.onerror = (e) => {
      worker.terminate();
      exportBusy = false;
      exportMsg = `失敗しました: ${e.message}`;
    };
    worker.postMessage({
      pattern: $state.snapshot(app.pattern),
      params: { synth: $state.snapshot(app.synth), phys: $state.snapshot(app.phys), drums: $state.snapshot(app.drums) },
      scaleCents: app.scale ? [...app.scale.cents] : null,
      sampleRate: engine.ctx?.sampleRate ?? 48000,
      loops: Number(exportLoops),
      format,
      normalize: exportNormalize,
    });
  }

  /** demo with dynamics: switches the melodic instrument to the physical Grand Piano */
  function loadPianoDemo() {
    app.pattern = pianoDemoPattern();
    const piano = PHYS_PRESETS.find((p) => p.name === 'Grand Piano');
    if (piano) applyPreset('phys', piano);
    persist();
  }

  function stepPreset(dir) {
    const target = app.melodic;
    const list = [...(target === 'phys' ? PHYS_PRESETS : SYNTH_PRESETS), ...app.userPresets[target]];
    const i = list.findIndex((p) => p.name === app.presetName[target]);
    applyPreset(target, list[(i + dir + list.length) % list.length]);
  }

  const synthGroups = [...new Set(SYNTH_PARAMS.map((d) => d.group))].filter((g) => g !== 'Tuning');

  // Start the on-screen keyboard on a period boundary (degree 0) whenever the scale size changes.
  let lastSize = 0;
  $effect(() => {
    const size = tuning.size;
    if (size === lastSize) return;
    lastSize = size;
    app.baseNote = Math.max(0, 60 - size * Math.max(1, Math.round(12 / size)));
  });

  const seq = new Sequencer(engine, () => app.pattern, flashDrum, flashSeqNote);

  /** Start audio lazily on the first gesture, then run fn. */
  async function withAudio(fn) {
    if (!app.started) await startAudio();
    if (app.started) fn();
  }

  /** Notes pressed while audio is still starting; released ones are dropped so they can't hang. */
  const pendingNotes = new Set();

  function noteOn(n, vel) {
    if (app.started) {
      synthNoteOn(n, vel);
      return;
    }
    pendingNotes.add(n);
    startAudio().then(() => {
      if (app.started && pendingNotes.delete(n)) synthNoteOn(n, vel);
    });
  }

  function noteOff(n) {
    pendingNotes.delete(n);
    synthNoteOff(n);
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
      clearSeqHighlights();
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

  /** Set when an IME swallowed a key: the next keyup (which has the real code) plays a short note. */
  let imeFallback = false;
  let imeHint = $state(false);

  /** Resolve a key to a synth note / drum pad for the current tab. */
  function keyTarget(code) {
    if (app.tab === 'drums') {
      const i = DRUM_KEYS.indexOf(code);
      return i >= 0 ? { kind: 'drum', note: DRUM_PARTS[i].note } : null;
    }
    // isomorphic layouts: the PC keyboard rows are the lattice (Z = bottom-left cell)
    if (isoResolved && (app.kbLayout === 'grid' || app.kbLayout === 'hex')) {
      const cell = isoKeyCell(code, app.kbLayout === 'hex');
      if (!cell) return null;
      const note = app.baseNote + cell.q * isoResolved.right + cell.r * isoResolved.up;
      return note >= 0 && note <= 127 ? { kind: 'synth', note } : null;
    }
    const off = codeToOffset(code, tuning.size);
    if (off == null) return null;
    const note = app.baseNote + off;
    return note <= 127 ? { kind: 'synth', note } : null;
  }

  function keydown(e) {
    if (e.key === 'Escape' && fullscreen) {
      exitFullscreen();
      return;
    }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    const code = eventCode(e);
    if (!code) {
      if (isImeEvent(e)) {
        imeFallback = true;
        imeHint = true;
      }
      return;
    }
    if (code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (code === 'BracketLeft') return shiftOctave(-1);
    if (code === 'BracketRight') return shiftOctave(1);
    const t = keyTarget(code);
    if (!t) return;
    e.preventDefault();
    if (t.kind === 'drum') {
      hit(t.note, 110);
      return;
    }
    pressed.set(code, t);
    noteOn(t.note, 100);
  }

  function keyup(e) {
    const code = eventCode(e);
    if (!code) return;
    const p = pressed.get(code);
    if (p) {
      pressed.delete(code);
      noteOff(p.note);
      return;
    }
    // IME ate the keydown: at least sound the note briefly on release.
    if (imeFallback && !isTypingTarget(e.target)) {
      imeFallback = false;
      const t = keyTarget(code);
      if (!t) return;
      if (t.kind === 'drum') hit(t.note, 110);
      else {
        noteOn(t.note, 100);
        setTimeout(() => noteOff(t.note), 180);
      }
    }
  }

  /** Long-press on touch devices opens the context menu; suppress it except on text. */
  function contextmenu(e) {
    if (isTypingTarget(e.target) || e.target.closest?.('table, code')) return;
    e.preventDefault();
  }

  function releaseAll() {
    for (const p of pressed.values()) noteOff(p.note);
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
    if (type === 0x90 && d2 > 0) {
      app.held[d1] = d2;
      app.lastVel = d2;
    }
    else if (type === 0x80 || type === 0x90) delete app.held[d1];
    else if (type === 0xe0) app.bend = ((d2 << 7) | d1) / 8192 - 1;
    else if (type === 0xb0 && d1 === 1) app.modwheel = d2 / 127;
    else if (type === 0xb0 && d1 === 64) app.sustain = d2 >= 64;
    else if (type === 0xb0 && (d1 === 120 || d1 === 121 || d1 === 123)) {
      setSustain(false);
      if (d1 !== 121) app.held = {};
    }
    engine.midi(app.melodic, [status, d1 ?? 0, d2 ?? 0]);
  }

  onMount(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = seq.currentStep();
      if (s !== app.playStep) app.playStep = s;
    };
    loop();
    // Leaving *browser* fullscreen (rotation, back gesture, Esc) keeps the overlay: it still fills
    // the viewport, and it closes only via its ✕ button / Esc key.
    return () => {
      cancelAnimationFrame(raf);
      seq.stop();
    };
  });

  const TABS = [
    { id: 'synth', label: 'Synth' },
    { id: 'phys', label: 'Physical' },
    { id: 'drums', label: 'Drums' },
    { id: 'roll', label: 'Piano Roll' },
    { id: 'params', label: 'Parameters' },
  ];
</script>

{#snippet kbTools()}
  <div class="kb-tools muted">
    <button onclick={() => shiftOctave(-1)} title="[">◀ 周期</button>
    <label class="kbopt">配列
      <select value={app.kbLayout} onchange={(e) => { app.kbLayout = e.currentTarget.value; persist(); }}>
        {#each LAYOUTS as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
    </label>
    {#if isoSettings}
      <label class="kbopt">
        <select value={isoSettings.preset} onchange={(e) => { isoSettings.preset = e.currentTarget.value; persist(); }}>
          {#each ISO_PRESETS[app.kbLayout] as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          <option value="custom">カスタム</option>
        </select>
      </label>
      {#if isoSettings.preset === 'custom'}
        <label class="kbopt" title="右隣のセルとの音程 (ステップ数)">→
          <input type="number" min="-24" max="24" value={isoSettings.right}
            onchange={(e) => { isoSettings.right = Number(e.currentTarget.value) || 1; persist(); }} />
        </label>
        <label class="kbopt" title={app.kbLayout === 'hex' ? '右上のセルとの音程 (左上は ↗ − →)' : '上のセルとの音程 (ステップ数)'}>{app.kbLayout === 'hex' ? '↗' : '↑'}
          <input type="number" min="-24" max="24" value={isoSettings.up}
            onchange={(e) => { isoSettings.up = Number(e.currentTarget.value) || 1; persist(); }} />
        </label>
      {:else}
        <span class="steps">→{isoResolved.right} {app.kbLayout === 'hex' ? '↗' : '↑'}{isoResolved.up} ステップ</span>
      {/if}
      <label class="kbopt">段
        <select value={isoSettings.rows} onchange={(e) => { isoSettings.rows = Number(e.currentTarget.value); persist(); }}>
          {#each [2, 3, 4, 5, 6, 7, 8] as n (n)}<option value={n}>{n}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="kbopt" title="押す位置: 鍵の上の方ほど弱く、手前 (下) ほど強く鳴ります (格子 / 六角形はキーの中の縦位置)">強さ
      <select value={app.kbVelMode} onchange={(e) => { app.kbVelMode = e.currentTarget.value; persist(); }}>
        <option value="pos">押す位置</option>
        <option value="fixed">固定</option>
      </select>
      {#if app.kbVelMode === 'fixed'}
        <input type="number" min="1" max="127" value={app.kbVelFixed} aria-label="固定ベロシティ"
          onchange={(e) => { app.kbVelFixed = Math.max(1, Math.min(127, Math.round(Number(e.currentTarget.value) || 100))); persist(); }} />
      {/if}
      <span class="steps vel-readout" title="最後に弾いた音のベロシティ">vel {app.lastVel || '-'}</span>
    </label>
    <label class="keysize" title="鍵盤の最小幅 (タッチは約 9 mm 相当が基準)">鍵盤サイズ
      <input type="range" min="0.6" max="2" step="0.05" value={app.keyScale}
        oninput={(e) => { app.keyScale = Number(e.currentTarget.value); persist(); }} />
    </label>
    {#if isoSettings}
      <span class="pc-hint">PC キー: 下 4 段 (<kbd>Z</kbd> 段〜数字段) がそのまま等音配列 · <kbd>Z</kbd> = 左下 · <kbd>[</kbd><kbd>]</kbd> で周期シフト</span>
    {:else}
      <span class="pc-hint">PC キー: <kbd>Z</kbd>〜<kbd>/</kbd> と <kbd>Q</kbd>〜<kbd>P</kbd> · <kbd>[</kbd><kbd>]</kbd> で周期シフト · <kbd>Space</kbd> 再生</span>
    {/if}
    <button onclick={() => shiftOctave(1)} title="]">周期 ▶</button>
    {#if !fullscreen}
    <button class="fs-btn" onclick={enterFullscreen} title="鍵盤を全画面表示">⛶ 全画面</button>
  {/if}
</div>
{/snippet}

{#snippet playCard()}
  <section class="card play" class:fs-play={fullscreen}>
    <div class="performance-controls">
    <Wheels bend={app.bend} modwheel={app.modwheel} onbend={setBend} onmod={setModwheel} height={fullscreen ? Math.max(50, fsHeight - 34) : 116} />
    <button class:active={app.sustain} aria-pressed={app.sustain}
      title="Sustain pedal (CC64): PhysicalはOutputのSustain Pedal設定に従います"
      onclick={async () => { await startAudio(); setSustain(!app.sustain); }}>Sustain</button>
    </div>
    <div class="kb">
      <Keyboard {tuning} baseNote={app.baseNote} held={app.held} playing={app.seqHeld} {noteOn} {noteOff} scale={app.keyScale}
        velMode={app.kbVelMode} velFixed={app.kbVelFixed} layout={app.kbLayout} iso={isoResolved} fillHeight={fullscreen ? fsHeight : 0} />
      {#if imeHint}
        <p class="ime-hint">
          日本語入力 (IME) がオンのため、PC キーが IME に取られています。半角英数に切り替えると押している間鳴り続けます
          (今は離した瞬間に短く鳴らしています)。
          <button onclick={() => (imeHint = false)}>閉じる</button>
        </p>
      {/if}
      {#if !fullscreen}{@render kbTools()}{/if}
    </div>
  </section>
{/snippet}

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} onkeydown={keydown} onkeyup={keyup} onblur={releaseAll} oncontextmenu={contextmenu} />

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
        onchange={(e) => {
          app.pattern.bpm = Math.max(40, Math.min(240, Number(e.currentTarget.value) || 120));
          if (!seq.playing) engine.transport(app.pattern.bpm, false);
          persist();
        }} />
    </label>
    <button onclick={enableMidi} title="Web MIDI 入力 (ch10 はドラムへ)">MIDI</button>
  </div>

  <div class="scope"><Scope /></div>
</header>

{#if app.error}<p class="error">{app.error}</p>{/if}
{#if app.midiStatus}<p class="muted status">{app.midiStatus}</p>{/if}

<nav>
  {#each TABS as t (t.id)}
    <button class:active={app.tab === t.id} onclick={() => selectTab(t.id)}>{t.label}</button>
  {/each}
</nav>

<main>
  {#if app.tab === 'synth'}
    {@render playCard()}
    <PresetBar target="synth" defs={SYNTH_PARAMS} builtins={SYNTH_PRESETS} />
    <div class="two">
      <TuningPanel values={app.synth} scale={app.scale} {tuning}
        onchange={(id, v) => setParam('synth', id, v)} onscale={setScale} />
      <div class="grow">
        <p class="muted hint load" class:heavy={synthLoad.total > 24}
          title="同時に鳴るノート数 × ユニゾン数 = 最大で同時に動くオシレーター組の数 (CPU 負荷の目安)">
          実効発音数: 最大 {synthLoad.voices} ノート × ユニゾン {synthLoad.unison} = {synthLoad.total}
          {#if app.synth.arp_mode > 0} · アルペジエーター ON (テンポは BPM / ピアノロールに同期){/if}
        </p>
        <ParamPanel defs={SYNTH_PARAMS} values={app.synth} groups={synthGroups} onchange={(id, v) => setParam('synth', id, v)}
          disabledIds={synthDisabled} />
      </div>
    </div>
  {:else if app.tab === 'phys'}
    {@render playCard()}
    <PresetBar target="phys" defs={PHYS_PARAMS} builtins={PHYS_PRESETS} />
    <section class="card">
      <div class="viz-head">
        <h3>Physical model</h3>
        <button class:active={app.physViz} onclick={toggleViz}>{app.physViz ? '可視化 ON' : '可視化 OFF'}</button>
      </div>
      {#if physModel === 0}
        <p class="explain">
          <b>弦 (Karplus-Strong)</b>: 長さ ≈ サンプルレート ÷ 周波数 の遅延線 (リングバッファ) を励起 (ノイズ = 指で弾く / パルス = ハンマー) で満たし、
          毎サンプル「一番古い値を読む → ローパス (Damping) → 減衰 (Decay) → 書き戻す」を繰り返します。1 往復の時間が音程になり、
          高い倍音ほど 1 往復あたりに多く削られるので、実際の弦のように明るい音が先に消えます。Pick Position は励起にくし形フィルターをかけ、
          弾いた位置に節がある倍音を消します (0.5 = 中央 → 偶数次倍音が消える)。
        </p>
      {:else if physModel === 1}
        <p class="explain">
          <b>モーダル合成</b>: 物体の振動を「減衰する正弦波 (モード) の和」として扱います。各モードは 2 極の共振フィルターで、周波数比は素材ごとに決まっています
          (例: マリンバの鍵盤は 1 : 3.9 : 9.2 に調律され、調律していない棒は 1 : 2.76 : 5.40)。マレットは短いパルスで、硬いほど (短いほど) 高いモードまで励起します。
          打つ位置に節があるモードは鳴りにくくなります。Ratio Stretch で比率を整数倍から曲げると「倍音的 ↔ 非倍音的」の違いを聴き比べられます。
        </p>
      {:else if physModel === 2}
        <p class="explain">
          <b>擦弦 (デジタル導波管 + 弓の摩擦)</b>: 弦を「弓 → ナット」と「弓 → 駒」の 2 本の遅延線に分け、両端で反射する波を往復させます。
          弓の位置では、弓と弦の速度差から摩擦力を求めます。速度差が小さいと弦は弓に張り付いて一緒に動き (スティック)、大きくなると滑って戻ります (スリップ)。
          これが周期ごとに 1 回起きる「ヘルムホルツ運動」が、バイオリン族ののこぎり波に近い音の正体です。Bow Pressure が強すぎるとガリガリ、弱すぎるとかすれた倍音だけが鳴るのも実際の楽器と同じです。
        </p>
      {:else if physModel === 3}
        <p class="explain">
          <b>管楽器 (リード / エアジェット + 管)</b>: 管を遅延線で表し、吹き口に非線形な「弁」を置きます。
          クラリネットはリードが管内の圧力差で開閉し、片側が閉じた管なので奇数倍音が中心です。管の端では高音ほど外へ逃げる (トーンホール / ベル) ので、反射にローパスをかけています。
          フルートは、管内の空気の揺れが息の流れ (ジェット) を曲げ、それが少し遅れて歌口のエッジに届き、管の内と外に振り分けられる帰還で発音します。Embouchure はジェットとエッジのずれで、大きいほど偶数倍音が増えます。
          息は完全には一定でないので、ゆっくりした圧力の揺らぎと、息のノイズ (Breath Noise) を加えています。
        </p>
      {:else if physModel === 4}
        <p class="explain">
          <b>膜 / 板 (2D 波動方程式)</b>: 太鼓の膜や金属板を N×N の格子で近似し、各点が上下左右の 4 点に引っ張られる差分方程式を毎サンプル計算します (縁は固定)。
          弦と違い、2 次元の固有振動は整数倍に並ばない (円形膜なら 1 : 1.59 : 2.14 : 2.30 …) ので、音程感の薄い打楽器らしい音になります。
          形・叩く位置・マレットの硬さを変えると、どのモードが鳴るかが変わります。計算量が多いので同時発音は 3 音まで、格子は 16×16 までです。
        </p>
      {:else if physModel === 6}
        <p class="explain">
          <b>金管 (唇リード)</b>: 唇を「音程に合わせた共振器」として扱い、マウスピースの中との圧力差で震わせます (バズ)。唇が開いた瞬間だけ口の圧力が管へ入り、閉じている間は管から戻ってきた波を跳ね返します。
          管は遅延線で、長さは 2 周期ぶん。音は管の第 2 共鳴に乗ります (トランペットも実際は第 2 共鳴より上で吹きます)。高い音はベルから外へ逃げるので、管の反射にはローパスがかかっています。
          唇の開きはなめらかに飽和させています (固く打ち切ると波形の上が平らに張り付き、音割れのように聞こえます)。
          大きな音ほど金管が明るくなるのは、管の中で圧力の高い部分ほど速く進み、波の前面が切り立つため (衝撃波に近い現象) です。ベルから出る音にこの「急峻化」を入れているので、強く吹くほど「パリッ」とした音になります。Lip Buzz は唇の開きやすさ、Bell Brightness はベルから出る音の明るさ (下げるとミュートやホルンの手のような音) です。
        </p>
      {:else}
        <p class="explain">
          <b>硬い弦 (ピアノ)</b>: Karplus-Strong の弦に、オールパスフィルターによる「分散」を加えたモデルです。
          ピアノ線のように硬い弦は、高い周波数ほど速く伝わるので、倍音が整数倍より少しずつ高くなります (インハーモニシティ)。ずれの量は実際のピアノの測定値に近い曲線から音ごとに決めています。
          ハンマーはフェルトの物理モデル (力 = 硬さ × 圧縮量の 2.5 乗) で、フェルトは押しつぶされるほど硬くなるので、強く弾くほど音が大きく、しかも明るくなります。これがピアノらしさの核です。弦の振動は駒を通して 16 個の共鳴でできた響板に伝わり、聞こえる音の大部分はその響板から出ます。1 音につき少しだけ音程をずらした弦を 2 本鳴らすので、うなりも生まれます。
        </p>
      {/if}
      {#if app.physViz}
        <PhysViz />
      {:else}
        <p class="muted hint">可視化 ON にすると、最後に弾いた音の内部 (弦や管の中を進む波 / 弓・リード・唇の状態 / 各モードの振幅 / 膜の変位 / 倍音のずれ) をリアルタイムで表示します。OFF の間は追加の負荷はありません。</p>
      {/if}
    </section>
    <ParamPanel defs={PHYS_PARAMS} values={app.phys} groups={physGroups} onchange={(id, v) => setParam('phys', id, v)} />
  {:else if app.tab === 'drums'}
    <section class="card">
      <DrumPads flash={app.drumFlash} onhit={hit} />
      <p class="muted hint">パッドの上側ほど強く鳴ります · PC キー <kbd>A</kbd>〜<kbd>L</kbd>, <kbd>Z</kbd>〜<kbd>V</kbd> · クローズ HH はオープン HH を止めます(チョーク)</p>
    </section>
    <PresetBar target="drums" defs={DRUM_PARAMS} builtins={DRUM_PRESETS} />
    <ParamPanel defs={DRUM_PARAMS} values={app.drums} onchange={(id, v) => setParam('drums', id, v)} />
  {:else if app.tab === 'roll'}
    <div class="roll-head">
      <button onclick={() => { app.pattern = { ...demoPattern(), bpm: app.pattern.bpm }; persist(); }}>デモパターン</button>
      <button onclick={loadPianoDemo} title="Physical の Grand Piano で、pp からクレッシェンドして ff、また pp に戻る 4 小節">デモ: ピアノ (強弱あり)</button>
      <button onclick={() => { app.pattern.notes = []; persist(); }}>ノート全消去</button>
      <button onclick={() => { app.pattern.drums = []; persist(); }}>ドラム全消去</button>
      <button onclick={() => { app.pattern = emptyPattern(app.pattern.bpm); persist(); }}>すべて消去</button>
      <button onclick={() => downloadPatternMidi(app.pattern)} title="Standard MIDI File (メロディ ch1 / ドラム ch10)。REAPER で JSFX 版に流し込めます">MIDI 書き出し</button>
      <label class="muted">メロディ音源
        <select value={app.pattern.melodic ?? 'synth'} onchange={(e) => { app.pattern.melodic = e.currentTarget.value; persist(); }}>
          <option value="synth">Synth</option>
          <option value="phys">Physical</option>
        </select>
      </label>
      <span class="muted">4 小節ループ · 行は現在のチューニングのステップ</span>
    </div>
    <div class="roll-head export">
      <span class="muted">音声書き出し</span>
      <select bind:value={exportFormat} aria-label="形式" disabled={exportBusy}>
        <option value="wav">WAV (16 bit)</option>
        <option value="mp3">MP3 (192 kbps)</option>
      </select>
      <label class="muted">ループ
        <select bind:value={exportLoops} disabled={exportBusy}>
          {#each [1, 2, 4, 8] as n (n)}<option value={n}>{n} 回</option>{/each}
        </select>
      </label>
      <label class="muted" title="いちばん大きい所が -1 dBFS になるように音量をそろえます"><input type="checkbox" bind:checked={exportNormalize} disabled={exportBusy} /> ノーマライズ</label>
      <button class="primary" onclick={exportAudio} disabled={exportBusy}
        title="今の音色とチューニングで、パターンを (余韻まで) 書き出します。再生と同じ DSP をオフラインで回します">
        {exportBusy ? `書き出し中 ${Math.round(exportProgress * 100)}%` : '⬇ 書き出し'}
      </button>
      {#if exportMsg}<span class="muted">{exportMsg}</span>{/if}
    </div>
    <PianoRoll pattern={app.pattern} {tuning} playStep={app.playStep} {preview} {previewDrum} onedit={persist} />
  {:else}
    <section class="card">
      <h3>Parameter reference</h3>
      <p class="muted hint">JSFX の slider 宣言にそのまま対応します (<code>npm run gen:jsfx</code> で生成)。id は REAPER のオートメーション / MCP から見える名前です。</p>
      {#each [['Synth', SYNTH_PARAMS], ['Physical', PHYS_PARAMS], ['Drums', DRUM_PARAMS]] as [title, defs] (title)}
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
  DSP はすべて AudioWorklet 内のサンプル単位ループ(Web Audio 組み込みノード不使用)。共通 DSP → <code>src/dsp/lib.js</code>、シンセ → <code>src/dsp/synth.js</code>、物理モデル → <code>src/dsp/phys.js</code>、ドラム → <code>src/dsp/drums.js</code>。
</footer>

{#if fullscreen}
  <div class="fs" class:rot90={fsRot === 90} class:rotm90={fsRot === -90} data-rot={fsRot}
    style={fsRot ? `width: ${vh}px; height: ${vw}px` : ''} role="dialog" aria-label="全画面鍵盤">
    <div class="fs-bar">
      <select value={app.melodic} onchange={(e) => setMelodic(e.currentTarget.value)} aria-label="楽器">
        <option value="synth">Synth</option>
        <option value="phys">Physical</option>
      </select>
      <button onclick={() => stepPreset(-1)} aria-label="前のプリセット">◀</button>
      <span class="fs-preset">{app.presetName[app.melodic]}</span>
      <button onclick={() => stepPreset(1)} aria-label="次のプリセット">▶</button>
      <span class="spacer"></span>
      <button onclick={() => shiftOctave(-1)} aria-label="周期を下げる">◀ 周期</button>
      <button onclick={() => shiftOctave(1)} aria-label="周期を上げる">周期 ▶</button>
      {#if isCoarse && portrait}
        <button onclick={cycleRot} title="画面内で回転 (自動 → 逆向き → 回転しない)" aria-label="画面の回転">
          ⟳ {fsRotMode === 'auto' ? '横' : fsRotMode === 'flip' ? '横 (逆)' : '縦'}
        </button>
      {/if}
      <button class:active={fsToolsOpen} onclick={() => (fsToolsOpen = !fsToolsOpen)} aria-label="鍵盤の設定">⚙</button>
      <button class="primary" onclick={exitFullscreen} aria-label="全画面を閉じる">✕</button>
    </div>
    {#if fsToolsOpen}<div class="fs-tools">{@render kbTools()}</div>{/if}
    <div class="fs-body" bind:clientHeight={fsBodyHeight}>
      {@render playCard()}
    </div>
  </div>
{/if}

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
  .load { margin: 0 0 8px; font-size: 12px; }
  .load.heavy { color: var(--accent); }
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
  .performance-controls { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .performance-controls button { font-size: 11px; min-height: 28px; padding: 4px; }
  .kb { flex: 1; min-width: 0; overflow-x: auto; }
  .keysize { display: flex; align-items: center; gap: 6px; }
  .kbopt { display: flex; align-items: center; gap: 4px; }
  .kbopt input[type='number'] { width: 52px; }
  .steps { font-family: ui-monospace, Menlo, monospace; }
  @media (pointer: coarse) {
    .pc-hint { display: none; }
  }
  .keysize input { width: 100px; }
  .viz-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .viz-head h3 { margin: 0; }
  .explain { font-size: 12px; line-height: 1.7; opacity: 0.85; margin: 8px 0; }
  .fs-btn { margin-left: auto; }
  .fs {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    gap: 6px;
  }
  /* rotated overlay: laid out landscape (width = screen height), then turned onto the screen */
  .fs.rot90,
  .fs.rotm90 {
    inset: auto;
    top: 0;
    left: 0;
    transform-origin: top left;
    padding: 8px 10px;
  }
  .fs.rot90 { transform: rotate(90deg) translateY(-100%); }
  .fs.rotm90 { transform: rotate(-90deg) translateX(-100%); }
  .fs-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
  .fs-bar .spacer { flex: 1; }
  .fs-tools .kb-tools { margin: 0; }
  .fs-preset { min-width: 8em; font-weight: 600; }
  .fs-body { flex: 1; min-height: 0; display: flex; }
  .fs-body .play { flex: 1; min-width: 0; padding: 6px; }
  .ime-hint {
    margin: 8px 0 0;
    padding: 6px 10px;
    font-size: 12px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--accent);
  }
  .ime-hint button { margin-left: 8px; font-size: 11px; padding: 2px 8px; }
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
