<script>
  import { playable } from './touch.js';
  import { formatValue, fromNorm, toNorm } from './format.js';

  /** @type {{ def: import('../dsp/params.js').ParamDef, value: number, onchange: (v:number)=>void, disabled?: boolean }} */
  let { def, value, onchange, disabled = false } = $props();

  const norm = $derived(toNorm(def, value));
  // 270 degree sweep
  const angle = $derived(-135 + norm * 270);
  const bipolar = $derived(def.min < 0 && def.max > 0 && def.scale !== 'log');
  const zeroAngle = $derived(bipolar ? -135 + toNorm(def, 0) * 270 : -135);

  let dragging = $state(false);
  let startY = 0;
  let startNorm = 0;
  // Double tap / double click resets to the default. Detected from pointer events because the
  // `playable` action cancels touchstart (for multi-finger playing), so touch never gets dblclick.
  let lastDownTime = 0;
  let lastDownY = 0;

  function arc(a0, a1, r = 20) {
    const p = (a) => {
      const rad = ((a - 90) * Math.PI) / 180;
      return `${24 + r * Math.cos(rad)} ${24 + r * Math.sin(rad)}`;
    };
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    if (hi - lo < 0.5) return '';
    return `M ${p(lo)} A ${r} ${r} 0 ${hi - lo > 180 ? 1 : 0} 1 ${p(hi)}`;
  }

  function pointerdown(e) {
    if (disabled || e.button !== 0) return;
    const now = e.timeStamp;
    if (now - lastDownTime < 350 && Math.abs(e.clientY - lastDownY) < 24) {
      lastDownTime = 0;
      if (value !== def.default) onchange(def.default);
      return;
    }
    lastDownTime = now;
    lastDownY = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    dragging = true;
    startY = e.clientY;
    startNorm = norm;
  }

  function pointermove(e) {
    if (!dragging) return;
    const range = e.shiftKey ? 800 : 180;
    const n = startNorm + (startY - e.clientY) / range;
    const v = fromNorm(def, n);
    if (v !== value) onchange(v);
  }

  function pointerup() {
    dragging = false;
  }

  function keydown(e) {
    if (disabled) return;
    const big = e.shiftKey ? 0.1 : 0.01;
    let n = norm;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += def.step >= 1 ? 1 / (def.max - def.min) : big;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= def.step >= 1 ? 1 / (def.max - def.min) : big;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onchange(fromNorm(def, n));
  }

  function wheel(e) {
    if (disabled || document.activeElement !== e.currentTarget) return;
    e.preventDefault();
    onchange(fromNorm(def, norm - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02)));
  }

  function editValue() {
    if (disabled) return;
    const text = prompt(`${def.name} (${def.min} – ${def.max} ${def.unit})`, String(value));
    if (text == null) return;
    const v = parseFloat(text);
    if (Number.isFinite(v)) onchange(Math.min(def.max, Math.max(def.min, def.step >= 1 ? Math.round(v) : v)));
  }
</script>

<div class="knob" class:disabled title={`${def.name}\n${def.description}\n[${def.id}] ダブルクリック / ダブルタップで既定値、値をクリックで数値入力、Shift+ドラッグで微調整`}>
  <div
    use:playable
    class="dial"
    class:dragging
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={def.name}
    aria-valuemin={def.min}
    aria-valuemax={def.max}
    aria-valuenow={value}
    aria-valuetext={formatValue(def, value)}
    aria-disabled={disabled}
    onpointerdown={pointerdown}
    onpointermove={pointermove}
    onpointerup={pointerup}
    onpointercancel={pointerup}
    onkeydown={keydown}
    onwheel={wheel}
  >
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <path d={arc(-135, 135)} class="track" />
      <path d={arc(zeroAngle, angle)} class="value" />
      <g transform={`rotate(${angle} 24 24)`}>
        <circle cx="24" cy="24" r="14" class="cap" />
        <line x1="24" y1="12" x2="24" y2="18" class="pointer" />
      </g>
    </svg>
  </div>
  <div class="label">{def.name.replace(/^(Filter Env|Filter|Amp|Mod Wheel|LFO|Kick|Snare|Clap|Closed Hi-Hat|Open Hi-Hat|Rimshot|Low Tom|Mid Tom|High Tom|Crash|Ride|Cowbell|Shaker|Tuning|Drum) /, '')}</div>
  <button class="value-text mono" onclick={editValue} {disabled} tabindex="-1">{formatValue(def, value)}</button>
</div>

<style>
  .knob {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 76px;
    user-select: none;
  }
  .knob.disabled { opacity: 0.4; }
  .dial {
    touch-action: none;
    cursor: ns-resize;
    border-radius: 50%;
    line-height: 0;
  }
  .disabled .dial { cursor: default; }
  .track { fill: none; stroke: var(--line); stroke-width: 4; stroke-linecap: round; }
  .value { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; }
  .cap { fill: var(--panel-2); stroke: #3a4559; stroke-width: 1.5; }
  .dragging .cap { stroke: var(--accent); }
  .pointer { stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; }
  .label {
    font-size: 11px;
    text-align: center;
    color: var(--muted);
    margin-top: 2px;
    line-height: 1.2;
    min-height: 2.4em;
  }
  .value-text {
    font-size: 11px;
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--text);
    cursor: text;
  }
</style>
