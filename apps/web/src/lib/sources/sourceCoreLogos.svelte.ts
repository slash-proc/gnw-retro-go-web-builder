/**
 * Loads the logos embedded in the newest release of each remote core, once per session.
 * The verified core artifact is already content-addressed in OPFS, so later visits reuse the
 * binary without another transfer and the extracted masks live in the source summary card.
 */
import { resolveSource } from "./client.js";
import { fetchTargetArtifacts } from "./installArtifacts.js";
import { blobCache } from "./blobCache.js";
import { isCoreKind, type Target } from "./types.js";
import { parseRawCore } from "./rawCore.js";
import { sources } from "./store.svelte.js";
import type { SourceRow } from "./store.svelte.js";

class SourceCoreLogos {
  private attempted = new Set<string>();
  private running = new Set<string>();

  ensure(rows: readonly SourceRow[]): void {
    for (const row of rows) {
      if (!row.card || !isCoreKind(row.card.kind) || row.origin === "raw") continue;
      if (row.origin === "bundle" && !row.manifest) continue;
      if (row.card.systems.length > 0 && row.card.systems.every((system) => system.logoDataUrl)) continue;
      if (this.attempted.has(row.repo) || this.running.has(row.repo)) continue;
      this.running.add(row.repo);
      void this.load(row).finally(() => {
        this.running.delete(row.repo);
        this.attempted.add(row.repo);
      });
    }
  }

  private async load(row: SourceRow): Promise<void> {
    try {
      // Always resolve newest for the icon. The install version can be pinned independently.
      const resolved = row.origin === "bundle"
        ? (row.manifest ? { manifest: row.manifest } : null)
        : await resolveSource(row.repo);
      if (!resolved) return;
      const manifest = resolved.manifest;
      const target = manifest.targets.find((t) => t.platform === "game-and-watch") ?? manifest.targets[0];
      if (!target || !isCoreKind(target.kind)) return;
      const artifacts = (target.artifacts ?? []).filter((artifact) =>
        !artifact.mapped && /\.bin$/i.test(artifact.filename));
      if (artifacts.length === 0) return;
      const files = await fetchTargetArtifacts({ ...target, artifacts } as Target, { cache: blobCache() });
      const logos = new Map<string, string>();
      for (const [filename, bytes] of files) {
        try {
          const core = parseRawCore(bytes, filename);
          for (const system of core.metadata.systems) {
            if (system.logoDataUrl && !logos.has(system.dirname)) logos.set(system.dirname, system.logoDataUrl);
          }
        } catch {
          // Other .bin artifacts are not CORE containers; the remaining core artifacts still count.
        }
      }
      sources.cacheSystemLogos(row.repo, logos);
    } catch {
      // Icons are decorative. A network, cache, or format failure leaves the text fallback intact.
    }
  }
}

export const sourceCoreLogos = new SourceCoreLogos();
