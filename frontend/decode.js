// Shared decoders for the generic Cortex-M / STM32 debug registers. Both probe
// backends (ST-Link via webstlink, picoprobe via dapjs) read the same raw words
// and decode them here. These reads are standard SWD/CoreSight — chip-agnostic.

// CPUID PARTNO (bits 4..15) → Cortex-M core name.
const CORTEX_PARTNO = {
  0xc20: "Cortex-M0",
  0xc21: "Cortex-M1",
  0xc23: "Cortex-M3",
  0xc24: "Cortex-M4",
  0xc27: "Cortex-M7",
  0xc60: "Cortex-M0+",
  0xd20: "Cortex-M23",
  0xd21: "Cortex-M33",
};

// STM32 DBGMCU DEV_ID (bits 0..11) → family. 0x480 covers STM32H7A3/H7B3/H7B0.
const STM32_DEV_ID = {
  0x480: "STM32H7A3/H7B3/H7B0",
  0x450: "STM32H742/743/753/750",
  0x483: "STM32H72x/H73x",
};

export const CPUID_REG = 0xe000ed00; // ARMv7-M CPUID, identifies the core
export const DBGMCU_IDCODE_H7 = 0x5c001000; // STM32H7 DBGMCU base: DEV_ID + REV_ID

export const hex = (n, width = 8) => "0x" + (n >>> 0).toString(16).padStart(width, "0");

export function decodeCpuid(cpuid) {
  const partno = (cpuid >>> 4) & 0xfff;
  return {
    raw: hex(cpuid),
    implementer: hex((cpuid >>> 24) & 0xff, 2),
    variant: (cpuid >>> 20) & 0xf,
    partno: hex(partno, 3),
    core: CORTEX_PARTNO[partno] ?? "unknown",
    revision: cpuid & 0xf,
  };
}

export function decodeIdcode(idcode) {
  const devId = idcode & 0xfff;
  return {
    raw: hex(idcode),
    devId: hex(devId, 3),
    device: STM32_DEV_ID[devId] ?? "unknown",
    revId: hex((idcode >>> 16) & 0xffff, 4),
  };
}

/**
 * Read basic core/chip identity through an SwdTransport (backend-agnostic).
 * @param {{readWord: (addr:number)=>Promise<number>}} transport
 */
export async function queryCoreInfo(transport) {
  const cpuid = decodeCpuid(await transport.readWord(CPUID_REG));
  let dbgmcuIdcode = null;
  try {
    dbgmcuIdcode = decodeIdcode(await transport.readWord(DBGMCU_IDCODE_H7));
  } catch {
    /* DBGMCU may be unreadable on some targets; leave null */
  }
  return { cpuid, dbgmcuIdcode };
}
