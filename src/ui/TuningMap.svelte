<script>
  import { tuningMap, map12TetNotes } from '../lib/tuning-map.js';
  let { tuning } = $props();
  let low = $state(48), high = $state(84), source = $state('60 62 64 65 67 69 71 72');
  const table = $derived.by(() => { try { return { rows: tuningMap(tuning, low, high) }; } catch (e) { return { rows: [], error: e.message }; } });
  const converted = $derived.by(() => { try {
    const tokens = source.trim().split(/[\s,]+/).filter(Boolean);
    return { rows: map12TetNotes(tokens.map(Number), tuning) };
  } catch (e) { return { rows: [], error: e.message }; } });
  let copied = $state('');
  async function copy() {
    try { await navigator.clipboard.writeText(converted.rows.map(r => r.targetNote).join(' ')); copied = 'コピーしました'; }
    catch { copied = 'コピーできませんでした'; }
  }
</script>

<details class="mapping">
  <summary>鍵盤対応・予測周波数／12平均律MIDIの変換補助</summary>
  <p>基準 {tuning.ref_note} = {tuning.ref_hz} Hz。周波数は音律定義からの予測値です。実音の測定値ではありません。</p>
  <label>開始MIDI <input type="number" min="0" max="127" step="1" bind:value={low} /></label>
  <label>終了MIDI <input type="number" min="0" max="127" step="1" bind:value={high} /></label>
  {#if table.error}<p class="error">{table.error}</p>{/if}
  <div class="scroll"><table>
    <thead><tr><th>入力キー</th><th>基準からの段階</th><th>基準からのcents</th><th>予測Hz</th></tr></thead>
    <tbody>{#each table.rows as row (row.note)}<tr><td>{row.note} ({row.inputLabel})</td><td>{row.stepsFromReference}</td><td>{row.centsFromReference.toFixed(3)}</td><td>{row.predictedHz.toFixed(3)}</td></tr>{/each}</tbody>
  </table></div>
  <p>括弧の音名は12平均律の入力キー名です。現在の実音名を示すものではありません。</p>
  <label>変換元のMIDI番号（12平均律・A4=440 Hz）<input class="notes" bind:value={source} /></label>
  {#if converted.error}<p class="error">{converted.error}</p>{:else}
    <p>現在の音律の入力番号: {converted.rows.map(r => r.targetNote).join(' ')}
      <button onclick={copy} disabled={!converted.rows.length}>番号をコピー</button> {copied}</p>
    <p>丸め誤差（cents）: {converted.rows.map(r => r.errorCents.toFixed(3)).join(' / ')}</p>
  {/if}
  <p>最も近い鍵へ丸めます。音符・ドラム・CC・MIDIファイルは自動変更しません。</p>
</details>

<style>
  summary { cursor: pointer; } p, label { font-size: 12px; } input[type=number] { width: 70px; }
  .notes { width: min(100%, 360px); } .scroll { max-height: 250px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; } td, th { padding: 4px; text-align: right; border-bottom: 1px solid var(--line); }
  .error { color: var(--danger); }
</style>
