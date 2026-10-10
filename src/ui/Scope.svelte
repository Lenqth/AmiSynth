<script>
  import { onMount } from 'svelte';
  import { engine } from '../lib/engine.js';

  /** @type {HTMLCanvasElement} */ let canvas;

  onMount(() => {
    let raf = 0;
    const buf = new Float32Array(1024);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#2a3344';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      if (!engine.analyser) return;
      engine.analyser.getFloatTimeDomainData(buf);
      // trigger on rising zero crossing for a stable picture
      let start = 0;
      for (let i = 1; i < 512; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
      ctx.strokeStyle = '#ffb547';
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < 512; i++) {
        const x = (i / 511) * w;
        const y = h / 2 - buf[start + i] * (h / 2) * 0.95;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} aria-label="Oscilloscope"></canvas>

<style>
  canvas { width: 100%; height: 100%; display: block; }
</style>
