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
  return classifyBank(bankAt(address, banks));
}

/** Identify the code currently executing. VTOR is a live memory read; PC is only a fallback. */
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
      const bank = bankAt(vtor, banks)?.index ?? null;
      return { kind, vtor, pc: null, bank };
    }
  } catch {
    // Fall through to the brief halted PC sample.
  }

  if (options.pcFallback === false) return { kind: "unknown", vtor, pc: null, bank: null };

  let pc: number | null = null;
  let halted = false;
  try {
    await transport.halt();
    halted = true;
    pc = (await transport.readRegister("pc")) >>> 0;
    const kind = classifyAddress(pc & ~1, banks);
    const bank = bankAt(pc & ~1, banks)?.index ?? null;
    return { kind, vtor, pc, bank };
  } catch {
    return { kind: "unknown", vtor, pc, bank: null };
  } finally {
    if (halted) await transport.resume().catch(() => {});
  }
}
