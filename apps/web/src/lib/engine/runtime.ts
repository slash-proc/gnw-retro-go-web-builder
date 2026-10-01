import type { SwdTransport } from "@gnw/swd-transport";
import type { IntflashBank } from "./intflashscan.js";

export type RuntimeKind = "retro-go" | "stock-ofw" | "bootloader" | "recovery" | "unknown";

export interface RuntimeState {
  kind: RuntimeKind;
  vtor: number | null;
  pc: number | null;
  bank: 1 | 2 | null;
}

const VTOR = 0xe000ed08;
const BOOTLOADER_START = 0x08032000;
const BOOTLOADER_END = 0x08040000;
const RECOVERY_START = 0x24000000;
const RECOVERY_END = 0x24100000;
const BANK_SIZE = 0x00100000;
const BANK1_START = 0x08000000;
const BANK2_START = 0x08100000;

function bankIndexAt(address: number): 1 | 2 | null {
  if (address >= BANK1_START && address < BANK2_START) return 1;
  if (address >= BANK2_START && address < BANK2_START + BANK_SIZE) return 2;
  return null;
}

function bankAt(address: number, banks: readonly IntflashBank[]): IntflashBank | undefined {
  return banks.find((b) => address >= b.base && address < b.base + BANK_SIZE);
}

function classifyBank(bank: IntflashBank | undefined): RuntimeKind {
  if (!bank) return "unknown";
  if (bank.retroGoVersion) return "retro-go";
  if (bank.ofw) return "stock-ofw";
  return "unknown";
}

function classifyAddress(address: number, banks: readonly IntflashBank[]): RuntimeKind {
  if (address >= RECOVERY_START && address < RECOVERY_END) return "recovery";
  if (address >= BOOTLOADER_START && address < BOOTLOADER_END) return "bootloader";
  // On this platform, bank 2 is the Retro-Go image; this also classifies VTOR values in it.
  if (bankIndexAt(address) === 2) return "retro-go";
  return classifyBank(bankAt(address, banks));
}

/** Identify the active image from VTOR without halting. Deliberate unlocked scans may use PC
 *  only when VTOR does not identify a known region. */
export async function detectRuntime(
  transport: SwdTransport,
  banks: readonly IntflashBank[],
  options: { pcFallback?: boolean } = {},
): Promise<RuntimeState> {
  let vtor: number | null = null;
  try {
    vtor = (await transport.readWord(VTOR)) >>> 0;
    const kind = classifyAddress(vtor, banks);
    if (kind !== "unknown") {
      const bank = bankAt(vtor, banks)?.index ?? bankIndexAt(vtor);
      return { kind, vtor, pc: null, bank };
    }
  } catch {
    // An unavailable VTOR falls through only when the caller explicitly permits PC sampling.
  }

  if (options.pcFallback === false) return { kind: "unknown", vtor, pc: null, bank: vtor === null ? null : bankIndexAt(vtor) };

  let pc: number | null = null;
  let halted = false;
  try {
    await transport.halt();
    halted = true;
    pc = (await transport.readRegister("pc")) >>> 0;
    const kind = classifyAddress(pc & ~1, banks);
    const bank = bankAt(pc & ~1, banks)?.index ?? bankIndexAt(pc & ~1);
    return { kind, vtor, pc, bank };
  } catch {
    return { kind: "unknown", vtor, pc, bank: vtor === null ? null : bankIndexAt(vtor) };
  } finally {
    if (halted) await transport.resume().catch(() => {});
  }
}
