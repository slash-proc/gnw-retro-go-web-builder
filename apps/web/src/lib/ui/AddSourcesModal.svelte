<script lang="ts">
  /**
   * Guided Setup's "Add Sources" step, as a modal (ModalSources / ModalSourcesEmpty artboards).
   *
   * A deliberately minimal second face on the Sources tab: paste a repo URL or import a bundle
   * zip, see what is already added, and get out. It owns NO source logic — resolution,
   * validation and hashing all belong to `sources/store.svelte.ts` (`add`, `importBundleFile`),
   * which is the same pair the Sources tab calls.
   *
   * The list is grouped by kind. Core systems and their extensions are separate, related
   * fields, so the list renders one small system group per declaration; homebrew has no
   * systems. There are deliberately NO counts of anything.
   *
   * Every value from a manifest (title, repo slug, console names) is untrusted third-party
   * text and is interpolated as text — never {@html}, never a path.
   */
  import { onDestroy } from "svelte";
  import { importBundle, type BundleImport } from "../sources/bundle.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { sources, sourceDisplayName, type SourceRow } from "../sources/store.svelte.js";
  import { curatedRepoFor } from "../sources/store.svelte.js";
  import { firmwareRepositories, shortRepoLabels } from "../firmwareDist/repositories.svelte.js";
  import type { CuratedProject } from "../firmwareDist/types.js";
  import { isCoreKind } from "../sources/types.js";
  import { systemsData } from "../sources/sourceDetails.js";
  import SourceSystems from "./SourceSystems.svelte";
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

  let bundlePending = $state<{ data: Uint8Array; imported: BundleImport } | null>(null);
  let readingBundle = $state(false);
  onDestroy(() => bundlePending?.imported.release());

  sources.load();
  firmwareRepositories.load();

  const curatedOptions = $derived.by(() => {
    const byRepo = new Map<string, {
      repo: string;
      project: CuratedProject;
      providers: { repo: string; tag: string; project: CuratedProject }[];
    }>();
    for (const repository of firmwareRepositories.rows) {
      if (!repository.active || !repository.metadata || repository.status !== "ready") continue;
      for (const project of repository.metadata.projects) {
        const repo = curatedRepoFor(project);
        if (!repo) continue;
        const key = repo.toLowerCase();
        const existing = byRepo.get(key);
        if (existing) {
          if (!existing.providers.some((provider) =>
            provider.repo === repository.repo && provider.tag === repository.catalogTag && provider.project.project === project.project,
          )) {
            existing.providers.push({
              repo: repository.repo,
              tag: repository.catalogTag ?? repository.metadata.latestTag,
              project,
            });
          }
          continue;
        }
        byRepo.set(key, {
          repo,
          project,
          providers: [{ repo: repository.repo, tag: repository.catalogTag ?? repository.metadata.latestTag, project }],
        });
      }
    }
    return [...byRepo.values()];
  });
  const curatedLabels = $derived(shortRepoLabels(curatedOptions.map((item) => item.repo)));
  const availableCurated = $derived(curatedOptions.filter((item) => !sources.get(item.repo)));

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

  /** What a core source gives you: each system and its own accepted extensions. */
  function systemsOf(row: SourceRow) {
    return systemsData(row.card);
  }

  async function submitUrl(e: SubmitEvent) {
    e.preventDefault();
    if (!urlInput.trim() || sources.adding) return;
    if (await sources.add(urlInput)) urlInput = "";
  }

  async function toggleSource(row: SourceRow, event: Event): Promise<void> {
    sources.setActive(row.repo, (event.currentTarget as HTMLInputElement).checked);
  }

  async function toggleCurated(item: (typeof curatedOptions)[number], event: Event): Promise<void> {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    const existing = sources.get(item.repo);
    if (existing) {
      sources.setActive(item.repo, enabled);
      return;
    }
    if (!enabled) return;
    let added = false;
    for (const provider of item.providers) {
      const ok = await sources.addCuratedProject(provider.project, provider.repo, provider.tag);
      if (!ok) return;
      added = true;
    }
    if (added) sources.setActive(item.repo, true);
  }

  /**
   * Verify the picked zip for review, clearing the input so re-picking the
   * same file after a failure still fires `change` (same reasoning as the Sources tab).
   */
  async function pickBundle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || sources.adding || readingBundle) return;
    input.value = "";
    bundlePending?.imported.release();
    bundlePending = null;
    sources.addError = null;
    readingBundle = true;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      bundlePending = { data, imported: await importBundle(data) };
    } catch (err) {
      const error = err instanceof SourceError ? err : new SourceError("bundle-invalid");
      sources.addError = { code: error.code, detail: error.detail };
    } finally {
      readingBundle = false;
    }
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
          disabled={sources.adding || readingBundle}
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
          disabled={sources.adding || readingBundle}
        />
      </label>
      {#if sources.adding || readingBundle}<p class="hint">{t.importing}</p>{/if}
      {#if bundlePending}
        {@const resolved = bundlePending.imported.resolved}
        {@const previewSystems = systemsData({
          kind: resolved.entry.kind,
          systems: resolved.manifest.targets.flatMap((target) => target.systems ?? []).map((system) => ({
            id: system.id,
            longName: system.longName,
            extensions: system.extensions.flatMap((entry) => Array.isArray(entry) ? entry : [entry]),
          })),
        })}
        <div class="rawsummary">
          <div class="summarytitle">
            <strong>{resolved.manifest.title}</strong>
            <span class="version">{resolved.entry.tag}</span>
          </div>
          <div class="kind">{isCoreKind(resolved.entry.kind) ? t.colCores : t.colHomebrew}</div>
          <SourceSystems systems={previewSystems} density="comfortable" />
        </div>
        <Button variant="action" disabled={sources.adding || readingBundle} onclick={async () => {
          const pending = bundlePending!;
          bundlePending = null;
          await sources.importBundleFile(pending.data, pending.imported);
        }}>{t.add}</Button>
      {/if}
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

    {#if sources.rows.length === 0 && curatedOptions.length === 0}
      <div class="empty"><span>{t.emptyColumn}</span></div>
    {/if}
    {#if sources.rows.length > 0 || curatedOptions.length > 0}
      <div class="groups">
        {#each [{ key: "core", title: t.colCores }, { key: "homebrew", title: t.colHomebrew }] as group (group.key)}
          {@const rows =
            group.key === "core" ? sources.byKind.core : sources.byKind.homebrew}
          {#if rows.length > 0}
            <div class="group">
              <div class="grouptitle">{group.title}</div>
              <div class="list">
                {#each rows as row (row.repo)}
                  {@const systems = group.key === "core" ? systemsOf(row) : []}
                  <div class="row">
                    <div class="sourceidentity">
                      <strong>{row.card?.title ?? row.repo}</strong>
                      <span class="repo">{sourceDisplayName(row)}</span>
                      {#if row.curatedFrom?.length}
                        <span class="provenance">
                          {#each row.curatedFrom as provider, i (`${provider.firmwareRepo}:${provider.firmwareTag}:${provider.project}:${i}`)}
                            <span class="provenance-item">
                              <span class="provenance-repo">{provider.firmwareRepo}</span>
                              <span class="provenance-tag">{provider.firmwareTag}</span>
                            </span>
                          {/each}
                        </span>
                      {/if}
                    </div>
                    <SourceSystems systems={systems} />
                    {#if row.origin === "url" && (row.card?.versions?.length ?? 0) > 1}
                      <select
                        class="source-version"
                        aria-label={`${t.detail.version}: ${row.card?.title ?? row.repo}`}
                        value={row.card?.tag ?? ""}
                        disabled={row.status === "loading"}
                        onchange={(event) => void sources.selectVersion(row.repo, event.currentTarget.value)}
                      >
                        {#each row.card?.versions ?? [] as version (version.tag)}
                          <option value={version.tag}>{version.tag}{version.prerelease ? ` (${t.prerelease})` : ""}</option>
                        {/each}
                      </select>
                    {/if}
                    <label class="source-toggle">
                      <input type="checkbox" checked={row.active} aria-label={`${row.active ? t.deactivate : t.activate}: ${row.card?.title ?? row.repo}`} onchange={(event) => toggleSource(row, event)} />
                      <span>{row.active ? t.active : t.inactive}</span>
                    </label>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
        {#if availableCurated.length > 0}
          <div class="group">
            <div class="grouptitle">{t.retroGoReleases}</div>
            <div class="list">
              {#each availableCurated as item (item.repo.toLowerCase())}
                <div class="row curated-row">
                  <div class="sourceidentity">
                    <strong>{item.project.title}</strong>
                    <span class="repo">{curatedLabels.get(item.repo) ?? item.repo}</span>
                    <span class="provenance">
                      {#each item.providers as provider, i (`${provider.repo}:${provider.tag}:${i}`)}
                        <span class="provenance-item">
                          <span class="provenance-repo">{provider.repo}</span>
                          <span class="provenance-tag">{provider.tag}</span>
                        </span>
                      {/each}
                    </span>
                  </div>
                  <span class="kind">{item.project.kind === "core" ? t.colCores : t.colHomebrew}</span>
                  <label class="source-toggle">
                    <input type="checkbox" checked={false} aria-label={`${t.add}: ${item.project.title}`} disabled={sources.adding} onchange={(event) => void toggleCurated(item, event)} />
                    <span>{t.add}</span>
                  </label>
                </div>
              {/each}
            </div>
          </div>
        {/if}
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
    display: grid;
    grid-template-columns: minmax(130px, 0.8fr) minmax(0, 1.2fr);
    align-items: center;
    gap: 10px 18px;
    padding: 10px 0;
  }
  .row + .row {
    border-top: 1px solid var(--rule);
  }
  .repo {
    font-family: var(--font-mono);
    min-width: 0;
    overflow: hidden;
    color: var(--ink-soft);
    font-size: var(--fs-chip);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sourceidentity { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .summarytitle {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
  }
  .version {
    padding: 2px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 6%, var(--surface));
    color: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: var(--fs-chip);
  }
  .kind {
    color: var(--ink-soft);
    font-size: var(--fs-chip);
    text-transform: uppercase;
    letter-spacing: var(--label-track);
  }
  .row { grid-template-columns: minmax(120px, .9fr) minmax(0, 1fr) auto; }
  .source-toggle { display: flex; align-items: center; gap: 5px; flex: none; color: var(--ink-soft); font-size: var(--fs-chip); cursor: pointer; }
  .source-toggle input { accent-color: var(--zelda-green); }
  .source-version { max-width: 150px; height: 32px; padding-inline: 7px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--surface); color: var(--ink); font: inherit; font-size: var(--fs-chip); }
  .provenance { display: flex; flex-wrap: wrap; gap: 4px; color: var(--ink-dim); font-size: 10px; }
  .provenance-item { display: inline-flex; min-width: 0; align-items: center; gap: 6px; }
  .provenance-repo { overflow: hidden; max-width: 100%; font-family: var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .provenance-tag { flex: none; padding: 1px 5px; border: 1px solid var(--hairline); border-radius: 999px; font-family: var(--font-mono); }
  .curated-row .kind { text-transform: none; letter-spacing: 0; }
  @media (max-width: 560px) {
    .row { grid-template-columns: minmax(0, 1fr); gap: 7px; }
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
