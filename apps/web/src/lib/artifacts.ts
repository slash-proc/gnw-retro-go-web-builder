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
// Two separate content trees, not one: every core/homebrew .bin is objcopy'd out of
// whichever ELF was built, and several overlay entry points land at different RAM
// addresses between an SD_CARD=0 (flash) and SD_CARD=1 (SD) build of identical source
// (confirmed on real hardware: NES/PCE/MSX, likely more). sd_content/ comes from the
// SD_CARD=0 build (flash-mode FrogFS/LittleFS building ONLY); sd_content_sd/ comes from
// the SD_CARD=1 build (writing to an actual SD card ONLY). Never substitute one for the
// other — that's exactly the bug that caused every game/homebrew launch to corrupt
// execution on flash-only installs.
const FLASH_PREFIX = "sd_content/";
const SD_PREFIX = "sd_content_sd/";

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
  blobs: { 1: Uint8Array; 2: Uint8Array; sd_1?: Uint8Array; sd_2?: Uint8Array };
  /** Flash-mode content (from the SD_CARD=0 build), keyed by path relative to
   *  sd_content/ (e.g. "cores/nes_fceu.bin"). Use for flash-mode FrogFS/LittleFS
   *  building ONLY — NOT valid for writing to an actual SD card (see sdContent). */
  flashContent: Map<string, Uint8Array>;
  /** SD-mode content (from the SD_CARD=1 build). Use ONLY when actually syncing an
   *  SD card — these cores/homebrew binaries are compiled for a different memory
   *  layout than the flash-mode ones and will corrupt execution if flashed instead. */
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

/** Fetch + unzip a version's bundle into { blob, flashContent, manifest }. */
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

  const sdb1file = manifest.blobs?.sd_bank1?.file;
  const sdb2file = manifest.blobs?.sd_bank2?.file;
  const sd_1 = sdb1file ? files.get(sdb1file) : undefined;
  const sd_2 = sdb2file ? files.get(sdb2file) : undefined;

  const search = new TextEncoder().encode("/cheats\0");
  const replace = new TextEncoder().encode("/roms\0\0\0");
  const allBlobs = [b1, b2];
  if (sd_1) allBlobs.push(sd_1);
  if (sd_2) allBlobs.push(sd_2);
  for (const b of allBlobs) {
    for (let i = 0; i < b.length - search.length; i++) {
      let match = true;
      for (let j = 0; j < search.length; j++) {
        if (b[i + j] !== search[j]) {
          match = false;
          break;
        }
      }
      if (match) b.set(replace, i);
    }
  }

  const flashContent = new Map<string, Uint8Array>();
  const sdContent = new Map<string, Uint8Array>();
  for (const [path, bytes] of files) {
    if (path.startsWith(SD_PREFIX)) sdContent.set(path.slice(SD_PREFIX.length), bytes);
    else if (path.startsWith(FLASH_PREFIX)) flashContent.set(path.slice(FLASH_PREFIX.length), bytes);
  }
  return { blobs: { 1: b1, 2: b2, sd_1, sd_2 }, flashContent, sdContent, manifest };
}
