<script lang="ts">
  import { locale } from "../i18n/locale.svelte.js";
  import { firmwareRepositories, shortRepoLabels } from "../firmwareDist/repositories.svelte.js";
  import { curatedRepoFor, sources } from "../sources/store.svelte.js";
  import Button from "./Button.svelte";

  const t = $derived(locale.t.sources);
  let {
    addPage = false,
    canAdd = $bindable(false),
    configuring = $bindable(false),
    inspectedRepo = $bindable(firmwareRepositories.defaultRepo),
    onDone = () => {},
  }: {
    addPage?: boolean;
    canAdd?: boolean;
    configuring?: boolean;
    inspectedRepo?: string;
    onDone?: () => void;
  } = $props();
  let repoInput = $state("");
  firmwareRepositories.load();
  sources.load();

  $effect(() => {
    if (!firmwareRepositories.rows.some((row) => row.repo === inspectedRepo)) {
      inspectedRepo = firmwareRepositories.defaultRepo || firmwareRepositories.rows[0]?.repo || "";
    }
  });

  const repositoryLabels = $derived(shortRepoLabels(firmwareRepositories.rows.map((row) => row.repo)));
  const selected = $derived(firmwareRepositories.rows.find((row) => row.repo === inspectedRepo));
  const projects = $derived(selected?.metadata?.projects ?? []);
  const projectLabels = $derived(
    shortRepoLabels(
      projects.flatMap((project) => {
        const repo = curatedRepoFor(project);
        return repo ? [repo] : [];
      }),
    ),
  );

  $effect(() => {
    canAdd = !!repoInput.trim() && !firmwareRepositories.adding;
  });

  async function submit(): Promise<void> {
    if (firmwareRepositories.adding || !repoInput.trim()) return;
    if (await firmwareRepositories.add(repoInput)) {
      repoInput = "";
      onDone();
    }
  }

  function addRepo(e: SubmitEvent): void {
    e.preventDefault();
    void submit();
  }

  export { submit };

  function selectCatalogVersion(e: Event): void {
    const tag = (e.currentTarget as HTMLSelectElement).value;
    if (selected && tag) void firmwareRepositories.selectVersion(selected.repo, tag);
  }

  async function addProject(project: (typeof projects)[number]): Promise<void> {
    if (!selected?.catalogTag) return;
    await sources.addCuratedProject(project, selected.repo, selected.catalogTag);
  }

</script>

