<script>
  import { playable } from './touch.js';
  import { localFraction } from '../lib/rotate.js';
  /**
   * Pressure is an on-screen aftertouch strip (touch force is not reliable in browsers): it sends
   * channel pressure while held and springs back to 0 like a key being let go.
   * @type {{ bend: number, modwheel: number, pressure?: number, onbend: (v:number)=>void, onmod: (v:number)=>void,
   *   onpressure?: (v:number)=>void, height?: number }}
   */
  let { bend, modwheel, pressure = 0, onbend, onmod, onpressure, height = 150 } = $props();

  function drag(e, kind) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const apply = (ev) => {
      const { fy } = localFraction(el, ev.clientX, ev.clientY);
      const n = 1 - Math.min(1, Math.max(0, fy));
      if (kind === 'bend') onbend(n * 2 - 1);
      else if (kind === 'pressure') onpressure?.(n);
      else onmod(n);
    };
    apply(e);
    const moveHandler = (ev) => apply(ev);
    const upHandler = () => {
      el.removeEventListener('pointermove', moveHandler);
      el.removeEventListener('pointerup', upHandler);
      el.removeEventListener('pointercancel', upHandler);
      if (kind === 'bend') onbend(0); // spring back
      else if (kind === 'pressure') onpressure?.(0);
    };
    el.addEventListener('pointermove', moveHandler);
    el.addEventListener('pointerup', upHandler);
    el.addEventListener('pointercancel', upHandler);
  }
</script>

<div class="wheels" use:playable style={`height: ${height}px`}>
  <div class="wheel-wrap">
    <div class="wheel" role="slider" aria-label="Pitch bend" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={bend} tabindex="-1"
      onpointerdown={(e) => drag(e, 'bend')}>
      <div class="center"></div>
      <div class="thumb" style={`bottom: calc(${((bend + 1) / 2) * 100}% - 6px)`}></div>
    </div>
    <span>Bend</span>
  </div>
  <div class="wheel-wrap">
    <div class="wheel" role="slider" aria-label="Mod wheel" aria-valuemin={0} aria-valuemax={1} aria-valuenow={modwheel} tabindex="-1"
      onpointerdown={(e) => drag(e, 'mod')}>
      <div class="fill" style={`height: ${modwheel * 100}%`}></div>
      <div class="thumb" style={`bottom: calc(${modwheel * 100}% - 6px)`}></div>
    </div>
    <span>Mod</span>
  </div>
  {#if onpressure}
    <div class="wheel-wrap">
      <div class="wheel" role="slider" aria-label="Pressure (aftertouch)" aria-valuemin={0} aria-valuemax={1} aria-valuenow={pressure}
        tabindex="-1" title="Pressure: チャンネルプレッシャー (アフタータッチ) を送ります。押している間だけ効き、離すと 0 に戻ります"
        onpointerdown={(e) => drag(e, 'pressure')}>
        <div class="fill press" style={`height: ${pressure * 100}%`}></div>
        <div class="thumb" style={`bottom: calc(${pressure * 100}% - 6px)`}></div>
      </div>
      <span>Press</span>
    </div>
  {/if}
</div>

<style>
  .wheels { display: flex; gap: 8px; }
  .wheel-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); }
  .wheel {
    position: relative;
    width: 30px;
    flex: 1;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    touch-action: none;
    cursor: ns-resize;
    overflow: hidden;
  }
  .center { position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed var(--line); }
  .fill { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(90, 209, 200, 0.25); }
  .fill.press { background: rgba(255, 181, 71, 0.3); }
  .thumb {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 12px;
    border-radius: 3px;
    background: var(--accent-2);
  }
</style>
