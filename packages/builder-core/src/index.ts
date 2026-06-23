/**
 * L3 — Orchestrator / endpoint API (the "pseudo-backend").
 *
 * The surface the GUI (or our test backend) actually calls. See PLAN.md §"L3".
 * Most endpoints are scaffold stubs; resolveBuild has a first real cut of the
 * Makefile-equivalent layout logic so there is something concrete to test.
 */

import type { SwdTransport } from "@gnw/swd-transport";
import type { BuildDescriptor, FilesystemPlan, InstallMode, RomFile } from "@gnw/fs-builders";

export type ProgressFn = (done: number, total: number) => void;

// Layout source of truth: Makefile / linker scripts. See PLAN.md §"Critical files".
const INTFLASH_BANK1_ADDRESS = 0x08000000;
const INTFLASH_BANK2_ADDRESS = 0x08100000;
const EXTFLASH_ADDRESS = 0x90000000;

export interface BuildOptions {
  target: "mario" | "zelda";
  intflashBank: 1 | 2;
  extflashSizeMb: number;
  extflashOffset?: number;
  sdCard: boolean;
  // feature toggles (coverflow, langs, …) — passed through opaquely for now
  features?: Record<string, unknown>;
}

export interface ResolvedBuildDescriptor extends BuildDescriptor {
  variantKey: string;
  target: string;
  intflashAddress: number;
  extflashAddress: number;
  extflashSize: number;
  extflashOffset: number;
  sdCard: boolean;
}

const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

/**
 * resolveBuild — pure function. Encapsulates Makefile-equivalent logic:
 * derive INTFLASH_ADDRESS from the bank, enforce the power-of-2
 * EXTFLASH_OFFSET+SIZE constraint, and pick the matching CI variant key.
 */
export function resolveBuild(opts: BuildOptions): ResolvedBuildDescriptor {
  const intflashAddress =
    opts.intflashBank === 1 ? INTFLASH_BANK1_ADDRESS : INTFLASH_BANK2_ADDRESS;

  const extflashSize = opts.extflashSizeMb * 1024 * 1024;
  const extflashOffset = opts.extflashOffset ?? 0;

  if (!isPowerOfTwo(extflashOffset + extflashSize)) {
    throw new Error(
      `EXTFLASH_OFFSET + SIZE (${extflashOffset + extflashSize}) must be a power of 2`,
    );
  }

  const variantKey = [
    opts.target,
    `ext${opts.extflashSizeMb}mb`,
    opts.sdCard ? "sd" : "flash",
  ].join("-");

  return {
    variantKey,
    target: opts.target,
    intflashAddress,
    extflashAddress: EXTFLASH_ADDRESS,
    extflashSize,
    extflashOffset,
    sdCard: opts.sdCard,
  };
}

// ---- Manifest / artifact endpoints (stubs) --------------------------------

export interface Variant {
  key: string;
  files: Record<string, { url: string; size: number; sha256: string }>;
}

export interface Manifest {
  generatedAt: string;
  variants: Variant[];
}

const notImplemented = (what: string): never => {
  throw new Error(`[builder-core] ${what} not implemented yet (scaffold stub)`);
};

export async function fetchManifest(_baseUrl?: string): Promise<Manifest> {
  return notImplemented("fetchManifest");
}

export async function listVariants(baseUrl?: string): Promise<string[]> {
  const manifest = await fetchManifest(baseUrl);
  return manifest.variants.map((v) => v.key);
}

export async function fetchArtifacts(
  _descriptor: ResolvedBuildDescriptor,
  _onProgress?: ProgressFn,
): Promise<Record<string, Uint8Array>> {
  return notImplemented("fetchArtifacts");
}

export async function buildFilesystem(
  _mode: InstallMode,
  _roms: RomFile[],
  _descriptor: ResolvedBuildDescriptor,
  _onProgress?: ProgressFn,
): Promise<FilesystemPlan> {
  return notImplemented("buildFilesystem");
}

export async function flash(
  _plan: FilesystemPlan,
  _transport: SwdTransport,
  _onProgress?: ProgressFn,
): Promise<void> {
  notImplemented("flash");
}

export async function pullSaves(_transport: SwdTransport): Promise<Record<string, Uint8Array>> {
  return notImplemented("pullSaves");
}

export async function pushSaves(
  _transport: SwdTransport,
  _saves: Record<string, Uint8Array>,
): Promise<void> {
  notImplemented("pushSaves");
}
