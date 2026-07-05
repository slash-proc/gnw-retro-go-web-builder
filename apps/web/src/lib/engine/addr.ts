// Canonical device memory-map addresses. Single source of truth for the extflash/intflash
// base addresses — previously re-declared as local `EXTBASE`/`BANK_BASE` constants in ~7
// separate files (apps/web UI components + engine modules). See docs/AUDIT_NOTES.md item #10.

/** External flash's memory-mapped base address (OSPI XiP window). */
export const EXTBASE = 0x90000000;

/** The three real bank targets: 0 = external flash, 1/2 = internal flash banks. */
export const BANK_BASE: Record<number, number> = { 0: EXTBASE, 1: 0x08000000, 2: 0x08100000 };

/** A device-memory read closure: (address-or-offset, length) -> bytes. Previously declared
 *  independently (identically-shaped) as `ExtReadFn` (fsscan.ts, frogfsDevice.ts) and
 *  `IntReadFn` (intflashscan.ts) — one shared type now. */
export type MemReadFn = (addr: number, len: number) => Promise<Uint8Array>;
