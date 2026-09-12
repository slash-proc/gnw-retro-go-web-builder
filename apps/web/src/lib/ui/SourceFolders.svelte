<script lang="ts">
  // --- SOURCES panel (SourcesHomebrewConfig / SourcesCoreConfig artboards) -------------
  //
  // The LOCAL FOLDERS one remote source draws its user files from. The model is
  // `sources/localFolders.svelte.ts`; nothing about association is decided here.
  //
  // "Shared" vs "Dedicated" is that model's ONE fact, rendered: `usedBy` empty means "Any"
  // (offered to every target — Shared); a list that names this target means the folder was
  // registered for it (Dedicated). There is no third state and no boolean to invent.
  //
  // REMOVE is deliberately not offered on every row. `disassociate()` on a folder whose only
  // association is this target would empty `usedBy` and hand it straight back as an "Any"
  // folder — the row would reappear one line lower, still listed. So:
  //   * named here alongside others -> drop just this association;
  //   * named here and nowhere else -> forget the folder (nothing else refers to it);
  //   * "Any"                       -> no Remove at all. It is not this source's folder to
  //                                    delete, and the model cannot express "any EXCEPT this".
  // The artboard draws Remove on its Shared row; that row is the case the model cannot honour
  // without either lying or deleting something the rest of the app is using.
  import { locale } from "../i18n/locale.svelte.js";
  import {
    localFolders,
    targetKey,
    displayName,
    type LocalFolderRow,
  } from "../sources/localFolders.svelte.js";
  import { targetOf } from "../sources/types.js";
  import { pickFolder } from "../romScan.js";

  let {
    repo,
    targetId,
  }: {
    /** `owner/repo`, the source this page is configuring. */
    repo: string;
    /** The manifest target whose folders these are; with `repo` it forms the association key. */
    targetId: string;
  } = $props();

  const t = $derived(locale.t.sources);
  const key = $derived(targetKey(repo, targetId));

  // Idempotent by contract (the store's `loaded` guard), so an effect is the right shape:
  // this component is the first thing on the tab that needs the folder list.
  $effect(() => {
    void localFolders.load();
  });

  const rows = $derived(localFolders.foldersFor(key));

  /** Which of the three Remove behaviours this row gets. See the header. */
  function removalOf(f: LocalFolderRow): "disassociate" | "forget" | "none" {
    if (f.usedBy.length === 0) return "none";
    // By TARGET, not by key. `usedBy` may name several systems of this one core (the "Used by"
    // menu lists one entry per system), and dropping all of them leaves nothing -- that is the
    // "forget" case, exactly as one key for this target was. "Disassociate" is for a folder
    // that still serves somebody else afterwards.
    return new Set(f.usedBy.map(targetOf)).size > 1 ? "disassociate" : "forget";
  }

  function removeRow(f: LocalFolderRow): void {
    if (removalOf(f) === "disassociate") localFolders.disassociate(f.id, key);
    else void localFolders.remove(f.id);
  }

  let adding = $state(false);

  async function addFolder(): Promise<void> {
    if (adding) return;
    adding = true;
    try {
      const handle = await pickFolder("gnw-src-directory");
      // Null is the user cancelling the picker — not an error, and nothing to report.
      if (handle) await localFolders.add({ handle, usedBy: [key] });
    } catch {
      /* the picker threw (no permission, no API); the list simply does not grow */
    } finally {
      adding = false;
    }
  }
</script>

<div class="folders">
  <h4>{t.folders.heading}</h4>
  <!-- The Add row sits ABOVE the card, under the caption — the owner moved it there
       deliberately on both artboards. -->
  <button class="addrow" type="button" disabled={adding} onclick={() => void addFolder()}>
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg
    >
    <span>{t.addSource}</span>
  </button>

  {#if rows.length === 0}
    <p class="empty">{t.folders.none}</p>
  {:else}
    <div class="list">
      {#each rows as f (f.id)}
        <div class="row">
          <div class="main">
            <div class="head">
              <span class="name">{displayName(f)}</span>
              <span class="badge" class:shared={f.usedBy.length === 0}
                >{f.usedBy.length === 0 ? t.folders.shared : t.folders.dedicated}</span
              >
              {#if f.status !== "ready"}
                <span class="badge warn"
                  >{f.status === "missing" ? t.folders.missing : t.folders.needsPermission}</span
                >
              {/if}
            </div>
            <span class="path">{f.folderName}</span>
          </div>
          {#if removalOf(f) !== "none"}
            <button class="remove" type="button" onclick={() => removeRow(f)}>{t.remove}</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .folders {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .folders h4 {
    margin: 0;
    font-size: var(--fs-label);
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* Artboard: a bare plus + word above the card, separated from the caption by a hairline. */
  .addrow {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: inherit;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink);
    background: none;
    border: none;
    border-top: 1px solid var(--rule);
    padding: 12px 0 2px;
    margin: -0.5rem 0 0;
    cursor: pointer;
  }
  .addrow:disabled {
    cursor: default;
    color: var(--ink-soft);
  }
  .list {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 2px 18px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 0;
  }
  .row + .row {
    border-top: 1px solid var(--rule);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    font-size: var(--fs-body);
    font-weight: 600;
  }
  .badge {
    font-size: var(--fs-badge);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--surface-sunk);
    border-radius: 2px;
    padding: 3px 6px;
    white-space: nowrap;
  }
  /* The artboard tints only the "Shared" badge green; Dedicated stays neutral grey. */
  .badge.shared {
    color: var(--zelda-green);
    background: var(--tint-success);
  }
  .badge.warn {
    color: var(--danger);
    background: none;
    padding-inline-start: 0;
  }
  .path {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    font-family: var(--font-mono, ui-monospace, Menlo, monospace);
    overflow-wrap: anywhere;
  }
  .remove {
    font-family: inherit;
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .remove:hover {
    color: var(--danger);
  }
  .empty {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
</style>
