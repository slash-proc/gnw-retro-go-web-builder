<script lang="ts">
  /**
   * Guided Setup's "Add Sources" step, as a modal (ModalSources / ModalSourcesEmpty artboards).
   *
   * A deliberately minimal second face on the Sources tab: paste a repo URL or import a bundle
   * zip, see what is already added, and get out. It owns NO source logic — resolution,
   * validation and hashing all belong to `sources/store.svelte.ts` (`add`, `importBundleFile`),
   * which is the same pair the Sources tab calls.
   *
   * The list is grouped by kind and each core row names the systems it emulates, composed
   * exactly as `sources/metaLine.ts`'s `systemsSegment()` composes it (longName, joined
   * with ", "); a homebrew row has no systems and carries nothing there. There are
   * deliberately NO counts of anything.
   *
   * Every value from a manifest (title, repo slug, console names) is untrusted third-party
   * text and is interpolated as text — never {@html}, never a path.
   */
  import { locale } from "../i18n/locale.svelte.js";
  import { sources, sourceDisplayName, type SourceRow } from "../sources/store.svelte.js";
  import { isCoreKind } from "../sources/types.js";
  import { SourceError } from "../sources/types.js";
  import { parseRawCore, rawCoreSource } from "../sources/rawCore.js";
  import ModalShell from "./ModalShell.svelte";
  import Button from "./Button.svelte";

  let {
    onClose,
    onAllSources,
  }: {
    /** Dismiss the modal (footer button, Escape, backdrop click). */
    onClose: () => void;
    /** The way out: leave the wizard for the full Sources tab. */
    onAllSources?: () => void;
  } = $props();

  const t = $derived(locale.t.sources);
  const ts = $derived(locale.t.shared.common);

  let mode = $state<"url" | "bundle" | "raw">("url");
  let urlInput = $state("");
  let rawPending = $state<Awaited<ReturnType<typeof rawCoreSource>> | null>(null);

  sources.load();

  /** The same SourceError → copy mapping the Sources tab uses. No new error wording. */
  function errorText(code: SourceRow["errorCode"], detail: string | undefined): string {
    switch (code) {
      case "bad-url":
        return t.errBadUrl;
      case "no-pages":
        return t.errNoPages;
      case "no-versions":
        return t.errNoVersions;
      case "malformed":
        return t.errMalformed;
      case "unsupported-schema":
        return t.errUnsupportedSchema(detail ?? "?");
      case "bundle-invalid":
        return t.errBundleInvalid;
      case "bundle-missing-file":
        return t.errBundleMissingFile;
      case "bundle-conflict":
        return t.errBundleConflict;
      case "raw-core-invalid":
        return t.errMalformed;
      case "artifact-size-mismatch":
        return t.errMalformed;
      default:
        return t.errNetwork;
    }
  }

  /** What a core source gives you: the systems it emulates. Homebrew has none. */
  function systemsOf(row: SourceRow): string {
    const card = row.card;
    if (card === undefined || !isCoreKind(card.kind)) return "";
    return card.systems.map((s) => s.longName).join(", ");
  }

  async function submitUrl(e: SubmitEvent) {
    e.preventDefault();
    if (!urlInput.trim() || sources.adding) return;
    if (await sources.add(urlInput)) urlInput = "";
  }

  /**
   * Read the picked zip and hand the bytes to the store, clearing the input so re-picking the
   * same file after a failure still fires `change` (same reasoning as the Sources tab).
   */
  async function pickBundle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || sources.adding) return;
    const data = new Uint8Array(await file.arrayBuffer());
    input.value = "";
    await sources.importBundleFile(data);
  }

  async function pickRaw(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || sources.adding) return;
    const data = new Uint8Array(await file.arrayBuffer());
    input.value = "";
    try {
      rawPending?.release();
      rawPending = await rawCoreSource(parseRawCore(data, file.name));
    } catch (err) {
      const e2 = err instanceof SourceError ? err : new SourceError("raw-core-invalid");
      sources.addError = { code: e2.code, detail: e2.detail };
    }
  }
</script>

