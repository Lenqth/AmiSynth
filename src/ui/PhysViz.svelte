<script>
  import { onMount } from 'svelte';
  import { engine } from '../lib/engine.js';

  /** @type {HTMLCanvasElement} */ let canvas;
  /** latest snapshot from the worklet (not reactive: drawn by rAF) */
  let snap = null;
  let info = $state('');

  onMount(() => {
    engine.onPhysSnapshot = (d) => (snap = d);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      const dpr = devicePixelRatio || 1;
      const w = (canvas.width = canvas.clientWidth * dpr);
      const h = (canvas.height = canvas.clientHeight * dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
      if (!snap || !snap.active) {
        ctx.fillStyle = '#8b95a8';
        ctx.fillText('鍵盤を弾くと、最後に弾いた音の内部状態がここに表示されます', 12 * dpr, h / 2);
        info = '';
        return;
      }
      if (snap.model === 'string') drawString(ctx, w, h, dpr, snap);
      else drawModal(ctx, w, h, dpr, snap);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      engine.onPhysSnapshot = null;
    };
  });

  function drawString(ctx, w, h, dpr, s) {
    const pad = 12 * dpr;
    const mid = h / 2;
    // string anchors
    ctx.strokeStyle = '#2a3344';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(pad, mid);
    ctx.lineTo(w - pad, mid);
    ctx.stroke();
    let peak = 1e-6;
    for (const v of s.wave) peak = Math.max(peak, Math.abs(v));
    const scale = (h / 2 - pad) / Math.max(peak, 0.05);
    ctx.strokeStyle = '#ffb547';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    s.wave.forEach((v, i) => {
      const x = pad + (i / (s.wave.length - 1)) * (w - 2 * pad);
      const y = mid - v * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#5ad1c8';
    ctx.fillText('← 次に読み出される (古い)', pad, h - 6 * dpr);
    const t = '書き込まれたばかり (新しい) →';
    ctx.fillText(t, w - pad - ctx.measureText(t).width, h - 6 * dpr);
    info =
      `${s.hz.toFixed(1)} Hz · 遅延 ${s.delaySamples.toFixed(1)} サンプル (≈ ${s.sr} / ${s.hz.toFixed(1)} − フィルター遅延) · ` +
      `1 往復のゲイン ${s.loopGain.toFixed(5)} · ダンピング係数 ${s.damping.toFixed(2)}${s.gate ? '' : ' · 離鍵 (ダンパー)'}`;
  }

  function drawModal(ctx, w, h, dpr, s) {
    const pad = 12 * dpr;
    const base = h - 22 * dpr;
    const minR = 0.4;
    const maxR = Math.max(4, ...s.modes.map((m) => m.ratio)) * 1.15;
    const xOf = (r) => pad + (Math.log(r / minR) / Math.log(maxR / minR)) * (w - 2 * pad);
    // harmonic reference lines (integer multiples of the fundamental)
    ctx.strokeStyle = '#232a37';
    ctx.lineWidth = 1 * dpr;
    for (let k = 1; k <= maxR; k++) {
      const x = xOf(k);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, base);
      ctx.stroke();
    }
    ctx.strokeStyle = '#2a3344';
    ctx.beginPath();
    ctx.moveTo(pad, base);
    ctx.lineTo(w - pad, base);
    ctx.stroke();
    let peak = 1e-6;
    for (const m of s.modes) peak = Math.max(peak, m.amp);
    const barW = Math.max(6 * dpr, (w - 2 * pad) / 60);
    s.modes.forEach((m) => {
      if (m.silent) return;
      const x = xOf(m.ratio);
      // dB scale so quiet high modes stay visible (60 dB range)
      const db = 20 * Math.log10(Math.max(m.amp / peak, 1e-3));
      const bh = ((db + 60) / 60) * (base - pad * 2);
      ctx.fillStyle = '#5ad1c8';
      ctx.fillRect(x - barW / 2, base - bh, barW, bh);
      ctx.fillStyle = '#8b95a8';
      const label = `×${m.ratio.toFixed(2)}`;
      ctx.fillText(label, x - ctx.measureText(label).width / 2, base + 14 * dpr);
    });
    info = `${s.material} · 基音 ${s.hz.toFixed(1)} Hz · 棒 = 各モードの振幅 (dB, 60 dB 幅) · 縦線 = 整数倍音の位置${s.gate ? '' : ' · 離鍵 (ダンプ中)'}`;
  }
</script>

<div class="viz">
  <canvas bind:this={canvas} aria-label="Physical model visualisation"></canvas>
  <p class="info mono">{info}</p>
</div>

<style>
  .viz { display: flex; flex-direction: column; gap: 6px; }
  canvas { width: 100%; height: 180px; background: #0b0e14; border: 1px solid var(--line); border-radius: 8px; display: block; }
  .info { margin: 0; font-size: 11px; color: var(--muted); min-height: 1.4em; }
</style>
