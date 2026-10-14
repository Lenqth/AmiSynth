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
      else if (snap.model === 'modal') drawModal(ctx, w, h, dpr, snap);
      else if (snap.model === 'bowed') drawBowed(ctx, w, h, dpr, snap);
      else if (snap.model === 'wind' || snap.model === 'brass') drawWind(ctx, w, h, dpr, snap);
      else if (snap.model === 'mesh') drawMesh(ctx, w, h, dpr, snap);
      else if (snap.model === 'stiff') drawStiff(ctx, w, h, dpr, snap);
      else if (snap.model === 'organ') drawOrgan(ctx, w, h, dpr, snap);
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

  /** polyline of `wave` between x0..x1 around y = mid */
  function plot(ctx, wave, x0, x1, mid, scale, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    wave.forEach((v, i) => {
      const x = x0 + (i / Math.max(1, wave.length - 1)) * (x1 - x0);
      const y = mid - v * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function peakOf(...arrays) {
    let p = 1e-6;
    for (const a of arrays) for (const v of a) p = Math.max(p, Math.abs(v));
    return p;
  }

  function drawBowed(ctx, w, h, dpr, s) {
    const pad = 12 * dpr;
    const mid = h / 2 - 6 * dpr;
    const x0 = pad;
    const x1 = w - pad;
    // nut on the left, bridge on the right; the bow sits at bowPos from the bridge
    const xb = x1 - s.bowPos * (x1 - x0);
    ctx.strokeStyle = '#2a3344';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, mid);
    ctx.lineTo(x1, mid);
    ctx.stroke();
    const scale = (h / 2 - 2 * pad) / Math.max(peakOf(s.nut, s.bridge), 0.05);
    plot(ctx, s.nut, x0, xb, mid, scale, '#ffb547', 2 * dpr);
    plot(ctx, s.bridge, xb, x1, mid, scale, '#ffb547', 2 * dpr);
    // the bow: green while it sticks to the string, red while the string slips under it
    const stick = s.slip > 0.5;
    ctx.fillStyle = stick ? '#5ad1c8' : '#ff6b6b';
    ctx.fillRect(xb - 3 * dpr, pad, 6 * dpr, h - 3 * pad);
    ctx.fillStyle = '#8b95a8';
    ctx.fillText('ナット', x0, h - 6 * dpr);
    const t = '駒 (ブリッジ)';
    ctx.fillText(t, x1 - ctx.measureText(t).width, h - 6 * dpr);
    const b = stick ? '弓: スティック (弦をつかんで運ぶ)' : '弓: スリップ (弦が滑って戻る)';
    ctx.fillStyle = stick ? '#5ad1c8' : '#ff6b6b';
    const bw = ctx.measureText(b).width;
    // label on whichever side of the bow has room
    ctx.fillText(b, xb + 8 * dpr + bw < x1 ? xb + 8 * dpr : xb - 8 * dpr - bw, pad + 10 * dpr);
    info =
      `${s.hz.toFixed(1)} Hz · 曲線 = 弦の速度波 (ナット↔弓↔駒を往復) · 弓速 ${s.bow.toFixed(3)} · ` +
      `摩擦 ${s.slip.toFixed(2)} (1 = 張り付き)。張り付いて引きずられ、離れて戻る「スティック・スリップ」が周期ごとに 1 回起きるのが擦弦の音源です${s.gate ? '' : ' · 離鍵 (弓を離した)'}`;
  }

  function drawWind(ctx, w, h, dpr, s) {
    const pad = 12 * dpr;
    const mid = h / 2 - 6 * dpr;
    const x0 = pad + 40 * dpr;
    const x1 = w - pad;
    // the bore (tube)
    ctx.strokeStyle = '#2a3344';
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(x0, pad, x1 - x0, h - 3 * pad);
    // the static part of the pressure (the blowing pressure itself) is removed for display
    const mean = s.wave.reduce((a, v) => a + v, 0) / s.wave.length;
    const wave = s.wave.map((v) => v - mean);
    const scale = (h / 2 - 2 * pad) / Math.max(peakOf(wave), 0.05);
    plot(ctx, wave, x0, x1, mid, scale, '#ffb547', 2 * dpr);
    // the valve: reed opening (clarinet), jet deflection (flute), -1..1, or lip opening (brass) 0..1
    const vh = (h - 3 * pad) / 2;
    ctx.fillStyle = '#5ad1c8';
    const vy = mid - Math.max(-1, Math.min(1, s.valve)) * vh;
    ctx.fillRect(pad, Math.min(mid, vy), 24 * dpr, Math.abs(vy - mid) + 1);
    ctx.fillStyle = '#8b95a8';
    const brass = s.model === 'brass';
    ctx.fillText(brass ? '唇' : s.flute ? 'ジェット' : 'リード', pad, h - 6 * dpr);
    const t = s.flute ? '開いた端 →' : 'ベル →';
    ctx.fillText(t, x1 - ctx.measureText(t).width, h - 6 * dpr);
    info = brass
      ? `金管 ${s.hz.toFixed(1)} Hz · 曲線 = 管内の圧力波 · 左の棒 = 唇の開き。唇は音程に合わせた共振器で、マウスピースの圧力差で開閉し (バズ)、開いたときだけ息を管へ送ります。管は 2 周期ぶんの長さで、音は管の第 2 共鳴に乗ります。強く吹くほど管の中で波の前面が切り立ち (急峻化)、明るい音になります · 圧力 ${s.breath.toFixed(2)}`
      : s.flute
      ? `フルート ${s.hz.toFixed(1)} Hz · 曲線 = 管内の圧力波 · 左の棒 = 息の流れ (ジェット) が歌口のエッジの内/外どちらに振れているか。管の圧力がジェットを揺らし、ジェットが管を押す帰還で発音します · 息 ${s.breath.toFixed(2)}`
      : `クラリネット ${s.hz.toFixed(1)} Hz · 曲線 = 管内の圧力波 · 左の棒 = リードの開き具合。片側が閉じた円筒管なので波長は管の 4 倍、奇数倍音が中心になります · 息 ${s.breath.toFixed(2)}`;
    if (!s.gate) info += ' · 離鍵';
  }

  function drawMesh(ctx, w, h, dpr, s) {
    const pad = 8 * dpr;
    const n = s.n;
    const cell = Math.floor(Math.min((h - 2 * pad) / n, (w - 2 * pad) / n));
    const ox = Math.floor((w - cell * n) / 2);
    const oy = pad;
    let peak = 1e-9;
    for (let i = 0; i < s.grid.length; i++) if (s.mask[i]) peak = Math.max(peak, Math.abs(s.grid[i]));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = i * n + j;
        if (!s.mask[k]) continue;
        // orange = pushed up, teal = pushed down, brightness = amplitude
        const a = Math.min(1, Math.abs(s.grid[k]) / peak);
        ctx.fillStyle = s.grid[k] >= 0 ? `rgba(255,181,71,${0.08 + 0.92 * a})` : `rgba(90,209,200,${0.08 + 0.92 * a})`;
        ctx.fillRect(ox + j * cell, oy + i * cell, cell - 1, cell - 1);
      }
    }
    // strike point
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(ox + (s.strike[0] * (n - 1) + 0.5) * cell, oy + (s.strike[1] * (n - 1) + 0.5) * cell, cell * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    info =
      `${s.hz.toFixed(1)} Hz (基本モード) · ${n}×${n} 格子の 2D 波動方程式 · 橙 = 上に変位 / 青緑 = 下に変位 · ○ = 叩いた位置。` +
      `縁は固定。高次モードは整数倍にならないので、膜や板は音程感の薄い打楽器らしい音になります${s.gate ? '' : ' · 離鍵'}`;
  }

  function drawStiff(ctx, w, h, dpr, s) {
    const pad = 12 * dpr;
    const top = h * 0.42;
    const scale = (top / 2 - pad) / Math.max(peakOf(s.wave), 0.05);
    plot(ctx, s.wave, pad, w - pad, top / 2 + 2 * dpr, scale, '#ffb547', 1.5 * dpr);
    // partials vs the harmonic series: how sharp is the k-th partial?
    const base = h - 22 * dpr;
    const y0 = top + 14 * dpr;
    const count = s.partials.length;
    const colW = (w - 2 * pad) / Math.max(1, count);
    const devs = s.partials.map((f, i) => 1200 * Math.log2(f / (s.f1 * (i + 1))));
    const maxDev = Math.max(5, ...devs);
    ctx.strokeStyle = '#2a3344';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(pad, base);
    ctx.lineTo(w - pad, base);
    ctx.stroke();
    devs.forEach((d, i) => {
      const x = pad + (i + 0.5) * colW;
      const bh = (Math.max(0, d) / maxDev) * (base - y0);
      ctx.fillStyle = '#5ad1c8';
      ctx.fillRect(x - colW * 0.3, base - bh, colW * 0.6, bh);
      ctx.fillStyle = '#8b95a8';
      const dev = `+${d < 10 ? d.toFixed(1) : d.toFixed(0)}`;
      // narrow screens: drop the partial number
      const label = ctx.measureText(`${i + 1}: ${dev}`).width + 4 * dpr < colW ? `${i + 1}: ${dev}` : dev;
      ctx.fillText(label, x - ctx.measureText(label).width / 2, base + 14 * dpr);
    });
    info =
      `${s.f1.toFixed(1)} Hz · 上 = 弦の波形 · 下 = 第 k 倍音が整数倍よりどれだけ高いか (セント)。` +
      `硬い弦は高い倍音ほど速く伝わるので倍音が上にずれます (ピアノの「インハーモニシティ」)。調律が広め (ストレッチ) になる理由です${s.gate ? '' : ' · 離鍵 (ダンパー)'}`;
  }

  const FOOT = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"];
  const BAR_COLORS = ['#a0522d', '#a0522d', '#e8e8e8', '#e8e8e8', '#333a48', '#e8e8e8', '#333a48', '#333a48', '#e8e8e8'];

  function drawOrgan(ctx, w, h, dpr, s) {
    // drawbars pulled out from the top: 0 = pushed in, 8 = full
    const pad = 12 * dpr;
    const top = pad;
    const base = h - 22 * dpr;
    const colW = (w - 2 * pad) / 9;
    s.drawbars.forEach((b, i) => {
      const x = pad + i * colW + colW * 0.2;
      const bh = (b / 8) * (base - top);
      ctx.fillStyle = BAR_COLORS[i];
      ctx.strokeStyle = '#8b95a8';
      ctx.lineWidth = 1 * dpr;
      ctx.fillRect(x, top, colW * 0.6, Math.max(2 * dpr, bh));
      ctx.strokeRect(x, top, colW * 0.6, Math.max(2 * dpr, bh));
      ctx.fillStyle = '#8b95a8';
      const label = `${FOOT[i]} ${b}`;
      ctx.fillText(label, pad + (i + 0.5) * colW - ctx.measureText(label).width / 2, base + 14 * dpr);
    });
    info =
      `${s.hz.toFixed(1)} Hz · ドローバー = 足 (フィート) ごとのサイン波の音量 (8' が基音、16' が 1 オクターブ下、4' が 1 オクターブ上 …)` +
      `${s.perc > 0.001 ? ` · パーカッション ${(s.perc * 100).toFixed(0)} %` : ''}${s.gate ? '' : ' · 離鍵'}`;
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