{#if addPage}
  <form class="repo-add-page" onsubmit={addRepo}>
    <label for="retro-go-repository">{t.retroGoReleases}</label>
    <input
      id="retro-go-repository"
      aria-label={t.retroGoReleases}
      placeholder={t.retroGoRepoPlaceholder}
      bind:value={repoInput}
      disabled={firmwareRepositories.adding}
    />
    <p class="repo-add-hint">{t.retroGoReposHint}</p>
  </form>
{:else if configuring && selected}
  <div class="remote-source-detail">
  <header class="dhead remote-source-detail-head">
    <div class="dident">
      <h2 class="dtitle remote-source-detail-title">{selected.metadata?.title ?? repositoryLabels.get(selected.repo) ?? selected.repo}</h2>
      <div class="dmeta">
        <span class="repo detail-repo">{selected.repo}</span>
        <span class="kind">{t.retroGoReleases}</span>
      </div>
    </div>
    <button type="button" class="back remote-source-detail-back" onclick={() => (configuring = false)}>&#8592; {t.backToSources}</button>
  </header>

  <div class="detail">
    {#if selected.status === "loading" && !selected.metadata}
      <p class="empty">{t.loading}</p>
    {:else if selected.status === "error" && !selected.metadata}
      <div class="error-state">
        <p>{t.retroGoRepoFailed}</p>
        <button type="button" class="retry" onclick={() => void firmwareRepositories.refresh(selected.repo)}>{t.retry}</button>
      </div>
    {:else if selected.metadata}
      <div class="section remote-source-section">
        <div class="cap remote-source-cap">{t.release.heading}</div>
        <div class="panel metadata remote-source-panel">
          <div class="meta-line"><span>{t.retroGoReleases}</span><code>{selected.metadata.repo}</code></div>
          <div class="meta-line"><span>{t.detail.version}</span>
            <select
              aria-label={t.detail.version}
              value={selected.catalogTag ?? selected.metadata.latestTag}
              disabled={selected.status === "loading"}
              onchange={selectCatalogVersion}
            >
              {#each selected.metadata.versions as version (version.tag)}
                <option value={version.tag}>{version.tag}{version.prerelease ? ` (${t.prerelease})` : ""}</option>
              {/each}
            </select>
          </div>
          <div class="meta-line"><span>{t.release.heading}</span><a href={selected.metadata.releasesUrl} target="_blank" rel="noreferrer">{selected.metadata.releasesUrl}</a></div>
          <div class="meta-line"><span>{t.retroGoRepoVersions(selected.metadata.retained)}</span><span>{t.retroGoRepoVersions(selected.versions)}</span></div>
          {#if selected.metadata.docs}
            <div class="meta-line"><span>{t.configure}</span><a href={selected.metadata.docs} target="_blank" rel="noreferrer">{selected.metadata.docs}</a></div>
          {/if}
          <div class="meta-line">
            <span>{t.retroGoDefault}</span>
            {#if firmwareRepositories.defaultRepo === selected.repo}
              <span class="default-source-status">{t.retroGoDefault}</span>
            {:else}
              <Button
                variant="default"
                disabled={!selected.active}
                onclick={() => firmwareRepositories.setDefault(selected.repo)}
              >{t.setRetroGoDefault}</Button>
            {/if}
          </div>
        </div>
      </div>

      {#each [{ kind: "core", title: t.colCores }, { kind: "homebrew", title: t.colHomebrew }] as group (group.kind)}
        {@const groupProjects = projects.filter((project) => project.kind === group.kind)}
        <div class="section remote-source-section">
          <div class="cap remote-source-cap">{group.title}</div>
          <div class="panel project-list remote-source-panel">
            {#if groupProjects.length === 0}
              <p class="empty">{t.emptyColumn}</p>
            {:else}
              {#each groupProjects as project, i (`${project.project}:${i}`)}
                {@const projectRepo = curatedRepoFor(project)}
                {@const existing = projectRepo ? sources.get(projectRepo) : undefined}
                <div class="project-row">
                  <div class="project-identity">
                    <strong>{project.title}</strong>
                    <code title={projectRepo ?? project.versionsUrl}>{projectRepo ? projectLabels.get(projectRepo) ?? projectRepo : project.versionsUrl}</code>
                  </div>
                  {#if existing}
                    <label class="active-state">
                      <input
                        type="checkbox"
                        checked={existing.active}
                        aria-label={`${existing.active ? t.deactivate : t.activate}: ${project.title}`}
                        onchange={(event) => projectRepo && sources.setActive(projectRepo, event.currentTarget.checked)}
                      />
                      <span>{existing.active ? t.active : t.inactive}</span>
                    </label>
                  {:else}
                    <button
                      type="button"
                      class="add-project"
                      aria-label={`${t.add}: ${project.title}`}
                      title={t.add}
                      disabled={!projectRepo || sources.adding}
                      onclick={() => void addProject(project)}
                    >+</button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/each}
      <div class="detail-actions">
        <Button
          variant="destructive"
          onclick={() => {
            configuring = false;
            firmwareRepositories.remove(selected.repo);
          }}>{t.remove}</Button
        >
      </div>
    {/if}
  </div>
  </div>
{:else}
  <div class="listregion">
    <div class="list">
      {#if firmwareRepositories.rows.length === 0}
        <p class="empty">{t.emptyColumn}</p>
      {:else}
        {#each firmwareRepositories.rows as row (row.repo)}
          <div class="row remote-source-row remote-source-card" class:sel={inspectedRepo === row.repo}
            data-selected={inspectedRepo === row.repo}
            data-state={row.status === "error" ? "error" : "ready"}>
            <button
              type="button"
              class="rowpick remote-source-rowpick"
              aria-pressed={inspectedRepo === row.repo}
              onclick={() => (inspectedRepo = row.repo)}
              ondblclick={() => {
                inspectedRepo = row.repo;
                configuring = true;
              }}
            >
              <span class="main remote-source-main">
                <span class="identity remote-source-identity">
                  <span class="name remote-source-name">{row.metadata?.title ?? repositoryLabels.get(row.repo) ?? row.repo}</span>
                  <span class="repo remote-source-repo" title={row.repo}>{repositoryLabels.get(row.repo) ?? row.repo}</span>
                </span>
                <span class="facts remote-source-facts">
                  <span class="fact remote-source-fact">{t.retroGoRepoVersions(row.versions)}</span>
                  {#if row.metadata?.latestTag}<span class="fact remote-source-fact">{row.metadata.latestTag}</span>{/if}
                  {#if row.status === "error"}<span class="fact remote-source-fact alert">{t.retroGoRepoFailed}</span>{/if}
                </span>
              </span>
              <span class="side remote-source-side">
                {#if row.status === "loading"}<span class="version remote-source-version">{t.loading}</span>{/if}
                <span class="version remote-source-version">{row.catalogTag ?? row.metadata?.latestTag ?? "—"}</span>
              </span>
            </button>
            <button
              type="button"
              class="pill remote-source-state"
              class:on={row.active}
              aria-label={`${row.active ? t.deactivate : t.activate}: ${row.metadata?.title ?? row.repo}`}
              aria-pressed={row.active}
              onclick={() => firmwareRepositories.setActive(row.repo, !row.active)}
            >{row.active ? t.active : t.inactive}</button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

{/if}

{#if firmwareRepositories.error}
  <p class="error">
    {firmwareRepositories.error === "invalid"
      ? t.retroGoRepoInvalid
      : firmwareRepositories.error === "duplicate"
        ? t.retroGoRepoDuplicate
        : t.retroGoRepoFailed}
  </p>
{/if}
{#if sources.addError}
  <p class="error">{sources.addError.code === "bad-url" ? t.errBadUrl : t.errNetwork}</p>
{/if}

<style>
  .listregion { display: flex; min-height: 0; flex: 1; flex-direction: column; }
  .list { display: grid; gap: 10px; }
  .empty { margin: 0; color: var(--ink-soft); font-size: var(--fs-caption); }
  code { overflow: hidden; min-width: 0; color: var(--ink-soft); font-family: var(--font-mono); font-size: var(--fs-chip); text-overflow: ellipsis; white-space: nowrap; }
  .back:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--zelda-green); outline-offset: 3px; border-radius: var(--r-control); }
  .detail-repo { color: var(--ink-soft); font-family: var(--font-mono); font-size: var(--fs-chip); }
  .repo-add-page { display: flex; max-width: 680px; flex-direction: column; gap: 9px; margin: 0; padding: 0; }
  .repo-add-page label { color: var(--ink); font-size: var(--fs-btn-sm); font-weight: 600; }
  .repo-add-page input { width: 100%; height: 42px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--surface); color: inherit; font: inherit; box-sizing: border-box; }
  .repo-add-hint { margin: 0; color: var(--ink-soft); font-size: var(--fs-caption); }
  .detail { display: flex; flex-direction: column; gap: 0; padding: 0 0 8px; }
  .section { display: flex; flex-direction: column; gap: 12px; }
  .panel { overflow: hidden; }
  .metadata { display: grid; gap: 0; padding: 2px 14px; }
  .meta-line { display: grid; grid-template-columns: minmax(120px, .4fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rule); color: var(--ink-soft); font-size: var(--fs-caption); }
  .meta-line:last-child { border-bottom: 0; }
  .meta-line code, .meta-line a { color: var(--ink); }
  .meta-line a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { max-width: 100%; height: 34px; padding: 0 8px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--surface); color: var(--ink); font: inherit; }
  .project-list { padding: 2px 14px; }
  .project-row { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 10px 0; }
  .project-row + .project-row { border-top: 1px solid var(--rule); }
  .project-identity { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
  .project-identity strong { overflow: hidden; color: var(--ink); font-size: var(--fs-btn-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .active-state { display: flex; flex: none; align-items: center; gap: 5px; color: var(--ink-soft); font-size: var(--fs-chip); }
  .active-state input { accent-color: var(--zelda-green); }
  .add-project { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--surface); color: var(--zelda-green); font-size: 20px; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; }
  .add-project:hover:not(:disabled) { border-color: color-mix(in srgb, var(--zelda-green) 45%, var(--hairline)); background: color-mix(in srgb, var(--zelda-green) 8%, var(--surface)); }
  .add-project:disabled { opacity: .5; cursor: default; }
  .error-state { display: flex; min-height: 130px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--danger); }
  .error-state p { margin: 0; }
  .error { margin: 8px 0 0; color: var(--danger); font-size: var(--fs-caption); }
  .detail-actions { display: flex; }
  .default-source-status { color: var(--zelda-green); font-size: var(--fs-btn-sm); font-weight: 600; }
  @media (max-width: 560px) {
    .meta-line { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  }
</style>
