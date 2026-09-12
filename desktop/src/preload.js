// The preload bridge: EMPTY ON PURPOSE.
//
// This file is the seam the desktop filesystem layer will arrive through, and it is the
// security boundary for everything that ever crosses it (`docs/ELECTRON.md`, "Renderer
// security"). It exposes nothing today because the shell's only job is to load the web app,
// which needs nothing from the main process that a browser would not give it.
//
// When step 4 of the staged plan lands, the node-backed `FsDirHandle` (`apps/web/src/lib/
// fsNode.ts`, already proven against the real `romScan` consumers) reaches the renderer from
// here via `contextBridge.exposeInMainWorld` over a narrow, explicitly enumerated API. Do not
// widen it to "expose `fs`" -- that hands page content the filesystem and throws away the
// posture the main process is careful to set up.
//
// Keeping it empty until then is what lets the shell ship and be packaged without shipping an
// unreviewed privilege escalation.
