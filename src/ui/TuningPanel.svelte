<script>
  import { TUNING_PARAMS } from '../dsp/params.js';
  import { parseScale, scaleToHolderParams, scaleToScala, TUNING_PRESETS } from '../lib/tuning.js';
  import Knob from './Knob.svelte';

  /**
   * @type {{ values: Record<string, number>, scale: {name:string,cents:number[]} | null, tuning: any,
   *   onchange: (id:string, v:number)=>void, onscale: (s: {name:string,cents:number[]} | null)=>void }}
   */
  let { values, scale, tuning, onchange, onscale } = $props();

  let text = $state('');
  let error = $state('');

  function applyPreset(e) {
    const p = TUNING_PRESETS[Number(e.currentTarget.value)];
    e.currentTarget.value = '';
    if (!p) return;
    if (p.cents) {
      onscale({ name: p.name, cents: p.cents });
    } else {
      onscale(null);
      onchange('tuning_divisions', p.divisions);
      onchange('tuning_period_cents', p.period);
    }
    onchange('tuning_ref_note', p.refNote ?? 69);
    onchange('tuning_ref_hz', p.refHz ?? 440);
  }

  function applyText() {
    try {
      onscale(parseScale(text));
      error = '';
    } catch (e) {
      error = e.message;
    }
  }

  /** Download the current tuning as the JSFX shared scale file (REAPER/Data/AmiSynth/tuning.txt). */
  function downloadScala() {
    const text = scaleToScala(scale, values.tuning_divisions, values.tuning_period_cents);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tuning.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  let copied = $state('');
  /** Copy the AmiSynth Tuning JSFX slider values (JSON) for MCP tools / LLMs. */
  async function copyHolderParams() {
    const params = scaleToHolderParams(scale, values);
    if (!params) {
      copied = '32 音を超える音階は tuning.txt で渡してください';
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(params, null, 1));
      copied = 'コピーしました';
    } catch {
      copied = 'コピーできませんでした';
    }
    setTimeout(() => (copied = ''), 2500);
  }

  const summary = $derived(
    scale
      ? `${scale.name} — ${scale.cents.length} 音 / 周期 ${scale.cents[scale.cents.length - 1].toFixed(2)} cents`
      : `${values.tuning_divisions}-EDO / 周期 ${values.tuning_period_cents} cents (1 ステップ = ${(values.tuning_period_cents / values.tuning_divisions).toFixed(2)} cents)`,
  );
</script>

<section class="card tuning">
  <h3>Tuning</h3>
  <p class="summary">{summary}</p>
  <div class="row">
    <select onchange={applyPreset} aria-label="Tuning preset">
      <option value="">プリセット…</option>
      {#each TUNING_PRESETS as p, i (p.name)}
        <option value={i}>{p.name}</option>
      {/each}
    </select>
    {#if scale}
      <button onclick={() => onscale(null)}>カスタム音階を解除</button>
    {/if}
  </div>
  <div class="controls">
    {#each TUNING_PARAMS as def (def.id)}
      <Knob {def} value={values[def.id]} onchange={(v) => onchange(def.id, v)}
        disabled={!!scale && (def.id === 'tuning_divisions' || def.id === 'tuning_period_cents')} />
    {/each}
  </div>
  <details>
    <summary>カスタム音階 (Scala .scl / cents・比のリスト)</summary>
    <textarea rows="5" bind:value={text} placeholder={'例: 9/8 5/4 4/3 3/2 5/3 15/8 2/1\nまたは .scl ファイルの中身を貼り付け\n(最後の値が周期)'}></textarea>
    <div class="row">
      <button onclick={applyText} disabled={!text.trim()}>適用</button>
      {#if error}<span class="error">{error}</span>{/if}
    </div>
  </details>
  <div class="row">
    <button onclick={downloadScala} title="REAPER の Data/AmiSynth/tuning.txt に置き、JSFX の Tuning Source を Scale file にすると、全トラックがこの音階で鳴ります">
      tuning.txt を書き出し (REAPER 共通調律)
    </button>
    <button onclick={copyHolderParams} title="REAPER の AmiSynth Tuning (JSFX) のスライダー値を JSON でコピー。MCP / LLM にそのまま渡せます">
      AmiSynth Tuning の値をコピー
    </button>
    {#if copied}<span class="muted">{copied}</span>{/if}
  </div>
  <p class="muted hint">
    ノート番号は「基準ノートから何ステップ目か」として解釈されます。基準ノート {tuning.ref_note} = {tuning.ref_hz} Hz。
  </p>
</section>

<style>
  .summary { margin: 0 0 8px; font-size: 13px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .controls { display: flex; flex-wrap: wrap; gap: 4px; }
  textarea { width: 100%; margin: 6px 0; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 12px; margin-top: 6px; }
  .error { color: var(--danger); font-size: 12px; }
  .hint { font-size: 11px; margin: 8px 0 0; }
</style>
