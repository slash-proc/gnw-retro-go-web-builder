import { loadSel, saveSel } from "../persist.js";
import { normaliseRepoRef, versionsUrlFor } from "../sources/client.js";
import { fetchVersions } from "./client.js";
import { DEFAULT_FIRMWARE_REPOSITORY } from "./types.js";

const REPOSITORIES_KEY = "firmware-repositories.v1";
const SELECTED_KEY = "firmware-repository.selected.v1";

export interface FirmwareRepository {
  repo: string;
  versions: number;
  metadata?: FirmwareRepositoryMetadata;
}

export interface FirmwareRepositoryMetadata {
  title: string;
  repo: string;
  releasesUrl: string;
  retained: number;
  versions: { tag: string; publishedAt: string; prerelease: boolean; gitTag: string }[];
}

class FirmwareRepositoriesStore {
  rows = $state<FirmwareRepository[]>([{ repo: DEFAULT_FIRMWARE_REPOSITORY, versions: 0 }]);
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
          ...(r.metadata && typeof r.metadata.title === "string" ? { metadata: r.metadata } : {}),
        }));
    }
    const preferred = loadSel<string>(SELECTED_KEY, DEFAULT_FIRMWARE_REPOSITORY);
    this.selectedRepo = this.rows.some((r) => r.repo === preferred)
      ? preferred
      : this.rows[0]?.repo ?? "";
    for (const row of this.rows) void this.refreshCount(row.repo);
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
    try {
      const index = await fetchVersions(versionsUrlFor(repo));
      if (index.repo.toLowerCase() !== repo.toLowerCase()) {
        this.error = "repo-mismatch";
        return false;
      }
      const row = { repo, versions: index.versions.length, metadata: this.toMetadata(index) };
      this.rows = [...this.rows, row];
      if (!this.selectedRepo) this.select(repo);
      this.persist();
      return true;
    } catch {
      this.error = "failed";
      return false;
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

  private async refreshCount(repo: string): Promise<void> {
    try {
      const index = await fetchVersions(versionsUrlFor(repo));
      const row = this.rows.find((r) => r.repo === repo);
      if (row && index.repo.toLowerCase() === repo.toLowerCase()) {
        row.versions = index.versions.length;
        row.metadata = this.toMetadata(index);
        this.persist();
      }
    } catch {
      // A count is supplementary; keep the saved repo available so it can be retried later.
    }
  }

  private persist(): void {
    saveSel(REPOSITORIES_KEY, this.rows);
  }

  private toMetadata(index: Awaited<ReturnType<typeof fetchVersions>>): FirmwareRepositoryMetadata {
    return {
      title: index.title,
      repo: index.repo,
      releasesUrl: index.releasesUrl,
      retained: index.retained,
      versions: index.versions.map((v) => ({
        tag: v.tag,
        publishedAt: v.publishedAt,
        prerelease: v.prerelease,
        gitTag: v.gitTag,
      })),
    };
  }
}

export const firmwareRepositories = new FirmwareRepositoriesStore();
