import { loadSel, saveSel } from "../persist.js";
import { normaliseRepoRef, versionsUrlFor } from "../sources/client.js";
import { fetchNewestRelease, fetchProjects } from "./client.js";
import { DEFAULT_FIRMWARE_REPOSITORY, type CuratedProject } from "./types.js";

const REPOSITORIES_KEY = "firmware-repositories.v1";
const SELECTED_KEY = "firmware-repository.selected.v1";
const DEFAULT_KEY = "firmware-repository.default.v1";

export interface FirmwareRepositoryVersion {
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  gitTag: string;
}

export interface FirmwareRepositoryMetadata {
  title: string;
  repo: string;
  releasesUrl: string;
  retained: number;
  latestTag: string;
  docs?: string;
  versions: FirmwareRepositoryVersion[];
  projects: CuratedProject[];
}

export type FirmwareRepositoryStatus = "loading" | "ready" | "error";

export interface FirmwareRepository {
  repo: string;
  /** Whether this catalog is enabled for source discovery and install selection. */
  active: boolean;
  versions: number;
  status: FirmwareRepositoryStatus;
  /** Firmware release whose manifest and curated project list are shown in the detail view. */
  catalogTag?: string;
  metadata?: FirmwareRepositoryMetadata;
}

class FirmwareRepositoriesStore {
  rows = $state<FirmwareRepository[]>([
    { repo: DEFAULT_FIRMWARE_REPOSITORY, active: true, versions: 0, status: "loading" },
  ]);
  selectedRepo = $state(DEFAULT_FIRMWARE_REPOSITORY);
  defaultRepo = $state(DEFAULT_FIRMWARE_REPOSITORY);
  adding = $state(false);
  error = $state<"invalid" | "duplicate" | "repo-mismatch" | "failed" | null>(null);
  private loaded = false;
  private refreshGeneration = new Map<string, number>();

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const stored = loadSel<FirmwareRepository[] | null>(REPOSITORIES_KEY, null);
    if (stored !== null) {
      this.rows = stored
        .filter((r): r is FirmwareRepository => !!r && typeof r.repo === "string")
        .map((r) => ({
          repo: r.repo,
          // Existing persisted repositories predate the enabled flag and were all available.
          active: r.active !== false,
          versions: Number.isInteger(r.versions) ? r.versions : 0,
          status: r.status === "ready" ? "ready" : r.status === "error" ? "error" : "loading",
          ...(typeof r.catalogTag === "string" ? { catalogTag: r.catalogTag } : {}),
          ...(r.metadata && typeof r.metadata.title === "string" ? { metadata: r.metadata } : {}),
        }));
    }
    const preferred = loadSel<string>(SELECTED_KEY, DEFAULT_FIRMWARE_REPOSITORY);
    const savedDefault = loadSel<string>(DEFAULT_KEY, DEFAULT_FIRMWARE_REPOSITORY);
    this.defaultRepo = this.rows.some((r) => r.repo === savedDefault && r.active)
      ? savedDefault
      : this.rows.find((r) => r.active)?.repo ?? "";
    this.selectedRepo = this.rows.some((r) => r.repo === preferred && r.active)
      ? preferred
      : this.defaultRepo;
    saveSel(DEFAULT_KEY, this.defaultRepo);
    saveSel(SELECTED_KEY, this.selectedRepo);
    for (const row of this.rows) void this.refresh(row.repo);
  }

  get selected(): FirmwareRepository | undefined {
    return this.rows.find((row) => row.repo === this.selectedRepo);
  }

  get activeRows(): FirmwareRepository[] {
    return this.rows.filter((row) => row.active);
  }

  async add(input: string): Promise<boolean> {
    const repo = normaliseRepoRef(input);
    if (!repo) {
      this.error = "invalid";
      return false;
    }
    if (this.rows.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) {
      this.error = "duplicate";
      return false;
    }
    this.adding = true;
    this.error = null;
    const row: FirmwareRepository = { repo, active: true, versions: 0, status: "loading" };
    this.rows = [...this.rows, row];
    this.persist();
    try {
      await this.refresh(repo);
      if (this.rows.find((r) => r.repo === repo)?.status !== "ready") {
        this.rows = this.rows.filter((r) => r.repo !== repo);
        this.persist();
        this.error = "failed";
        return false;
      }
      if (!this.selectedRepo) this.select(repo);
      if (!this.defaultRepo) this.setDefault(repo);
      return true;
    } finally {
      this.adding = false;
    }
  }

  remove(repo: string): void {
    this.rows = this.rows.filter((r) => r.repo !== repo);
    if (this.defaultRepo === repo) this.defaultRepo = this.rows.find((r) => r.active)?.repo ?? "";
    if (this.selectedRepo === repo || !this.rows.some((r) => r.repo === this.selectedRepo && r.active)) {
      this.selectedRepo = this.defaultRepo;
      saveSel(SELECTED_KEY, this.selectedRepo);
    }
    saveSel(DEFAULT_KEY, this.defaultRepo);
    this.persist();
  }

  select(repo: string): void {
    this.selectedRepo = this.rows.some((r) => r.repo === repo && r.active) ? repo : this.defaultRepo;
    saveSel(SELECTED_KEY, this.selectedRepo);
  }

  setActive(repo: string, active: boolean): void {
    const row = this.rows.find((r) => r.repo === repo);
    if (!row) return;
    row.active = active;
    if (!active && this.defaultRepo === repo) {
      this.defaultRepo = this.rows.find((candidate) => candidate.active)?.repo ?? "";
      saveSel(DEFAULT_KEY, this.defaultRepo);
    }
    if (!active && this.selectedRepo === repo) {
      this.selectedRepo = this.defaultRepo;
      saveSel(SELECTED_KEY, this.selectedRepo);
    }
    if (active && !this.defaultRepo) this.setDefault(repo);
    if (active && !this.selectedRepo) this.select(repo);
    this.persist();
  }

  setDefault(repo: string): void {
    if (!this.rows.some((r) => r.repo === repo && r.active)) return;
    this.defaultRepo = repo;
    saveSel(DEFAULT_KEY, repo);
    if (!this.rows.some((r) => r.repo === this.selectedRepo && r.active)) this.select(repo);
  }

  async selectVersion(repo: string, tag: string): Promise<void> {
    const row = this.rows.find((r) => r.repo === repo);
    if (!row || !row.metadata?.versions.some((version) => version.tag === tag)) return;
    if (row.catalogTag === tag && row.status === "ready") return;
    await this.refresh(repo, tag);
  }

  async refresh(repo: string, tag?: string): Promise<void> {
    const row = this.rows.find((r) => r.repo === repo);
    if (!row) return;
    const generation = (this.refreshGeneration.get(repo) ?? 0) + 1;
    this.refreshGeneration.set(repo, generation);
    row.status = "loading";
    try {
      const versionsUrl = versionsUrlFor(repo);
      const { versions, entry, manifest } = await fetchNewestRelease({ versionsUrl, tag: tag ?? row.catalogTag });
      if (this.refreshGeneration.get(repo) !== generation) return;
      if (versions.repo.toLowerCase() !== repo.toLowerCase()) {
        throw new Error("repo-mismatch");
      }
      const projects = await fetchProjects(manifest);
      const current = this.rows.find((r) => r.repo === repo);
      if (!current) return;
      current.versions = versions.versions.length;
      current.metadata = {
        title: versions.title,
        repo: versions.repo,
        releasesUrl: versions.releasesUrl,
        retained: versions.retained,
        latestTag: entry.tag,
        ...(manifest.docs ? { docs: manifest.docs } : {}),
        versions: versions.versions.map((v) => ({
          tag: v.tag,
          publishedAt: v.publishedAt,
          prerelease: v.prerelease,
          gitTag: v.gitTag,
        })),
        projects: projects?.projects ?? [],
      };
      current.catalogTag = entry.tag;
      current.status = "ready";
      this.persist();
    } catch {
      if (this.refreshGeneration.get(repo) !== generation) return;
      const current = this.rows.find((r) => r.repo === repo);
      if (current) current.status = "error";
      this.persist();
    }
  }

  private persist(): void {
    saveSel(REPOSITORIES_KEY, this.rows.map(({ repo, active, versions, catalogTag, metadata }) => ({
      repo,
      active,
      versions,
      ...(catalogTag ? { catalogTag } : {}),
      ...(metadata ? { metadata } : {}),
    })));
  }
}

export const firmwareRepositories = new FirmwareRepositoriesStore();

/** Use the shortest repo suffix that still uniquely identifies every configured source. */
export function shortRepoLabels(repos: readonly string[]): Map<string, string> {
  const segments = new Map(repos.map((repo) => [repo, repo.split("/").filter(Boolean)]));
  const labels = new Map<string, string>();
  for (const repo of repos) {
    const parts = segments.get(repo) ?? [repo];
    let depth = 1;
    while (depth < parts.length) {
      const candidate = parts.slice(-depth).join("/").toLowerCase();
      const matches = repos.filter((other) => {
        const otherParts = segments.get(other) ?? [other];
        return otherParts.slice(-depth).join("/").toLowerCase() === candidate;
      });
      if (matches.length === 1) break;
      depth++;
    }
    labels.set(repo, parts.slice(-depth).join("/"));
  }
  return labels;
}
