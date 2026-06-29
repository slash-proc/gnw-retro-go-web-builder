<script lang="ts">
  import { onMount } from "svelte";
  import { Spring } from "svelte/motion";
  
  const ASPECT = 1.3;
  const SIDE = 4;
  const CENTER_FRACTION = 0.5;
  const FIRST_OFFSET = 0.55;
  const GAP = 0.5;
  const ROTATE = 48;
  const DEPTH = 120;
  const SCALE_BASE = 0.84;
  const SCALE_STEP = 0.1;

  let { 
    covers = [], 
    selectedId = $bindable(""), 
    onSelect = () => {}, 
    getUrl = () => "", 
    systemLabel = () => "",
    version = 0
  } = $props<{
    covers: any[];
    selectedId: string;
    onSelect?: (id: string) => void;
    getUrl?: (id: string, version?: number) => string;
    systemLabel?: (cover: any) => string;
    version?: number;
  }>();

  let focusIndex = $state(0);
  
  $effect(() => {
    if (selectedId) {
      const i = covers.findIndex((c: any) => c.id === selectedId);
      if (i >= 0) focusIndex = i;
    }
  });

  const smoothIndex = new Spring(0, { stiffness: 0.1, damping: 0.8 });
  $effect(() => {
    smoothIndex.target = focusIndex;
  });

  let focused = $derived(covers[focusIndex] ?? null);

  let aspects = $state<Record<string, number>>({});
  function onImgLoad(id: string, e: Event) {
    const target = e.target as HTMLImageElement;
    const { naturalWidth: w, naturalHeight: h } = target;
    if (!w || !h) return;
    const ratio = Math.max(0.6, Math.min(1.8, w / h));
    if (Math.abs((aspects[id] ?? 0) - ratio) >= 0.001) {
      aspects[id] = ratio;
    }
  }
  
  function triggerSelect(id: string) {
    selectedId = id;
    if (onSelect) onSelect(id);
  }

  function go(steps: number) {
    if (!covers.length) return;
    let next = focusIndex + steps;
    next = Math.max(0, Math.min(covers.length - 1, next));
    focusIndex = next;
  }

  let vpRef = $state<HTMLElement | null>(null);
  let vp = $state({ w: 0, h: 0 });
  
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!covers.length) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);

    const updateVp = () => {
      if (vpRef) {
        vp = { w: vpRef.clientWidth, h: vpRef.clientHeight };
      }
    };
    updateVp();
    const ro = new ResizeObserver(updateVp);
    if (vpRef) ro.observe(vpRef);

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
    };
  });

  // Wheel handling
  onMount(() => {
    if (!vpRef) return;
    const el = vpRef;
    let accum = 0;
    let lastTs = 0;
    const THRESHOLD = 30; // pixels per game scrub
    
    const onWheel = (e: WheelEvent) => {
      // Horizontal scroll
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        if (e.timeStamp - lastTs > 100) accum = 0;
        lastTs = e.timeStamp;
        
        accum += e.deltaX;
        if (Math.abs(accum) >= THRESHOLD) {
          const steps = Math.trunc(accum / THRESHOLD);
          accum -= steps * THRESHOLD;
          go(steps);
        }
      }
    };
    el.addEventListener("wheel", onWheel as any, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as any);
  });

  const ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let scrubX = $state<number | null>(null);
  let scrubberRef = $state<HTMLElement | null>(null);
  let isScrubbing = $state(false);

  function getHandleLeft() {
    if (covers.length === 0) return 0;
    if (isScrubbing && scrubX !== null && scrubberRef) {
      return (scrubX / scrubberRef.clientWidth) * 100;
    }
    return (smoothIndex.current / Math.max(1, covers.length - 1)) * 100;
  }

  function getCurrentLetterFraction() {
    if (covers.length === 0) return 0;
    const currentIndex = smoothIndex.current;
    const idx = Math.max(0, Math.min(covers.length - 1, Math.round(currentIndex)));
    const currentName = covers[idx]?.name || "";
    let first = currentName.charAt(0).toUpperCase();
    if (first < "A" || first > "Z") first = "#";
    const letterIdx = ALPHABET.indexOf(first);
    if (letterIdx === -1) return 0;
    
    // Find bounds for this letter
    let firstOfLetter = covers.findIndex((c: any) => {
      let f = c.name.charAt(0).toUpperCase();
      if (f < "A" || f > "Z") f = "#";
      return f === first;
    });
    let lastOfLetter = covers.findLastIndex((c: any) => {
      let f = c.name.charAt(0).toUpperCase();
      if (f < "A" || f > "Z") f = "#";
      return f === first;
    });
    
    let subFraction = 0.5; // default center
    if (lastOfLetter > firstOfLetter) {
      subFraction = (currentIndex - firstOfLetter) / (lastOfLetter - firstOfLetter);
    }
    
    return letterIdx + subFraction;
  }

  function onScrubberPointerMove(e: PointerEvent) {
    if (!scrubberRef) return;
    const rect = scrubberRef.getBoundingClientRect();
    scrubX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    
    if (isScrubbing && covers.length > 0) {
      const fraction = scrubX / rect.width;
      const bestIdx = Math.min(covers.length - 1, Math.max(0, Math.floor(fraction * covers.length)));
      
      if (covers[bestIdx] && covers[bestIdx].id !== selectedId) {
        triggerSelect(covers[bestIdx].id);
      }
    }
  }

  function onScrubberPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Only left click
    isScrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onScrubberPointerMove(e);
  }

  function onScrubberPointerUp(e: PointerEvent) {
    isScrubbing = false;
    scrubX = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  let ready = $derived(vp.w > 0 && vp.h > 0);
  let cardW = $derived(ready ? Math.min(vp.w * CENTER_FRACTION, vp.h * 0.86 * ASPECT, 300 * ASPECT) : 230 * ASPECT);
  let cardH = $derived(cardW / ASPECT);
  let gap = $derived(cardW * GAP);

  function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

  function getLayout(offset: number) {
    const a = Math.abs(offset);
    // when offset is exactly 0, sign is 0, which breaks s*x if we aren't careful
    const s = offset < 0 ? -1 : 1; 
    const gap = cardW * GAP;
    
    let x = 0;
    if (a <= 1) {
      x = s * (a * cardW * FIRST_OFFSET);
    } else {
      x = s * (cardW * FIRST_OFFSET + (a - 1) * gap);
    }
    
    const z = -a * DEPTH;
    const ry = (s * -ROTATE * easeOut(Math.min(1, a))) * 0.7;
    const sc = 1 - Math.min(1, a) * 0.15;
    
    return { x, z, ry, sc };
  }

  let stageDownX = $state<number | null>(null);
  let stageStartX = 0;
  let stageDidDrag = false;
  let stageAccum = 0;

  function onStagePointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stageDownX = e.clientX;
    stageStartX = e.clientX;
    stageDidDrag = false;
    stageAccum = 0;
    if (vpRef) vpRef.setPointerCapture(e.pointerId);
  }

  function onStagePointerMove(e: PointerEvent) {
    if (stageDownX === null) return;
    const dx = e.clientX - stageDownX;
    stageDownX = e.clientX;
    if (Math.abs(e.clientX - stageStartX) > 5) {
      stageDidDrag = true;
    }
    stageAccum -= dx;
    if (Math.abs(stageAccum) >= 30) {
      const steps = Math.trunc(stageAccum / 30);
      stageAccum -= steps * 30;
      go(steps);
    }
  }

  function onStagePointerUp(e: PointerEvent) {
    if (stageDownX === null) return;
    stageDownX = null;
    if (vpRef) vpRef.releasePointerCapture(e.pointerId);
    
    // If it was just a click (no dragging), trigger the click logic
    if (!stageDidDrag) {
      const rect = vpRef!.getBoundingClientRect();
      const clickX = e.clientX - rect.left - rect.width / 2;
      let best: any = null;
      let bestDist = Infinity;
      covers.forEach((cover: any, index: number) => {
        const offset = index - focusIndex;
        if (Math.abs(offset) > SIDE) return;
        const d = Math.abs(getLayout(offset).x - clickX);
        if (d < bestDist) { bestDist = d; best = cover; }
      });
      if (best && best.id !== selectedId) {
        triggerSelect(best.id);
      }
    }
  }
