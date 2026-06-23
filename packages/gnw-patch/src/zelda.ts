/** ZeldaGnW — 1:1 port of cli/gnw_patch/zelda.py. */
import { Device, type ModelConfig } from "./device.js";

export const ZELDA_CONFIG: ModelConfig = {
  name: "zelda",
  int: {
    FLASH_BASE: 0x08000000,
    FLASH_LEN: 0x00020000,
    STOCK_ROM_SHA1: "ac14bcea6e4ff68c88fd2302c021025a2fb47940",
    STOCK_ROM_END: 0x1b3e0,
    KEY_OFFSET: 0x165a4,
    NONCE_OFFSET: 0x16590,
    RWDATA_OFFSET: 0x1b390,
    RWDATA_LEN: 20,
    RWDATA_DTCM_IDX: 0,
    RWDATA_ITCM_IDX: null,
  },
  ext: {
    STOCK_ROM_SHA1: "1c1c0ed66d07324e560dcd9e86a322ec5e4c1e96",
    ENC_START: 0x20000,
    ENC_END: 0x3254a0,
    verifySlice: (_len, encStart, encEnd) => [encStart, encEnd],
  },
  freeMemory: { FLASH_BASE: 0x240f2124, FLASH_LEN: 0 },
};

const bytes = (...b: number[]) => new Uint8Array(b);

export class ZeldaGnW extends Device {
  get isMario() {
    return false;
  }
  get isZelda() {
    return true;
  }

  private disableSaveEncryption(): void {
    this.internal.nop(0xf222, 1);
    this.internal.asm(0xf228, "add.w r2,r1,#0x10");
    this.internal.asm(0xf22c, "sub.w r1,r8,#0x10");

    this.internal.b(0x13ed8, 0x13f06);

    this.internal.asm(0xb5c4, "mov r1,r2");
    this.internal.nop(0xb5c6, 1);
    this.internal.nop(0xb5cc, 1);

    this.internal.asm(0xf12c, "add.w r7,r0,#0x10");
    this.internal.asm(0xf130, "mov   r5,r1");
    this.internal.asm(0xf132, "sub.w r6,r2,#0x10");
    this.internal.asm(0xf136, "sub   sp,#0x10");
    this.internal.asm(0xf138, "mov   r1,r6");
    this.internal.asm(0xf13a, "mov   r0,r7");
    this.internal.replace(0xf13c, bytes(0xf4, 0xf7, 0xbc, 0xfc));
    this.internal.asm(0xf140, "mov   r2,r7");
    this.internal.asm(0xf142, "mov   r1,r6");
    this.internal.asm(0xf144, "mov   r0,r5");
    this.internal.replace(0xf146, bytes(0xfc, 0xf7, 0x29, 0xfc));
    this.internal.b(0xf14a, 0xf172);

    this.internal.b(0x13f52, 0x13f94);

    this.internal.asm(0xb528, "mov r7,r0");
    this.internal.nop(0xb52a, 1);
    this.internal.replace(0xb54c, bytes(0xc0, 0xb1));
  }

  private eraseSavedata(): void {
    this.external.setRange(0x0000, 0x12000, bytes(0xff));
    this.external.setRange(0x3e_8000, 0x3f_0000, bytes(0xff));
  }

  patch(): [number, number] {
    const a = this.args;
    const bWMemcpyInflate = "b.w #" + hex(0xfffffffe & this.internal.address("memcpy_inflate"));

    this.eraseSavedata();
    this.disableSaveEncryption();

    this.internal.replace(0x4, "bootloader");
    this.internal.bl(0xfe54, "read_buttons");

    this.internal.nop(0xebd0, 1);
    this.internal.b(0xeaa0, 0xeac2);

    this.internal.nop(0x16536, 2);
    this.internal.nop(0x1653a, 1);
    this.internal.nop(0x1653c, 1);

    if (a.no_hour_tune) this.external.buf.setU8(0x320025, 0xe0);
    if (a.no_second_beep) this.external.nop(0x32002e, 1);

    const compressedLen = this.external.compress(0xd_0000, 0x2000);
    this.internal.asm(0xf430, bWMemcpyInflate);
    this.moveToInt(0xd_0000, compressedLen, 0xfcf8);

    if (a.no_la) {
      this.external.clearRange(0xd2000, 0x1f4c00);
      this.external.buf.setU8(0x315b54, 0x00);
      this.external.buf.setU8(0x315b58, 0x00);
      this.external.buf.setU8(0x315b5c, 0x00);
      this.external.buf.setU8(0x315b60, 0x00);
    }

    if (a.no_sleep_images) this.external.clearRange(0x1f4c00, 0x288120);

    this.intPos += this.internal.rwdata!.writeTableAndData(0x1b070, this.intPos, this.compress);

    return [this.internal.length - this.intPos, this.compressedMemory.length - this.compressedMemoryPos];
  }
}

const hex = (n: number) => "0x" + (n >>> 0).toString(16);
