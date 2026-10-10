<script>
  import { diffFromDefaults, parsePresetJson, presetToJson, resolvePreset } from '../lib/presets.js';
  import { app, applyPreset, deleteUserPreset, saveUserPreset } from '../lib/state.svelte.js';

  /**
   * @type {{ target: 'synth'|'drums', defs: import('../dsp/params.js').ParamDef[],
   *   builtins: import('../presets/synth.js').Preset[] }}
   */
  let { target, defs, builtins } = $props();

  const all = $derived([...builtins, ...app.userPresets[target]]);
  const current = $derived(all.find((p) => p.name === app.presetName[target]));
  const isUser = $derived(app.userPresets[target].some((p) => p.name === app.presetName[target]));
  const modified = $derived.by(() => {
    if (!current) return true;
    const ref = resolvePreset(defs, current, app[target]);
    return defs.some((d) => Math.abs(ref[d.id] - app[target][d.id]) > 1e-9);
  });
  const categories = $derived([...new Set(builtins.map((p) => p.category))]);

  let pasteOpen = $state(false);
  let pasteText = $state('');
  let message = $state('');

  function select(e) {
    const p = all.find((x) => x.name === e.currentTarget.value);
    if (p) applyPreset(target, p);
  }

  function step(dir) {
    const i = all.findIndex((p) => p.name === app.presetName[target]);
    const next = all[(i + dir + all.length) % all.length];
    applyPreset(target, next);
  }

  function save() {
    const name = prompt('プリセット名', isUser ? app.presetName[target] : `${app.presetName[target] || 'My'} (edit)`);
    if (!name) return;
    if (builtins.some((p) => p.name === name)) {
      message = '内蔵プリセットと同じ名前は使えません';
      return;
    }
    saveUserPreset(target, name, diffFromDefaults(defs, app[target]));
    message = `「${name}」を保存しました (このブラウザ内)`;
  }

  function remove() {
    if (!confirm(`「${app.presetName[target]}」を削除しますか?`)) return;
    deleteUserPreset(target, app.presetName[target]);
    applyPreset(target, builtins[0]);
  }

  async function copyJson() {
    const json = presetToJson(target, app.presetName[target] || 'Untitled', defs, app[target]);
    try {
      await navigator.clipboard.writeText(json);
      message = 'JSON をコピーしました (既定値と違う値だけ)';
    } catch {
      pasteOpen = true;
      pasteText = json;
      message = 'クリップボードが使えないので下に表示しました';
    }
  }

  function applyPasted() {
    try {
      const { name, params, warnings } = parsePresetJson(pasteText, defs);
      applyPreset(target, { name, category: 'Pasted', description: '', params });
      message = warnings.length ? `適用しました (注意: ${warnings.join(' / ')})` : `「${name}」を適用しました`;
      pasteOpen = false;
    } catch (e) {
      message = e.message;
    }
  }
</script>

<section class="card presets">
  <div class="row">
    <span class="label">Preset</span>
    <button onclick={() => step(-1)} aria-label="前のプリセット">◀</button>
    <select value={current ? current.name : ''} onchange={select} aria-label="Preset">
      {#if !current}<option value="">{app.presetName[target] || '(none)'}</option>{/if}
      {#each categories as cat (cat)}
        <optgroup label={cat}>
          {#each builtins.filter((p) => p.category === cat) as p (p.name)}
            <option value={p.name}>{p.name}</option>
          {/each}
        </optgroup>
      {/each}
      {#if app.userPresets[target].length}
        <optgroup label="User">
          {#each app.userPresets[target] as p (p.name)}
            <option value={p.name}>{p.name}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
    <button onclick={() => step(1)} aria-label="次のプリセット">▶</button>
    {#if modified}<span class="modified" title="プリセットから変更あり">編集済み</span>{/if}
    <span class="spacer"></span>
    <button onclick={save}>保存</button>
    {#if isUser}<button onclick={remove}>削除</button>{/if}
    <button onclick={copyJson} title="既定値と違うパラメータだけを JSON でコピー (LLM に渡して編集してもらう用)">JSON コピー</button>
    <button class:active={pasteOpen} onclick={() => (pasteOpen = !pasteOpen)}>JSON 貼り付け</button>
  </div>
  {#if current?.description}<p class="desc muted">{current.description}</p>{/if}
  {#if pasteOpen}
    <textarea rows="6" bind:value={pasteText}
      placeholder={'{ "name": "My Lead", "params": { "osc1_waveform": 0, "filter_cutoff_hz": 1200 } }\n既定値から変える値だけ書けば OK。パラメータ id は Parameters タブ参照。'}></textarea>
    <div class="row">
      <button class="primary" onclick={applyPasted} disabled={!pasteText.trim()}>適用</button>
    </div>
  {/if}
  {#if message}<p class="msg muted">{message}</p>{/if}
</section>

<style>
  .presets { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .label { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin-right: 4px; }
  select { min-width: 200px; }
  .spacer { flex: 1; }
  .modified { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 0 4px; }
  .desc, .msg { margin: 0; font-size: 12px; }
  textarea { width: 100%; font-family: ui-monospace, Menlo, monospace; font-size: 12px; resize: vertical; }
</style>
