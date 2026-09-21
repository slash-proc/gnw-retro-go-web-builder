<script lang="ts">
  // --- LOCAL SOURCES pane body (SourcesRomFolders / SourcesLocalHomebrew artboards) --------
  //
  // The user's registered directories, drawn as the artboards' stack of white cards:
  // name, the folder's own name in mono, and a "Used by" row. Selecting a card is what the
  // footer bar's Remove acts on (the artboards draw exactly one card with the green border).
  //
  // "USED BY" IS STATIC TEXT. The artboards draw the associated target labels as small grey
  // chips, or one muted word when there are none — no control, no dropdown. Editing happens
  // on the configure page (SourcesConfigureRoms / SourcesConfigureHomebrewDir), reached by
  // the "Configure" cap the artboards put at the right end of this same row.
  //
  // THE STATUS TAGS ARE LABELS, NOT CONTROLS. No artboard makes them clickable, so they are
  // inert spans. Repair lives on the configure page instead: its "Folder" row's "Choose…" IS
  // re-pointing a `missing` row, and opening the page from a `needs-permission` card re-asks
  // for permission first (a click is the user gesture that makes `grant()` legal).
  //
  // SHARED/DEDICATED is drawn on the HOMEBREW board only, and only where the model can state
  // it without hedging: no associations at all -> Shared, exactly one -> Dedicated. A folder
  // naming several targets is neither, and the artboard's middle card carries no tag for
  // exactly that reason. The homebrew board also words the empty "Used by" value differently
  // from the ROMs board ("Nothing yet" vs "Any"); both words come off the canvas.
  import { locale } from "../i18n/locale.svelte.js";
  import { coreOptions, homebrewOptions } from "./UsedBySelect.svelte";
  import { targetOf } from "../sources/types.js";
  import {
    localFolders,
    displayName,
    OFW_BACKUP_FOLDER_NAME,
    OFW_BACKUP_USED_BY_KEY,
    type LocalFolderRow,
  } from "../sources/localFolders.svelte.js";
  import { nativeFolderPickerSupported, pickFolder } from "../romScan.js";

  let {
    selectedId = $bindable(null),
    onConfigure,
  }: {
    /** The card the footer bar's Remove acts on. Null when nothing is selected. */
    selectedId: string | null;
    /** Open the configure page for one folder. */
    onConfigure: (id: string) => void;
  } = $props();

  const t = $derived(locale.t.sources);

  const rows = $derived(localFolders.folders);

  /** Key -> label for every association a card might name. Manifest text, rendered as text. */
  const labels = $derived.by(() => {
    const map = new Map<string, string>();
    map.set(OFW_BACKUP_USED_BY_KEY, t.folders.ofwBackupUsedBy);
    for (const o of [...coreOptions(), ...homebrewOptions()]) map.set(o.key, o.label);
    return map;
  });

  /** Target key -> the systems it declares, for a key persisted before systems were listed. */
  const byTarget = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const o of coreOptions()) {
      const t = targetOf(o.key);
      if (t === o.key) continue;
      map.set(t, [...(map.get(t) ?? []), o.label]);
    }
    return new Map([...map].map(([k, v]) => [k, v.join(", ")]));
  });

  /**
   * The chips for one card: the label we know, else the raw key rather than a silent gap.
   *
   * A key persisted before the menu listed systems names a whole target, so it has no option of
   * its own; it is drawn as the systems that target declares, which is what it means. Falling
   * through to the raw key is still the last resort for a source that is gone or unresolved.
   */
  function chipsOf(f: LocalFolderRow): string[] {
    // Older backup rows were persisted as a shared folder with the reserved name instead of
    // carrying the association. Recover that meaning at render time so the source of truth is
    // still the directory row and the internal key never turns into "Any" in the UI.
    if (f.usedBy.length === 0 && (f.name === OFW_BACKUP_USED_BY_KEY || f.folderName === OFW_BACKUP_FOLDER_NAME)) {
      return [labels.get(OFW_BACKUP_USED_BY_KEY) ?? "OFW Backup"];
    }
    return f.usedBy.map((k) => labels.get(k) ?? byTarget.get(k) ?? k);
  }

  function folderPath(f: LocalFolderRow): string {
    return f.folderName === OFW_BACKUP_FOLDER_NAME ? "OFW Backup" : f.folderName;
  }

  /** Configure. A `needs-permission` row re-asks first — this click is the user gesture. */
  async function configure(f: LocalFolderRow): Promise<void> {
    if (f.status === "needs-permission") {
      try {
        await localFolders.grant(f.id);
      } catch {
        /* the prompt threw or was refused; the page still opens and can re-point */
      }
    }
    onConfigure(f.id);
  }

  async function chooseAgain(f: LocalFolderRow): Promise<void> {
    if (f.status !== "needs-permission") return;
    if (await localFolders.grant(f.id)) return;
    const picked = await pickFolder(`gnw-local-directory-${f.id}`);
    if (picked) await localFolders.repoint(f.id, picked);
  }

  /**
   * Shared / Dedicated / nothing. The homebrew artboard drew this tag and the ROMs one drew
   * none; with one merged list there is one treatment, and this is the axis the merge keeps
   * ("either it's shared or dedicated, that's all that matters"). Naming several targets is
   * neither, and stays untagged as that artboard has it.
   */
  function tagOf(f: LocalFolderRow): "shared" | "dedicated" | null {
    if (f.usedBy.length === 0 && (f.name === OFW_BACKUP_USED_BY_KEY || f.folderName === OFW_BACKUP_FOLDER_NAME)) {
      return "dedicated";
    }
    if (f.usedBy.length === 0) return "shared";
    // Counted by TARGET, not by key: a folder marked Game Boy and Game Boy Color is dedicated
    // to one core, and it read as "dedicated" before the menu split a core into its systems.
    return new Set(f.usedBy.map(targetOf)).size === 1 ? "dedicated" : null;
  }