</script>

<div class="carousel-container">

  <div class="coverflow-stage" aria-live="polite">
    {#if covers.length === 0}
      <div class="coverflow-empty">No Games</div>
    {:else}
      <div 
        class="coverflow-viewport" 
        bind:this={vpRef} 
        role="presentation"
        onpointerdown={onStagePointerDown}
        onpointermove={onStagePointerMove}
        onpointerup={onStagePointerUp}
        onpointercancel={onStagePointerUp}
        style="touch-action: pan-y;"
      >
        <div class="coverflow-track">
          {#each covers as cover, index (cover.id)}
            {@const offset = index - smoothIndex.current}
            {#if Math.abs(offset) <= SIDE + 1}
              {@const a = Math.abs(offset)}
              {@const isSelected = cover.id === selectedId}
              {@const layout = getLayout(offset)}
              {@const ratio = aspects[cover.id] ?? ASPECT}
              
              <button
                type="button"
                class="coverflow-item {isSelected ? 'coverflow-item--selected' : ''}"
                style="
                  width: {cardW}px;
                  height: {cardH}px;
                  transform: translate(-50%, -50%) translateX({layout.x}px) translateZ({layout.z}px) rotateY({layout.ry}deg) scale({layout.sc});
                  z-index: {100 - a};
                  opacity: {Math.max(0, 1 - a * 0.12)};
                  pointer-events: none;
                "
                title={cover.name}
                data-version={version}
              >
                {#if cover.url}
                  <img src={cover.url} alt="" data-version={version} draggable={false} onload={(e) => onImgLoad(cover.id, e)} />
                {:else}
                  <span class="coverflow-item__placeholder"></span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      </div>
      
      <div class="alphabet-scrubber-container">
        <div 
          class="alphabet-scrubber" 
          bind:this={scrubberRef}
        >
          <div class="scrubber-track"></div>
          <div 
            class="scrubber-handle" 
            style="left: {getHandleLeft()}%;"
            role="slider"
            aria-valuemin="0"
            aria-valuemax="26"
            aria-valuenow="0"
            tabindex="0"
            onpointerdown={onScrubberPointerDown}
            onpointermove={onScrubberPointerMove}
            onpointerleave={onScrubberPointerUp}
            onpointerup={onScrubberPointerUp}
            onpointercancel={onScrubberPointerUp}
          >
            {#if isScrubbing || true}
              {@const cFraction = getCurrentLetterFraction()}
              <div class="scrubber-magnifier" class:active={isScrubbing}>
                <div class="magnifier-strip" style="transform: translateX(calc(50% - {(cFraction + 0.5) * 24}px));">
                  {#each ALPHABET as letter, i}
                    {@const dist = Math.abs(i - cFraction)}
                    <div 
                      class="mag-letter" 
                      style="
                        transform: scale({Math.max(0.5, 1.5 - dist)});
                        opacity: {Math.max(0.2, 1 - dist / 2.5)};
                        color: {dist < 0.5 ? 'var(--brand-gold, #f39c12)' : '#fff'};
                      "
                    >
                      {letter}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .carousel-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem 0;
  }
  
  .coverflow-stage {
    position: relative;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .coverflow-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    perspective: 1000px;
    overflow: hidden;
  }
  .coverflow-track {
    position: absolute;
    top: 50%;
    left: 50%;
    transform-style: preserve-3d;
  }
  .coverflow-item {
    position: absolute;
    top: 0;
    left: 0;
    background: transparent;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: width 0.2s ease, height 0.2s ease;
    margin: 0;
    cursor: pointer;
    will-change: transform, opacity;
  }
  .coverflow-item--selected img {
    filter: drop-shadow(0 0 15px #007bff) drop-shadow(0 0 5px #007bff);
  }
  .coverflow-item img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.3));
    transition: filter 0.2s ease-out;
  }
  .coverflow-item__placeholder {
    width: 100%;
    height: 100%;
    background: var(--surface-sunk);
    border-radius: 4px;
    border: 2px solid var(--hairline);
    box-shadow: inset 0 0 15px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.3);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft);
    font-size: 1rem;
    font-weight: bold;
    text-transform: uppercase;
    text-align: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .coverflow-item__placeholder::after {
    content: "No Cover";
  }
  .alphabet-scrubber-container {
    width: 66%;
    max-width: none;
    margin: 1.5rem auto 0;
  }
  .alphabet-scrubber {
    position: relative;
    width: 100%;
    padding: 20px 0;
    user-select: none;
    touch-action: none;
  }
  .scrubber-track {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--surface-sunk);
    border-radius: 2px;
    transform: translateY(-50%);
    z-index: 0;
  }
  .scrubber-handle {
    position: absolute;
    top: 50%;
    width: 32px;
    height: 14px;
    background: var(--ink-soft);
    border-radius: 7px;
    transform: translate(-50%, -50%);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    z-index: 10;
    transition: background 0.1s;
    cursor: ew-resize;
  }
  .alphabet-scrubber:active .scrubber-handle,
  .alphabet-scrubber:hover .scrubber-handle {
    background: var(--ink);
  }
  
  .scrubber-magnifier {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    width: 100px;
    height: 40px;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 20px;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .scrubber-magnifier.active,
  .alphabet-scrubber:hover .scrubber-magnifier {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
  
  .magnifier-strip {
    display: flex;
    align-items: center;
    height: 100%;
    will-change: transform;
    transition: transform 0.1s ease-out;
  }
  
  .mag-letter {
    width: 24px;
    flex-shrink: 0;
    text-align: center;
    font-size: 1.1rem;
    font-weight: bold;
    color: white;
    will-change: transform, opacity, color;
    transition: transform 0.1s ease-out, opacity 0.1s ease-out, color 0.1s ease-out;
  }
</style>
