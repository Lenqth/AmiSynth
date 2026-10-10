<script>
  /** @type {{ bend: number, modwheel: number, onbend: (v:number)=>void, onmod: (v:number)=>void }} */
  let { bend, modwheel, onbend, onmod } = $props();

  function drag(e, kind) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const apply = (ev) => {
      const r = el.getBoundingClientRect();
      const n = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      if (kind === 'bend') onbend(n * 2 - 1);
      else onmod(n);
    };
    apply(e);
    const moveHandler = (ev) => apply(ev);
    const upHandler = () => {
      el.removeEventListener('pointermove', moveHandler);
      el.removeEventListener('pointerup', upHandler);
      el.removeEventListener('pointercancel', upHandler);
      if (kind === 'bend') onbend(0); // spring back
    };
    el.addEventListener('pointermove', moveHandler);
    el.addEventListener('pointerup', upHandler);
    el.addEventListener('pointercancel', upHandler);
  }
</script>

<div class="wheels">
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
</div>

<style>
  .wheels { display: flex; gap: 8px; height: 150px; }
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
  .thumb {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 12px;
    border-radius: 3px;
    background: var(--accent-2);
  }
</style>
