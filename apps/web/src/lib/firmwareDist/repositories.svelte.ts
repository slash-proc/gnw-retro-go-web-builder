import { loadSel, saveSel } from "../persist.js";
import { normaliseRepoRef, versionsUrlFor } from "../sources/client.js";
import { fetchNewestRelease, fetchProjects } from "./client.js";
import { DEFAULT_FIRMWARE_REPOSITORY, type CuratedProject } from "./types.js";

const REPOSITORIES_KEY = "firmware-repositories.v1";
const SELECTED_KEY = "firmware-repository.selected.v1";

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
  versions: number;
  status: FirmwareRepositoryStatus;
  metadata?: FirmwareRepositoryMetadata;
}

class FirmwareRepositoriesStore {
  rows = $state<FirmwareRepository[]>([
    { repo: DEFAULT_FIRMWARE_REPOSITORY, versions: 0, status: "loading" },
  ]);
  selectedRepo = $state(DEFAULT_FIRMWARE_REPOSITORY);
  adding = $state(false);
  error = $state<"invalid" | "duplicate" | "repo-mismatch" | "failed" | null>(null);
  private loaded = false;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const stored = loadSel<FirmwareRepository[] | null>(REPOSITORIES_KEY, null);
    if (stored !== null) {
      this.rows = stored
        .filter((r): r is FirmwareRepository => !!r && typeof r.repo === "string")
        .map((r) => ({
          repo: r.repo,
          versions: Number.isInteger(r.versions) ? r.versions : 0,
          status: r.status === "ready" ? "ready" : r.status === "error" ? "error" : "loading",
          ...(r.metadata && typeof r.metadata.title === "string" ? { metadata: r.metadata } : {}),
        }));
    }
    const preferred = loadSel<string>(SELECTED_KEY, DEFAULT_FIRMWARE_REPOSITORY);
    this.selectedRepo = this.rows.some((r) => r.repo === preferred)
      ? preferred
      : this.rows[0]?.repo ?? "";
    for (const row of this.rows) void this.refresh(row.repo);
  }

  get selected(): FirmwareRepository | undefined {
    return this.rows.find((row) => row.repo === this.selectedRepo);
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
    const row: FirmwareRepository = { repo, versions: 0, status: "loading" };
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
      return true;
    } finally {
      this.adding = false;
    }
  }

  remove(repo: string): void {
    this.rows = this.rows.filter((r) => r.repo !== repo);
    if (this.selectedRepo === repo) this.select(this.rows[0]?.repo ?? "");
    this.persist();
  }

  select(repo: string): void {
    this.selectedRepo = this.rows.some((r) => r.repo === repo) ? repo : "";
    saveSel(SELECTED_KEY, this.selectedRepo);
  }

  async refresh(repo: string): Promise<void> {
    const row = this.rows.find((r) => r.repo === repo);
    if (!row) return;
    row.status = "loading";
    try {
      const versionsUrl = versionsUrlFor(repo);
      const { versions, entry, manifest } = await fetchNewestRelease({ versionsUrl });
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
      current.status = "ready";
      this.persist();
    } catch {
      const current = this.rows.find((r) => r.repo === repo);
      if (current) current.status = "error";
      this.persist();
    }
  }

  private persist(): void {
    saveSel(REPOSITORIES_KEY, this.rows);
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
