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
// FOUR content trees, one per (SD_CARD, INTFLASH_BANK) pair — never one shared tree.
// Every core/homebrew .bin is objcopy'd out of whichever ELF was built, so it carries
// that build's absolute addresses on BOTH axes:
//   SD_CARD - overlay entry points land at different RAM addresses between SD_CARD=0
//     and SD_CARD=1 builds (confirmed on hardware: NES/PCE/MSX, likely more).
//   INTFLASH_BANK - cores call back into firmware through absolute pointers that are
//     bank-specific. Bank2-built cores hold 0x0810cdcd (odroid_system_init @ bank2);
//     pair them with a bank1 blob and the first callback jumps into bank 2 — silently
//     odd if a stale image sits there, instant hardfault at PC=0x0810cdcc once bank 2
//     is erased. Shipped in v1.4.1-43-gff74121c and diagnosed on hardware.
// Content therefore comes from manifest.blobs[<key>].content — see contentFor().
type ContentKey = "bank1" | "bank2" | "sd_bank1" | "sd_bank2";
// Pre-fix bundles carried only these two trees, both extracted from the BANK2 builds.
const LEGACY_PREFIX: Record<string, ContentKey> = {
  "sd_content_sd/": "sd_bank2",
  "sd_content/": "bank2",
};

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
  /** Linked blobs by bank: { bank1: { file, intflashAddr, bytes, content }, bank2: {...} }.
   *  `content` (post-fix bundles only) names the ONE content tree built alongside that
   *  blob; content must never be taken from anywhere else. */
  blobs: Record<
    string,
    { file: string; intflashAddr: string; bytes: number; content?: string; cores?: string[] }
  >;
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
  /** Content trees keyed exactly like `blobs`, each valid ONLY for its own blob.
   *  Paths are relative to the tree root (e.g. "cores/nes_fceu.bin"). Prefer
   *  contentFor() over indexing this directly. */
  content: Partial<Record<ContentKey, Map<string, Uint8Array>>>;
  /** The content built alongside the blob for `bank` in the given mode. Throws rather
   *  than falling back to another bank's tree — a wrong pairing is not a degraded
   *  install, it's a hardfault on the first core callback. */
  contentFor(bank: 1 | 2, sdCard: boolean): Map<string, Uint8Array>;
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

  // Post-fix bundles: each blob names its own tree. Pre-fix bundles: two shared trees,
  // both actually extracted from the BANK2 builds — mapped to the bank2 keys only, so a
  // bank1 install off an old bundle fails loudly in contentFor() instead of hardfaulting
  // on hardware.
  const prefixes = new Map<string, ContentKey>();
  for (const key of ["bank1", "bank2", "sd_bank1", "sd_bank2"] as ContentKey[]) {
    const dir = manifest.blobs?.[key]?.content;
    if (dir) prefixes.set(dir.endsWith("/") ? dir : `${dir}/`, key);
  }
  const legacy = prefixes.size === 0;
  if (legacy) for (const [p, k] of Object.entries(LEGACY_PREFIX)) prefixes.set(p, k);

  const content: Partial<Record<ContentKey, Map<string, Uint8Array>>> = {};
  for (const [path, bytes] of files) {
    for (const [prefix, key] of prefixes) {
      if (path.startsWith(prefix)) {
        (content[key] ??= new Map()).set(path.slice(prefix.length), bytes);
        break;
      }
    }
  }

  const contentFor = (bank: 1 | 2, sdCard: boolean): Map<string, Uint8Array> => {
    const key = (sdCard ? `sd_bank${bank}` : `bank${bank}`) as ContentKey;
    const tree = content[key];
    if (tree?.size) return tree;
    throw new Error(
      legacy
        ? `"${tag}" ships only bank2 content (cores carry bank-specific firmware ` +
          `pointers, and this build predates the per-bank fix). Installing to bank ` +
          `${bank} from it would hardfault on the first core callback — pick a newer build.`
        : `bundle missing content tree "${key}"`,
    );
  };

  return { blobs: { 1: b1, 2: b2, sd_1, sd_2 }, content, contentFor, manifest };
}
