<script module lang="ts">
  const decodedUrlSession = new Set<string>();
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Spring } from "svelte/motion";
  import { locale } from "../i18n/locale.svelte.js";
  import { measureLibraryPhase } from "../libraryPerformance.js";

  type CarouselDebugSnapshot = {
    covers: number;
    focus: number;
    tilesPerSecond: number;
    rendered: number;
    preloadRequested: number;
    lodRequested: number;
    fullRequested: number;
    decodeStarted: number;
    decodeDone: number;
    decodeFailed: number;
    decodeCanceled: number;
    queueDepth: number;
    activeDecodes: number;
    decodedUrls: number;
    elapsedMs: number;
  };

  declare global {
    interface Window {
      __gnwCarouselDebug?: {
        snapshot: () => CarouselDebugSnapshot;
        reset: () => void;
      };
    }
  }
  
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
    onPreview = () => {},
    onScrubState = () => {},
    onMotionState = () => {},
    getUrl = () => "", 
    getCachedUrl = () => "",
    getLodUrl = () => "",
    getAtlasCell = () => null,
    systemLabel = () => "",
    version = 0
  } = $props<{
    covers: any[];
    selectedId: string;
    onSelect?: (id: string) => void;
    onPreview?: (id: string) => void;
    onScrubState?: (active: boolean) => void;
    onMotionState?: (active: boolean) => void;
    getUrl?: (id: string, version?: number) => string;
    getCachedUrl?: (id: string, version?: number) => string;
    getLodUrl?: (id: string, version?: number) => string;
    getAtlasCell?: (id: string, version?: number) => { url: string; x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number } | null;
    systemLabel?: (cover: any) => string;
    version?: number;
  }>();

  let focusIndex = $state(0);
  
  $effect(() => {
    if (selectedId) {
      const i = covers.findIndex((c: any) => c.id === selectedId);
      if (i >= 0) {
        focusIndex = i;
      }
    }
  });

  const smoothIndex = new Spring(0, { stiffness: 0.1, damping: 0.8 });
  let visualCenter = $derived(Math.round(smoothIndex.current));
  $effect(() => {
    smoothIndex.target = focusIndex;
  });

  let focused = $derived(covers[focusIndex] ?? null);

  // Decode each object URL at most once per carousel instance. Fast scrubbing revisits the same
  // neighborhood repeatedly; creating a fresh Image for every focus update caused the browser
  // to redo decodes and briefly show unloaded covers on large libraries.
  const decodedUrls = decodedUrlSession;
  const pendingDecodes = new Map<string, Promise<void>>();
  const pendingImages = new Map<string, HTMLImageElement>();
  const pendingLodUrls = new Set<string>();
  const preloadQueue: Array<{ url: string; lowResolution: boolean }> = [];
  const queuedPreloads = new Set<string>();
  const PRELOAD_CONCURRENCY = 4;
  let activePreloads = 0;
  let debugStarted = performance.now();
  let debugRendered = 0;
  let debugPreloadRequested = 0;
  let debugLodRequested = 0;
  let debugFullRequested = 0;
  let debugDecodeStarted = 0;
  let debugDecodeDone = 0;
  let debugDecodeFailed = 0;
  let debugDecodeCanceled = 0;
  const carouselDebugSnapshot = (): CarouselDebugSnapshot => ({
    covers: covers.length,
    focus: focusIndex,
    tilesPerSecond: Math.round(tilesPerSecond),
    rendered: debugRendered,
    preloadRequested: debugPreloadRequested,
    lodRequested: debugLodRequested,
    fullRequested: debugFullRequested,
    decodeStarted: debugDecodeStarted,
    decodeDone: debugDecodeDone,
    decodeFailed: debugDecodeFailed,
    decodeCanceled: debugDecodeCanceled,
    queueDepth: preloadQueue.length,
    activeDecodes: activePreloads,
    decodedUrls: decodedUrls.size,
    elapsedMs: Math.round(performance.now() - debugStarted),
  });
  function resetCarouselDebug(): void {
    debugStarted = performance.now();
    debugRendered = 0;
    debugPreloadRequested = 0;
    debugLodRequested = 0;
    debugFullRequested = 0;
    debugDecodeStarted = 0;
    debugDecodeDone = 0;
    debugDecodeFailed = 0;
    debugDecodeCanceled = 0;
  }
  function pumpPreloads(): void {
    while (activePreloads < PRELOAD_CONCURRENCY && preloadQueue.length > 0) {
      const next = preloadQueue.shift()!;
      queuedPreloads.delete(next.url);
      if (decodedUrls.has(next.url) || pendingDecodes.has(next.url)) continue;
      activePreloads++;
      debugDecodeStarted++;
      const image = new Image();
      pendingImages.set(next.url, image);
      if (next.lowResolution) pendingLodUrls.add(next.url);
      image.src = next.url;
      const pending = image.decode()
        .then(() => {
          decodedUrls.add(next.url);
          if (decodedUrls.size > 256) decodedUrls.delete(decodedUrls.values().next().value!);
          debugDecodeDone++;
        })
        .catch(() => { debugDecodeFailed++; })
        .finally(() => {
          pendingDecodes.delete(next.url);
          pendingImages.delete(next.url);
          pendingLodUrls.delete(next.url);
          activePreloads--;
          pumpPreloads();
        });
      pendingDecodes.set(next.url, pending);
    }
  }
  function preloadUrl(url: string, lowResolution = false): void {
    if (decodedUrls.has(url) || pendingDecodes.has(url) || queuedPreloads.has(url)) return;
    queuedPreloads.add(url);
    debugPreloadRequested++;
    if (lowResolution) debugLodRequested++; else debugFullRequested++;
    preloadQueue.push({ url, lowResolution });
    pumpPreloads();
  }

  function cancelPreloadsExcept(keep: Set<string>): void {
    for (let i = preloadQueue.length - 1; i >= 0; i--) {
      const queued = preloadQueue[i];
      if (queued.lowResolution || keep.has(queued.url)) continue;
      preloadQueue.splice(i, 1);
      queuedPreloads.delete(queued.url);
    }
    for (const [url, image] of pendingImages) {
      // LOD is the always-available scrub surface. Let an in-flight .img finish even after
      // focus moves away; cancelling it is what produced blank/"No cover" tiles when scrubbing
      // back over a region that had just been visited.
      if (pendingLodUrls.has(url)) continue;
      if (keep.has(url)) continue;
      image.src = "";
      debugDecodeCanceled++;
      pendingImages.delete(url);
      pendingDecodes.delete(url);
    }
  }

  onDestroy(() => {
    if (typeof window !== "undefined" && window.__gnwCarouselDebug?.snapshot === carouselDebugSnapshot) delete window.__gnwCarouselDebug;
    if (lodRetryTimer) clearTimeout(lodRetryTimer);
    if (preloadRefreshTimer) clearTimeout(preloadRefreshTimer);
    for (const image of pendingImages.values()) image.src = "";
    pendingImages.clear();
    pendingDecodes.clear();
    pendingLodUrls.clear();
    preloadQueue.length = 0;
    queuedPreloads.clear();
  });

  // The track only ever draws a small neighborhood around the focus. Iterating the complete
  // library in the template on every spring frame made 1,600-entry libraries noticeably slower
  // than 600-entry ones, even though the off-screen cards were immediately discarded.
  const renderCovers = $derived.by(() => {
    return measureLibraryPhase("carousel render window", covers.length, () => {
      const center = Math.round(smoothIndex.current);
      const start = Math.max(0, center - SIDE - 2);
      const end = Math.min(covers.length, center + SIDE + 3);
      return covers.slice(start, end).map((cover: any, i: number) => ({ cover, index: start + i }));
    });
  });

  // Keep a small decoded LOD window around the focus. The parent already has the cover bytes in
  // memory; this only asks the browser to fetch/decode nearby object URLs before they become
  // visible during a fast scrub. The full library remains data-only and the DOM still renders
  // only the cards around the focus.
  // Keep a broad low-resolution window and a cache-sized high-resolution neighborhood.
  const PRELOAD_RADIUS = 120;
  const FULL_RES_PRELOAD_RADIUS = 60;
  const FULL_RES_MAX_SPEED = 200;
  const FULL_RES_FADE_BAND = 100;
  const PRELOAD_REFRESH_INTERVAL_MS = 50;
  let tilesPerSecond = $state(0);
  let motionDirection = $state(1);
  let lastFocusIndex = 0;
  let lastVelocityCovers = covers;
  let velocityRaf = 0;
  let lastVisualSample = 0;
  let lastVisualIndex = smoothIndex.current;
  let lodRetryTimer = 0;
  let lodRetryCount = 0;
  let lodRetryCenter = -1;
  let lodRetryTick = $state(0);
  let preloadRefreshTimer = 0;
  let lastPreviewTime = 0;
  let lastPreviewId = "";
  function sampleVisualVelocity(now: number): void {
    const current = smoothIndex.current;
    if (lastVisualSample) {
      const elapsed = Math.max(1, now - lastVisualSample);
      const delta = current - lastVisualIndex;
      tilesPerSecond = Math.abs(delta) * 1000 / elapsed;
      if (delta !== 0) motionDirection = Math.sign(delta);
    }
    lastVisualSample = now;
    lastVisualIndex = current;
    if (isScrubbing && now - lastPreviewTime >= 1000 / 120) {
      const previewId = covers[Math.max(0, Math.min(covers.length - 1, Math.round(current)))]?.id;
      if (previewId && previewId !== lastPreviewId) {
        lastPreviewId = previewId;
        lastPreviewTime = now;
        onPreview(previewId);
      }
    }
    if (isScrubbing || Math.abs(current - focusIndex) > 0.01) {
      velocityRaf = requestAnimationFrame(sampleVisualVelocity);
    } else {
      velocityRaf = 0;
      lastVisualSample = 0;
      tilesPerSecond = 0;
    }
  }
  $effect(() => {
    const coversChanged = covers !== lastVelocityCovers;
    lastVelocityCovers = covers;
    if (coversChanged) {
      tilesPerSecond = 0;
      lastVisualSample = 0;
      lastVisualIndex = smoothIndex.current;
    }
    const focusChanged = focusIndex !== lastFocusIndex;
    lastFocusIndex = focusIndex;
    if ((focusChanged || coversChanged) && !velocityRaf) {
      velocityRaf = requestAnimationFrame(sampleVisualVelocity);
    }
  });

  function preloadCoverAt(i: number, currentVersion: number, urlsToKeep: Set<string>): boolean {
    if (i < 0 || i >= covers.length) return false;
    const atlasCell = getAtlasCell(covers[i]?.id, currentVersion);
    const lodUrl = atlasCell ? "" : (covers[i]?.lodUrl || getLodUrl(covers[i]?.id, currentVersion));
    if (atlasCell) return false;
    if (lodUrl) { urlsToKeep.add(lodUrl); preloadUrl(lodUrl, true); }
    return !lodUrl;
  }

  function preloadFullCoverAt(index: number, currentVersion: number, urlsToKeep: Set<string>): boolean {
    if (index < 0 || index >= covers.length) return false;
    const fullUrl = covers[index]?.url || getUrl(covers[index]?.id, currentVersion);
    if (!fullUrl) return true;
    urlsToKeep.add(fullUrl);
    preloadUrl(fullUrl);
    return !decodedUrls.has(fullUrl);
  }

  function refreshPreloads(): void {
    measureLibraryPhase("carousel preload effect", covers.length, () => {
      const currentVersion = version;
      const center = visualCenter;
      debugRendered++;
      if (center !== lodRetryCenter) {
        lodRetryCenter = center;
        lodRetryCount = 0;
      }
      const urlsToKeep = new Set<string>();
      let missingLod = false;
      for (let distance = PRELOAD_RADIUS; distance >= 0; distance--) {
        if (distance === 0) missingLod = preloadCoverAt(center, currentVersion, urlsToKeep) || missingLod;
        else {
          missingLod = preloadCoverAt(center - distance, currentVersion, urlsToKeep) || missingLod;
          missingLod = preloadCoverAt(center + distance, currentVersion, urlsToKeep) || missingLod;
        }
      }
      if (!isScrubbing && center !== focusIndex) {
        preloadFullCoverAt(focusIndex, currentVersion, urlsToKeep);
      }
      const speed = tilesPerSecond;
      const stride = Math.max(1, Math.ceil(speed / 60));
      const budget = speed < 30 ? FULL_RES_PRELOAD_RADIUS * 2 + 1 : speed < 120 ? 12 : speed < 300 ? 6 : 2;
      const direction = motionDirection || 1;
      const leadingIndex = speed >= 300 ? center + direction * Math.round(speed * PRELOAD_REFRESH_INTERVAL_MS / 1000) : center;
      let requested = 0;
      for (let distance = 0; distance <= FULL_RES_PRELOAD_RADIUS && requested < budget; distance += stride) {
        const forward = leadingIndex + direction * distance;
        if (preloadFullCoverAt(forward, currentVersion, urlsToKeep)) requested++;
        if (distance > 0 && requested < budget) {
          if (preloadFullCoverAt(leadingIndex - direction * distance, currentVersion, urlsToKeep)) requested++;
        }
      }
      if (missingLod && lodRetryCount < 60) {
        lodRetryCount++;
        lodRetryTimer = window.setTimeout(() => {
          lodRetryTimer = 0;
          lodRetryTick++;
        }, 16);
      }
      cancelPreloadsExcept(urlsToKeep);
    });
  }

  $effect(() => {
    covers.length;
    version;
    visualCenter;
    tilesPerSecond;
    motionDirection;
    lodRetryTick;
    if (preloadRefreshTimer) return;
    preloadRefreshTimer = window.setTimeout(() => {
      preloadRefreshTimer = 0;
      refreshPreloads();
    }, PRELOAD_REFRESH_INTERVAL_MS);
  });

  onMount(() => {
    window.__gnwCarouselDebug = { snapshot: carouselDebugSnapshot, reset: resetCarouselDebug };
    return () => {
      if (window.__gnwCarouselDebug?.snapshot === carouselDebugSnapshot) delete window.__gnwCarouselDebug;
    };
  });

  let aspects = $state<Record<string, number>>({});
  let loadedMainUrls = $state<Record<string, string>>({});
  async function onImgLoad(id: string, e: Event) {
    const target = e.target as HTMLImageElement;
    const url = target.currentSrc || target.src;
    try { await target.decode(); } catch { return; }
    if ((target.currentSrc || target.src) !== url) return;
    const { naturalWidth: w, naturalHeight: h } = target;
    if (!w || !h) return;
    loadedMainUrls[id] = url;
    const ratio = Math.max(0.6, Math.min(1.8, w / h));
    if (Math.abs((aspects[id] ?? 0) - ratio) >= 0.001) {
      aspects[id] = ratio;
    }
  }
  
  function triggerSelect(id: string) {
    selectedId = id;
    if (onSelect) onSelect(id);
  }

  function go(steps: number, select = false) {
    if (!covers.length) return;
    let next = focusIndex + steps;
    next = Math.max(0, Math.min(covers.length - 1, next));
    focusIndex = next;
    if (select && covers[next]?.id !== selectedId) triggerSelect(covers[next].id);
  }

  let vpRef = $state<HTMLElement | null>(null);
  let vp = $state({ w: 0, h: 0 });
  
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!covers.length) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1, true); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1, true); }
    };
    window.addEventListener("keydown", onKey);

    const updateVp = () => {
      if (scrubberRef) scrubberWidth = scrubberRef.clientWidth;
      if (vpRef) {
        vp = { w: vpRef.clientWidth, h: vpRef.clientHeight };
      }
    };
    updateVp();
    const ro = new ResizeObserver(updateVp);
    if (vpRef) ro.observe(vpRef);
    if (scrubberRef) ro.observe(scrubberRef);

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
    };
  });

  // Wheel navigation mirrors the arrow keys: one wheel notch advances one selected cover.
  onMount(() => {
    let accum = 0;
    let lastTs = 0;
    const THRESHOLD = 100;
    const onWheel = (event: WheelEvent) => {
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!rawDelta) return;
      event.preventDefault();
      if (event.timeStamp - lastTs > 120) accum = 0;
      lastTs = event.timeStamp;
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 40
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? (vpRef?.clientHeight ?? 800)
          : 1;
      accum += rawDelta * scale;
      if (Math.abs(accum) >= THRESHOLD) {
        const steps = Math.trunc(accum / THRESHOLD);
        accum -= steps * THRESHOLD;
        go(steps, true);
      }
    };
    const targets = [vpRef, scrubberRef].filter((el): el is HTMLElement => !!el);
    for (const target of targets) target.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      for (const target of targets) target.removeEventListener("wheel", onWheel);
    };
  });

  const ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let scrubX = $state<number | null>(null);
  let scrubberRef = $state<HTMLElement | null>(null);
  let isScrubbing = $state(false);
  let scrubberWidth = $state(0);
  let scrubBounds: DOMRect | null = null;
  let scrubPendingEvent: PointerEvent | null = null;
  let scrubRaf = 0;

  const letterBounds = $derived.by(() => {
    const bounds = ALPHABET.map(() => ({ first: -1, last: -1 }));
    covers.forEach((cover: any, index: number) => {
      let first = cover.name.charAt(0).toUpperCase();
      if (first < "A" || first > "Z") first = "#";
      const letterIndex = ALPHABET.indexOf(first);
      if (letterIndex < 0) return;
      if (bounds[letterIndex].first < 0) bounds[letterIndex].first = index;
      bounds[letterIndex].last = index;
    });
    return bounds;
  });

  function getHandleLeft() {
    if (covers.length === 0) return 0;
    if (isScrubbing && scrubX !== null && scrubberWidth > 0) {
      return (scrubX / scrubberWidth) * 100;
    }
    return (smoothIndex.current / Math.max(1, covers.length - 1)) * 100;
  }

  function getCurrentLetterFraction() {
    if (covers.length === 0) return 0;
    const currentIndex = isScrubbing ? focusIndex : smoothIndex.current;
    const idx = Math.max(0, Math.min(covers.length - 1, Math.round(currentIndex)));
    const currentName = covers[idx]?.name || "";
    let first = currentName.charAt(0).toUpperCase();
    if (first < "A" || first > "Z") first = "#";
    const letterIdx = ALPHABET.indexOf(first);
    if (letterIdx === -1) return 0;
    
    const bounds = letterBounds[letterIdx];
    const firstOfLetter = bounds.first;
    const lastOfLetter = bounds.last;
    
    let subFraction = 0.5; // default center
    if (lastOfLetter > firstOfLetter) {
      subFraction = (currentIndex - firstOfLetter) / (lastOfLetter - firstOfLetter);
    }
    
    return letterIdx + subFraction;
  }

  function processScrubberPointerMove() {
    measureLibraryPhase("carousel pointer update", covers.length, () => {
    scrubRaf = 0;
    const e = scrubPendingEvent;
    scrubPendingEvent = null;
    if (!e || !scrubberRef) return;
    const rect = scrubBounds ?? scrubberRef.getBoundingClientRect();
    if (!rect.width) return;
    scrubX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    
    if (isScrubbing && covers.length > 0) {
      const fraction = scrubX / rect.width;
      const bestIdx = Math.min(covers.length - 1, Math.max(0, Math.floor(fraction * covers.length)));
      
      if (covers[bestIdx]) {
        focusIndex = bestIdx;
        // Keep scrubbing local to the carousel. Propagating selection through the entire
        // library on every pointer event forces Svelte to recompute thousands of rows and was
        // the source of multi-hundred-millisecond microtask flushes in performance traces.
        // Commit the selected row once on pointer-up instead.
      }
    }
    });
  }

  function onScrubberPointerMove(e: PointerEvent) {
    scrubPendingEvent = e;
    if (!scrubRaf) scrubRaf = requestAnimationFrame(processScrubberPointerMove);
  }

  let profileRaf = 0;
  let profileObserver: MutationObserver | null = null;
  let profileFrames: number[] = [];
  let profileLast = 0;
  let profileAdded = 0;
  function stopScrubProfile(report = true) {
    cancelAnimationFrame(profileRaf);
    profileObserver?.disconnect();
    if (profileObserver && report) {
      const frames = [...profileFrames].sort((a, b) => a - b);
      console.info("[carousel scrub]", {
        entries: covers.length, frames: frames.length, cardsCreated: profileAdded,
        p95FrameMs: frames[Math.floor(frames.length * 0.95)] ?? 0,
        maxFrameMs: frames.at(-1) ?? 0,
        framesOver32ms: frames.filter(ms => ms > 32).length,
      });
    }
    profileObserver = null;
  }
  function startScrubProfile() {
    if (!new URLSearchParams(window.location.search).has("carouselProfile") || !vpRef) return;
    stopScrubProfile(false);
    profileFrames = [];
    profileAdded = 0;
    profileLast = performance.now();
    profileObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) {
          profileAdded += Number(node.matches(".coverflow-item"));
          profileAdded += node.querySelectorAll(".coverflow-item").length;
        }
      }
    });
    profileObserver.observe(vpRef, { childList: true, subtree: true });
    const sample = (now: number) => {
      profileFrames.push(now - profileLast);
      profileLast = now;
      profileRaf = requestAnimationFrame(sample);
    };
    profileRaf = requestAnimationFrame(sample);
  }
  onMount(() => () => {
    stopScrubProfile(false);
    cancelAnimationFrame(scrubRaf);
    if (velocityRaf) cancelAnimationFrame(velocityRaf);
  });

  function onScrubberPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Only left click
    scrubBounds = scrubberRef?.getBoundingClientRect() ?? null;
    if (scrubBounds) scrubberWidth = scrubBounds.width;
    isScrubbing = true;
    lastPreviewTime = 0;
    lastPreviewId = "";
    startScrubProfile();
    onScrubState(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onScrubberPointerMove(e);
  }

  function onScrubberPointerUp(e: PointerEvent) {
    const wasScrubbing = isScrubbing;
    if (scrubRaf) {
      cancelAnimationFrame(scrubRaf);
      processScrubberPointerMove();
    }
    isScrubbing = false;
    stopScrubProfile();
    scrubX = null;
    scrubBounds = null;
    const handle = e.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const selected = covers[focusIndex];
    if (wasScrubbing && selected) {
      preloadFullCoverAt(focusIndex, version, new Set<string>());
      triggerSelect(selected.id);
    }
    onScrubState(false);
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
  const motionActive = $derived(isScrubbing || stageDownX !== null || Math.abs(smoothIndex.current - focusIndex) > 0.01);
  $effect(() => { onMotionState(motionActive); });
  onDestroy(() => onMotionState(false));

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
      <div class="coverflow-empty">{locale.t.roms.carousel.noGames}</div>
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
          {#each renderCovers as item (item.cover.id)}
            {@const cover = item.cover}
            {@const index = item.index}
            {@const offset = index - smoothIndex.current}
            {@const atlasCell = getAtlasCell(cover.id, version)}
            {@const atlasScale = atlasCell ? Math.min(cardW / atlasCell.width, cardH / atlasCell.height) : 1}
            {@const lodUrl = atlasCell ? "" : (cover.lodUrl || getLodUrl(cover.id, version))}
            <!-- LOD remains the fast scrub surface. Full-resolution art is allowed as soon as
                 motion is slow enough for the eye to resolve it, including during a scrub. -->
            {@const mainUrl = cover.url || getCachedUrl(cover.id, version) || (!atlasCell || (index === visualCenter && tilesPerSecond < 60) ? getUrl(cover.id, version) : "")}
            {#if Math.abs(offset) <= SIDE + 1}
              {@const a = Math.abs(offset)}
              {@const isSelected = cover.id === selectedId}
              {@const layout = getLayout(offset)}
              {@const ratio = aspects[cover.id] ?? ASPECT}
              {@const fullResOpacity = index === visualCenter || !atlasCell ? 1 : Math.max(0, Math.min(1, (FULL_RES_MAX_SPEED + FULL_RES_FADE_BAND / 2 - tilesPerSecond) / FULL_RES_FADE_BAND))}
              {@const showFullRes = !!mainUrl && (!atlasCell || (loadedMainUrls[cover.id] === mainUrl && fullResOpacity >= 0.5))}
              
              <button
                type="button"
                class="coverflow-item {isSelected ? 'coverflow-item--selected' : ''}"
                style="
                  width: {cardW}px;
                  height: {cardH}px;
                  transform: translate(-50%, -50%) translateX({layout.x}px) translateZ({layout.z}px) rotateY({layout.ry}deg) scale({layout.sc});
                  z-index: {20 - a};
                  opacity: {Math.max(0, 1 - a * 0.12)};
                  pointer-events: none;
                "
                title={cover.name}
                data-version={version}
              >
                {#if atlasCell || mainUrl || lodUrl}
                  {#if atlasCell && !showFullRes}
                    <span
                      class="coverflow-item__atlas"
                      aria-hidden="true"
                    >
                      <span
                        class="coverflow-item__atlas-sprite"
                        style={`width: ${atlasCell.width}px; height: ${atlasCell.height}px; background-image: url(${atlasCell.url}); background-size: ${atlasCell.pageWidth}px ${atlasCell.pageHeight}px; background-position: -${atlasCell.x}px -${atlasCell.y}px; transform: scale(${atlasScale});`}
                      ></span>
                    </span>
                  {/if}
                  {#if !atlasCell && lodUrl && lodUrl !== mainUrl}
                    <img class="coverflow-item__lod" src={lodUrl} alt="" data-version={version} draggable={false} decoding="async" />
                  {/if}
                  {#if mainUrl}
                    <img class="coverflow-item__main" class:coverflow-item__main--loaded={showFullRes} src={mainUrl} alt="" data-version={version} draggable={false} decoding="async" onload={(e) => onImgLoad(cover.id, e)} />
                  {/if}
                {:else}
                  <span class="coverflow-item__placeholder" aria-hidden="true"></span>
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
            style="transform: translate3d({getHandleLeft() * scrubberWidth / 100}px, 0, 0) translate(-50%, -50%);"
            role="slider"
            aria-valuemin="0"
            aria-valuemax="26"
            aria-valuenow="0"
            tabindex="0"
            onpointerdown={onScrubberPointerDown}
            onpointermove={onScrubberPointerMove}
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
                        color: {dist < 0.5 ? 'var(--gold)' : '#fff'};
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
  /* Every Library artboard (Roms / RomsNewSystem / RomsSdNoCard / RomsOptions /
     LibrarySummary) draws the coverflow bare on the page ground: the only surfaces on the
     screen are the game list's white plate and the dock. No card, no radius, no inset. */
  .carousel-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    /* The coverflow orders its slides with a computed `20 - a` per item (see the template),
       and the scrubber lifts its handle over its track. Those numbers are relative to each
       other and mean nothing against the app's scale, so this root isolates them: without a
       stacking context here they competed with real app layers, which is how the Library's
       dock ended up underneath the carousel. `isolation` and not `overflow`/`transform`,
       which would clip or re-parent as a side effect. See --z-raised in tokens.css. */
    isolation: isolate;
    background: none;
    border-radius: 0;
    padding: 0;
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
  .coverflow-item img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.3));
    transition: filter 0.2s ease-out;
  }
  .coverflow-item__main {
    opacity: 0;
  }
  .coverflow-item__main--loaded {
    opacity: 1;
  }
  .coverflow-item__atlas {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.3));
  }
  .coverflow-item__atlas-sprite {
    display: block;
    flex: none;
    background-repeat: no-repeat;
    transform-origin: center;
  }
  /* Artboard: a coverless card is a flat grey plate with a soft cast shadow — no border and
     no inset vignette — and its title sits bottom-left in 12px/600 sentence case, not
     centred bold caps. */
  .coverflow-item__placeholder {
    width: 100%;
    height: 100%;
    background: var(--surface-sunk);
    border-radius: 4px;
    border: none;
    box-shadow: 0 8px 26px rgba(0, 0, 0, 0.2);
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    color: var(--ink-soft);
    font-size: var(--fs-chip);
    font-weight: 600;
    text-transform: none;
    text-align: start;
    padding: 12px;
    box-sizing: border-box;
  }
  /* Artboard: the scrubber row is inset 60px from each side of the coverflow column and
     sits 22px below the stage. */
  .alphabet-scrubber-container {
    width: calc(100% - 120px);
    max-width: none;
    margin: 22px auto 0;
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
    /* Artboard (RomsNewSystem): 6px track, 3px radius, --surface-sunk fill. */
    height: 6px;
    background: var(--surface-sunk);
    border-radius: 3px;
    transform: translateY(-50%);
  }
  .scrubber-handle {
    position: absolute;
    left: 0;
    will-change: transform;
    top: 50%;
    /* Artboard: a 46px x 14px pill in --silver-edge, not the darker soft ink. */
    width: 46px;
    height: 14px;
    background: var(--silver-edge);
    border-radius: 7px;
    transform: translate(-50%, -50%);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    z-index: var(--z-raised);
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
    transition: none;
  }
  
  .mag-letter {
    width: 24px;
    flex-shrink: 0;
    text-align: center;
    font-size: 1.1rem;
    font-weight: bold;
    color: white;
    will-change: transform, opacity, color;
    transition: none;
  }
</style>
