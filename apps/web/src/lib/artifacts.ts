/**
 * Firmware artifact source — the consumer side of the web-flasher pipeline.
 *
 * Version list + metadata come straight from the GitHub Releases API (CORS-OK).
 * The binary bundle (web-artifacts.zip) is fetched through our CORS proxy (a
 * Cloudflare Worker — GitHub's release-asset CDN sends no CORS headers; see
 * infra/cors-proxy/), then unzipped in-browser into the firmware blobs (one per
 * intflash bank, each with the patchable layout superblock) + the default sd_content
 * (cores/bios/fonts/lang/logo/homebrew) which we later merge with the user's ROMs
 * into a FrogFS image.
 */
import { unzip } from "./unzip.js";

/** Repo that publishes the web-artifacts.* prereleases (your fork for now;
 * switch to upstream once the superblock + producer workflow are merged there). */
export const ARTIFACT_REPO = "slash-proc/game-and-watch-retro-go-sd";
/** CORS proxy base for the binary asset (deploy: infra/cors-proxy/). */
export const ARTIFACT_WORKER = "https://gnw-artifacts.slash-proc.workers.dev";

const ASSET = "web-artifacts.zip";
const SD_PREFIX = "sd_content/";

export interface FirmwareVersion {
  tag: string;
  name: string;
  sha: string;
  prerelease: boolean;
  publishedAt: string;
}

export interface FirmwareManifest {
  id: string;
  ref: string;
  sha: string;
  /** Linked blobs by bank: { bank1: { file, intflashAddr, bytes }, bank2: {...} }. */
  blobs: Record<string, { file: string; intflashAddr: string; bytes: number }>;
  /** Capabilities baked into the blobs (coverflow, cheatCodes, screenshot, …). */
  capabilities: string[];
  cores: string[];
  superblock: boolean;
  builtAt: string;
  [k: string]: unknown;
}

export interface FirmwareBundle {
  /** intflash blobs by bank — both carry the GWLB layout superblock.
   * 1 = overwrite stock (0x08000000); 2 = keep stock for dual-boot (0x08100000). */
  blobs: { 1: Uint8Array; 2: Uint8Array };
  /** Default content, keyed by path relative to sd_content/ (e.g. "cores/nes_fceu.bin"). */
  sdContent: Map<string, Uint8Array>;
  manifest: FirmwareManifest;
}

interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  published_at: string;
  assets: { name: string }[];
}

/** List installable firmware versions (releases that carry web-artifacts.zip),
 *  newest first. Sorts by release `id` (monotonic) because the fork's release
 *  `created_at` timestamps are unreliable (all identical). */
export async function listVersions(): Promise<FirmwareVersion[]> {
  const res = await fetch(`https://api.github.com/repos/${ARTIFACT_REPO}/releases?per_page=50`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing releases`);
  const rels = (await res.json()) as GhRelease[];
  return rels
    .filter((r) => r.assets?.some((a) => a.name === ASSET) && !r.tag_name.startsWith("web-artifacts-"))
    .sort((a, b) => b.id - a.id)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      prerelease: !!r.prerelease,
      publishedAt: r.published_at,
      sha: r.tag_name.match(/-g([0-9a-f]+)$/)?.[1] ?? r.tag_name.match(/web-artifacts-([0-9a-f]+)$/)?.[1] ?? "",
    }));
}

/** Fetch + unzip a version's bundle into { blob, sdContent, manifest }. */
export async function fetchBundle(tag: string): Promise<FirmwareBundle> {
  const res = await fetch(`${ARTIFACT_WORKER}/${encodeURIComponent(tag)}/${ASSET}`);
  if (!res.ok) throw new Error(`artifact fetch ${res.status} for ${tag}`);
  const buf = new Uint8Array(await res.arrayBuffer());

  const files = await unzip(buf);
  const manRaw = files.get("manifest.json");
  if (!manRaw) throw new Error("bundle missing manifest.json");
  const manifest = JSON.parse(new TextDecoder().decode(manRaw)) as FirmwareManifest;

  // Manifest-driven blob filenames; reject pre-two-bank bundles with a clear message.
  const b1file = manifest.blobs?.bank1?.file;
  const b2file = manifest.blobs?.bank2?.file;
  if (!b1file || !b2file) {
    throw new Error(`"${tag}" predates two-bank support — pick a newer build.`);
  }
  const b1 = files.get(b1file);
  const b2 = files.get(b2file);
  if (!b1 || !b2) throw new Error("bundle missing a bank blob");

  const sdContent = new Map<string, Uint8Array>();
  for (const [path, bytes] of files) {
    if (path.startsWith(SD_PREFIX)) sdContent.set(path.slice(SD_PREFIX.length), bytes);
  }
  return { blobs: { 1: b1, 2: b2 }, sdContent, manifest };
}