</script>

<div class="cards">
  {#each rows as f (f.id)}
    {@const tag = tagOf(f)}
    {@const chips = chipsOf(f)}
    <div
      class="card"
      class:sel={selectedId === f.id}
      role="button"
      tabindex="0"
      onclick={() => (selectedId = selectedId === f.id ? null : f.id)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectedId = selectedId === f.id ? null : f.id;
        }
      }}
    >
      <div class="head">
        <span class="name">{displayName(f)}</span>
        {#if tag}
          <span class="tag" class:shared={tag === "shared"}
            >{tag === "shared" ? t.folders.shared : t.folders.dedicated}</span
          >
        {/if}
        {#if f.status !== "ready"}
          <span class="tag warn"
            >{f.status === "missing" ? t.folders.missing : t.folders.needsPermission}</span
          >
        {/if}
      </div>
      <span class="path">{folderPath(f)}</span>
      <div class="used">
        <span class="usedlabel">{t.folders.usedBy}</span>
        {#if chips.length === 0}
          <span class="usedany"
            >{t.folders.any}</span
          >
        {:else}
          <div class="chips">
            {#each chips as c, i (i)}<span class="chip">{c}</span>{/each}
          </div>
        {/if}
        <!-- Stops the card's own click: configuring a folder is not selecting the card. -->
        <button
          class="configure"
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            void configure(f);
          }}>{t.configure}</button
        >
        {#if f.status === "needs-permission" && !nativeFolderPickerSupported()}
          <button
            class="configure"
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              void chooseAgain(f);
            }}>{t.folders.chooseAgain}</button
          >
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  /* Artboard: a 14px-gapped column of white cards on the grey ground. */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: start;
    cursor: pointer;
  }
  /* The artboards' selected card: the border turns green, nothing else moves. */
  .card.sel {
    border-color: var(--zelda-green);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    font-size: var(--fs-lede);
    font-weight: 600;
  }
  .tag {
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
  /* Only "Shared" is tinted green; "Dedicated" stays the neutral grey chip. */
  .tag.shared {
    color: var(--zelda-green);
    background: var(--tint-success);
  }
  .tag.warn {
    color: var(--danger);
    background: none;
    padding-inline-start: 0;
  }
  .path {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    font-family: var(--font-mono, ui-monospace, Menlo, monospace);
    overflow-wrap: anywhere;
  }
  /* Artboard: label, value, then Configure pushed to the card's right edge. */
  .used {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 8px;
  }
  /* Artboard: a fixed 62px label gutter, so every card's values line up in one column. */
  .usedlabel {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    width: 62px;
    flex-shrink: 0;
  }
  /* The empty case is one muted word, sitting where the chips would. */
  .usedany {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    margin-inline-end: auto;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-inline-end: auto;
    min-width: 0;
  }
  .chip {
    font-size: var(--fs-micro);
    font-weight: 500;
    color: var(--ink);
    background: var(--surface-sunk);
    border-radius: 3px;
    padding: 3px 9px;
    white-space: nowrap;
  }
  /* The artboard's Configure cap: a small outlined button, never a full-width control. */
  .configure {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 5px 14px;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
  }
</style>