<ModalShell onDismiss={onClose} maxWidth="32.5rem">
  <div class="wrap">
    <h3>{locale.t.wizard.spine.sourcesButtonLabel}</h3>

    <div class="modes">
      <button type="button" class="mode" class:on={mode === "url"} onclick={() => (mode = "url")}
        >{t.modeUrl}</button
      >
      <button
        type="button"
        class="mode"
        class:on={mode === "bundle"}
        onclick={() => (mode = "bundle")}>{t.modeBundle}</button
      >
      <button type="button" class="mode" class:on={mode === "raw"} onclick={() => (mode = "raw")}>Raw binary</button>
    </div>

    {#if mode === "url"}
      <form class="urlform" onsubmit={submitUrl}>
        <input
          type="text"
          bind:value={urlInput}
          placeholder={t.urlPlaceholder}
          aria-label={t.urlLabel}
          disabled={sources.adding}
        />
        <Button variant="action" type="submit" disabled={sources.adding || !urlInput.trim()}>
          {sources.adding ? t.adding : t.add}
        </Button>
      </form>
    {:else if mode === "bundle"}
      <label class="field">
        <span class="label">{t.bundleLabel}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          onchange={pickBundle}
          disabled={sources.adding}
        />
      </label>
      {#if sources.adding}<p class="hint">{t.importing}</p>{/if}
    {:else}
      <label class="field">
        <span class="label">CORE binary</span>
        <input type="file" accept=".core,application/octet-stream" onchange={pickRaw} disabled={sources.adding} />
      </label>
      {#if sources.adding}<p class="hint">Reading CORE binary…</p>{/if}
      {#if rawPending}
        <div class="rawsummary"><strong>{rawPending.resolved.manifest.title}</strong> ({rawPending.resolved.entry.tag}</div>
        <Button variant="action" onclick={() => { if (sources.addRawCore(rawPending!.resolved, rawPending!.release)) rawPending = null; }}>Add</Button>
      {/if}
    {/if}

    {#if sources.addError}
      <p class="err">{errorText(sources.addError.code, sources.addError.detail)}</p>
    {/if}

    {#if sources.rows.length === 0}
      <div class="empty"><span>{t.emptyColumn}</span></div>
    {:else}
      <div class="groups">
        {#each [{ key: "core", title: t.colCores }, { key: "homebrew", title: t.colHomebrew }] as group (group.key)}
          {@const rows =
            group.key === "core" ? sources.byKind.core : sources.byKind.homebrew}
          {#if rows.length > 0}
            <div class="group">
              <div class="grouptitle">{group.title}</div>
              <div class="list">
                {#each rows as row (row.repo)}
                  <div class="row">
                    <span class="repo">{sourceDisplayName(row)}</span>
                    {#if group.key === "core"}<span class="systems">{systemsOf(row)}</span>{/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="foot">
      {#if onAllSources}
        <button type="button" class="wayout" onclick={onAllSources}>{t.allSources}</button>
      {:else}
        <span></span>
      {/if}
      <Button variant="action" onclick={onClose}>{ts.close}</Button>
    </div>
  </div>
</ModalShell>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* Underlined words, not a segmented control: the active one takes a 2px green rule and
     nothing else does. */
  .modes {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .mode {
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 500;
    padding: 4px 0;
    background: none;
    border: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .mode.on {
    font-weight: 600;
    color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--zelda-green);
  }
  .mode:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }

  /* ModalSources.dc.html: the field/Add row is `gap: 12px`. */
  .urlform {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  /* ModalSources.dc.html: `height: 40px; padding: 0 12px`, mono 13px. The taller 44px /
     14px field is ReposAdd's, on the full page. */
  input[type="text"] {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-btn-sm);
    flex: 1;
    min-width: 0;
    height: 40px;
    box-sizing: border-box;
    padding: 0 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .label {
    font-size: var(--fs-label);
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* Centred band under a rule (ModalSourcesEmpty). */
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 26px 0;
    border-top: 1px solid var(--rule);
    font-size: var(--fs-btn-sm);
    color: var(--ink-dim);
  }
  .hint,
  .err {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .err {
    color: var(--danger);
  }

  /* The artboard shows five rows and no scroller, because five is all it draws. The list is
     unbounded at runtime (one row per group per added source), and the modal has a fixed
     footer below it, so the cap stays: without it a long list pushes Add and Close off
     screen. Kept deliberately, not an oversight. */
  .groups {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-height: 40vh;
    overflow-y: auto;
  }
  .grouptitle {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
    /* The board's group is a column with `gap: 6px` between caption and list. */
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 9px 0;
  }
  .row + .row {
    border-top: 1px solid var(--rule);
  }
  .repo {
    font-family: var(--font-mono);
    font-size: var(--fs-caption);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .systems {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    text-align: end;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    /* The board splits this as `padding-top: 4px` on the ruled box plus `padding-top: 16px`
       on each side's content, and lifts the rule 2px off the list above it. */
    margin-top: 2px;
    padding-top: 20px;
    border-top: 1px solid var(--rule);
  }
  .wayout {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .wayout:hover {
    color: var(--ink);
  }
</style>
