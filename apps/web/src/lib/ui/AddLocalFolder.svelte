<script lang="ts">
  // --- ADD / CONFIGURE A LOCAL FOLDER page ------------------------------------------------
  // (SourcesAddRoms / SourcesAddHomebrewDir, and SourcesConfigureRoms /
  //  SourcesConfigureHomebrewDir — deliberately ONE page, drawn twice.)
  //
  // Replaces the list pane, the same way ui/AddSource.svelte replaces the remote list: three
  // rows (Name / Folder / Used by) and nothing else. The confirming action lives in the
  // page's ONE footer bar (views/Sources.svelte), so this component exports `submit()` and
  // reports `canAdd` upward — the same contract AddSource.svelte already uses.
  //
  // The artboard states no hint, no error line and no empty-state caption, so this page
  // carries none: an absent caption is correct.
  //
  // ADD vs CONFIGURE is `editId`. The four artboards draw the same three rows, the same
  // footer pair, and differ only in the title and the primary's word — so this is one
  // component with a pre-filled mode, not a second page. In configure mode the fields start
  // from the folder being configured, and "Choose..." RE-POINTS it (keeping id, label and
  // associations) rather than registering a new row.
  //
  // NAME is optional in the model (`displayName()` falls back to the directory's own name),
  // so it is never a gate. The only gate is having a directory at all.
  import { untrack } from "svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { localFolders } from "../sources/localFolders.svelte.js";
  import { pickFolder } from "../romScan.js";
  import UsedBySelect from "./UsedBySelect.svelte";

  let {
    canAdd = $bindable(false),
    editId = null,
    onDone,
  }: {
    /** Bound upward so the footer bar's primary can disable itself. */
    canAdd: boolean;
    /** The folder being configured, or null for the add page. */
    editId: string | null;
    /** Called after a successful add/save, and by Cancel; the caller returns to the list. */
    onDone: () => void;
  } = $props();

  const t = $derived(locale.t.sources);

  // Read once, at construction: the caller mounts a fresh page per open, so there is no
  // stale-prop case to re-sync, and re-reading would fight the user's own edits.
  const editing = untrack(() => (editId === null ? null : localFolders.get(editId)));

  /** In configure mode this starts as the row's live handle; "Choose..." replaces it. */
  let handle = $state<unknown | null>(editing?.handle ?? null);
  /** True once the user picked a NEW directory — the only case that re-points the row. */
  let repointed = $state(false);
  let folderName = $state(editing?.folderName ?? "");
  let name = $state(editing?.name ?? "");
  let usedBy = $state<string[]>([...(editing?.usedBy ?? [])]);
  let busy = $state(false);

  $effect(() => {
    // Configure always has a folder (the row exists), so only the add page gates on one.
    canAdd = (editing !== null || handle !== null) && !busy;
  });

  async function choose(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await pickFolder("gnw-local-directory");
      // Null is the user cancelling the picker — not an error, and nothing to report.
      if (picked) {
        handle = picked;
        repointed = true;
        const n = (picked as { name?: unknown }).name;
        folderName = typeof n === "string" ? n : "";
      }
    } catch {
      /* the picker threw (no permission, no API); nothing is chosen and the page stands */
    } finally {
      busy = false;
    }
  }

  export async function submit(): Promise<void> {
    if (busy) return;
    if (editing) {
      busy = true;
      try {
        if (repointed && handle) await localFolders.repoint(editing.id, handle);
        localFolders.rename(editing.id, name.trim());
        localFolders.setUsedBy(editing.id, usedBy);
        onDone();
      } finally {
        busy = false;
      }
      return;
    }
    if (!handle) return;
    busy = true;
    try {
      await localFolders.add({ handle, name: name.trim(), usedBy });
      onDone();
    } finally {
      busy = false;
    }
  }
</script>

<div class="form">
  <div class="row">
    <label class="flabel" for="lf-name">{t.folders.fieldName}</label>
    <input
      class="field input"
      id="lf-name"
      type="text"
      placeholder={t.folders.nameOptional}
      bind:value={name}
    />
  </div>

  <div class="row">
    <span class="flabel" id="lf-folder">{t.folders.fieldFolder}</span>
    <div class="field folderrow">
      <span class="fvalue" class:empty={!folderName}
        >{folderName || t.folders.noFolderChosen}</span
      >
      <button class="choose" type="button" disabled={busy} onclick={() => void choose()}
        >{t.folders.choose}</button
      >
    </div>
  </div>

  <div class="row">
    <span class="flabel">{t.folders.usedBy}</span>
    <UsedBySelect bind:value={usedBy} onchange={undefined} />
  </div>
</div>

<style>
  /* Artboard: a 32px-gapped column of label-over-field rows, 9px between the two. */
  .form {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .flabel {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  .field {
    height: 40px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 2px;
    box-sizing: border-box;
  }
  .folderrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    /* Inline: the wider side is the label's, the narrower the trailing control's. */
    padding-block: 0;
    padding-inline: 12px 6px;
  }
  .fvalue {
    font-size: var(--fs-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* "No folder chosen" is the field's placeholder, so it takes the muted ink. */
  .fvalue.empty {
    color: var(--ink-soft);
  }
  /* The artboard's Choose control is a small outlined cap inside the field's right edge. */
  .choose {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .choose:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .input::placeholder {
    color: var(--ink-soft);
    opacity: 1;
  }
  .input {
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink);
    padding: 0 12px;
    width: 100%;
  }
</style>
