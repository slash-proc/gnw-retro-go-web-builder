/**
 * WHO ELSE HOLDS A REMOVED SOURCE'S THINGS.
 *
 * `sources.remove()` already tidies what the store itself owns: the bundle bytes, the running
 * download, the row, the selection, the dismissal. What it cannot tidy is the state other
 * modules built up *because* that source existed -- `prepareState` alone keeps five maps of it
 * (`assets`, `produced`, `assetSource`, `notices`, `failures`) plus the persisted converted
 * pointer. Left behind, those made the Library go on showing a removed source's games, and
 * every add/remove cycle orphaned another set.
 *
 * Same shape as `blobCache.ts`'s clear announcement, for the same reason: rather than have the
 * store reach into everyone who might be holding something, the module that owns the EVENT
 * says it happened and each holder decides what it means for them. The store keeps knowing
 * nothing about `prepareState`.
 *
 * WHY THIS IS ITS OWN MODULE rather than living in `store.svelte.ts` beside the event, which
 * is where `blobCache` keeps its registry. `prepareState` already imported `blobCache`, so
 * subscribing there added no dependency; it does NOT import the store, and giving it one would
 * pull the whole sources graph -- the curated import, the client, the auto-downloader, the core
 * registry -- into `prepareState`'s module graph to register one callback. A registry with no
 * imports of its own cannot form a cycle whichever side grows later.
 *
 * Nothing here runs at import time, and a listener that throws is dropped on the floor: the
 * source is gone either way, and a bookkeeping failure elsewhere must not make removing it look
 * as though it failed.
 */

/** `owner/repo` of the source that was removed. */
export type SourceRemovedListener = (repo: string) => void;

const listeners = new Set<SourceRemovedListener>();

/** Subscribe to source removals. Returns the unsubscribe. */
export function onSourceRemoved(listener: SourceRemovedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce that a source is gone. Called by `sources.remove()` once its own cleanup is done. */
export function announceSourceRemoved(repo: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(repo);
    } catch {
      /* see above: the source is gone either way */
    }
  }
}
