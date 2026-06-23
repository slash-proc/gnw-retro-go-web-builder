/** MarioGnW — 1:1 port of cli/gnw_patch/mario.py. */
import { Device, type ModelConfig, roundUpPage } from "./device.js";
import { roundDownWord, secondsToFrames } from "./firmware.js";

export const MARIO_CONFIG: ModelConfig = {
  name: "mario",
  int: {
    FLASH_BASE: 0x08000000,
    FLASH_LEN: 0x00020000,
    STOCK_ROM_SHA1: "efa04c387ad7b40549e15799b471a6e1cd234c76",
    STOCK_ROM_END: 0x18100,
    KEY_OFFSET: 0x106f4,
    NONCE_OFFSET: 0x106e4,
    RWDATA_OFFSET: 0x180a4,
    RWDATA_LEN: 36,
    RWDATA_DTCM_IDX: 1,
    RWDATA_ITCM_IDX: 0,
  },
  ext: {
    STOCK_ROM_SHA1: "eea70bb171afece163fb4b293c5364ddb90637ae",
    ENC_START: 0,
    ENC_END: 0xf_e000,
    verifySlice: (len) => [0, len - 8192],
  },
  freeMemory: { FLASH_BASE: 0x240f2124, FLASH_LEN: 0x24100000 - 0x240f2124 },
};

const zeros = (n: number) => new Uint8Array(n);

export class MarioGnW extends Device {
  get isMario() {
    return true;
  }
  get isZelda() {
    return false;
  }

  patch(): [number, number] {
    const a = this.args;

    this.internal.replace(0x4, "bootloader");
    this.internal.bl(0x6b52, "read_buttons");

    this.internal.nop(0x6038, 1);
    this.internal.b(0x5f08, 0x5f2a);

    this.internal.asm(0x49e0, "mov.w r1, #0x00000");

    if (a.sleep_time) {
      const frames = secondsToFrames(a.sleep_time as number);
      this.internal.asm(0x6c3c, `movw r2, #${frames}`);
    }
    if (a.disable_sleep) this.internal.replace(0x6c40, 0x91, 1);

    this.internal.nop(0x10688, 2);
    this.internal.nop(0x1068e, 1);

    let compressedLen = this.external.compress(0x0, 7772);
    this.internal.bl(0x665c, "memcpy_inflate");
    this.moveExt(0x0, compressedLen, 0x7204);
    this.extOffset -= 7776 - roundDownWord(compressedLen);

    const smb1Addr = 0x1e60;
    const smb1Size = 40960;
    const patchSmb1Refr = this.internal.address("SMB1_ROM", true);
    this.moveToCompressedMemory(smb1Addr, smb1Size, [0x7368, 0x10954, 0x7218, patchSmb1Refr]);

    this.moveToCompressedMemory(0xbe60, 11620, null);

    this.moveToCompressedMemory(0xebc4, 528, 0x4154);
    this.rwdataLookup(0xebc4, 528);

    this.moveToCompressedMemory(0xedd4, 100, 0x4570);

    for (const [ext, int] of [
      [0xee38, 0x4514],
      [0xee78, 0x4518],
      [0xeeb8, 0x4520],
      [0xeef8, 0x4524],
    ] as const) {
      this.moveToCompressedMemory(ext, 64, int);
    }

    this.moveToCompressedMemory(0xef38, 128 * 10, [0x2ac, 0x2b0, 0x2b4, 0x2b8, 0x2bc, 0x2c0, 0x2c4, 0x2c8, 0x2cc, 0x2d0]);

    this.moveToCompressedMemory(0xf438, 96, 0x456c);
    this.moveToCompressedMemory(0xf498, 180, 0x43f8);
    this.moveToCompressedMemory(0xf54c, 1100, 0x43fc);
    this.moveToCompressedMemory(0xf998, 180, 0x4400);
    this.moveToCompressedMemory(0xfa4c, 1136, 0x4404);
    this.moveToCompressedMemory(0xfebc, 864, 0x450c);
    this.moveToCompressedMemory(0x1_021c, 384, 0x4510);
    this.moveToCompressedMemory(0x1_039c, 384, 0x451c);
    this.moveToCompressedMemory(0x1_051c, 384, 0x4410);
    this.moveToCompressedMemory(0x1_069c, 384, 0x44f8);
    this.moveToCompressedMemory(0x1_081c, 384, 0x4500);
    this.moveToCompressedMemory(0x1_099c, 384, 0x4414);
    this.moveToCompressedMemory(0x1_0b1c, 384, 0x44fc);
    this.moveToCompressedMemory(0x1_0c9c, 384, 0x4504);
    this.moveToCompressedMemory(0x1_0e1c, 384, 0x440c);
    this.moveToCompressedMemory(0x1_0f9c, 384, 0x4408);
    this.moveToCompressedMemory(0x1_111c, 192, 0x44f4);
    this.moveToCompressedMemory(0x1_11dc, 192, 0x4508);
    this.moveToCompressedMemory(0x1_129c, 304, 0x458c);
    this.moveToCompressedMemory(0x1_13cc, 768, 0x4584);
    this.moveToCompressedMemory(0x1_16cc, 1144, 0x4588);
    this.moveToCompressedMemory(0x1_1b44, 768, 0x4534);
    this.moveToCompressedMemory(0x1_1e44, 32, 0x455c);
    this.moveToCompressedMemory(0x1_1e64, 32, 0x4558);
    this.moveToCompressedMemory(0x1_1e84, 32, 0x4554);
    this.moveToCompressedMemory(0x1_1ea4, 32, 0x4560);
    this.moveToCompressedMemory(0x1_1ec4, 32, 0x4564);
    this.moveToCompressedMemory(0x1_1ee4, 64, 0x453c);
    this.moveToCompressedMemory(0x1_1f24, 64, 0x4530);
    this.moveToCompressedMemory(0x1_1f64, 64, 0x4540);
    this.moveToCompressedMemory(0x1_1fa4, 64, 0x4544);
    this.moveToCompressedMemory(0x1_1fe4, 64, 0x4548);
    this.moveToCompressedMemory(0x1_2024, 64, 0x454c);
    this.moveToCompressedMemory(0x1_2064, 64, 0x452c);
    this.moveToCompressedMemory(0x1_20a4, 64, 0x4550);

    this.moveToCompressedMemory(0x1_20e4, 21 * 96, 0x4574);
    this.moveToCompressedMemory(0x1_28c4, 192, 0x4578);
    this.moveToCompressedMemory(0x1_2984, 640, 0x457c);
    this.moveToCompressedMemory(0x1_2c04, 320, 0x4538);

    const marioSongLen = 0x85e40;
    if (a.no_mario_song) {
      this.external.replace(0x1_2d44, zeros(marioSongLen));
      this.rwdataErase(0x1_2d44, marioSongLen);
      this.extOffset -= marioSongLen;
      this.internal.asm(0x6fc8, "b 0x1c");
    } else {
      this.moveExt(0x1_2d44, marioSongLen, [
        0x11a00, 0x11a00 + 4, 0x11a00 + 8, 0x11a00 + 12, 0x11a00 + 16, 0x11a00 + 20, 0x11a00 + 24, 0x1199c,
      ]);
      this.rwdataLookup(0x1_2d44, marioSongLen);
    }

    compressedLen = this.external.compress(0x9_8b84, 0x1_0000);
    this.internal.bl(0x678e, "memcpy_inflate");
    this.moveExt(0x9_8b84, compressedLen, 0x7350);
    this.extOffset -= 0x1_0000 - roundDownWord(compressedLen);

    this.moveToCompressedMemory(0xa_8b84, 192, 0xb720);
    this.moveToCompressedMemory(0xa_8c44, 8352, 0xbc44);
    this.moveToCompressedMemory(0xa_ace4, 16128, [0xcea8, 0xd2f8]);
    this.moveToCompressedMemory(0xa_ebe4, 116, [0x0_d010, 0x0_d004, 0x0_d2d8, 0x0_d2dc, 0x0_d2f4, 0x0_d2f0]);

    const smb2Addr = 0xa_ec58;
    const smb2Size = 0x1_0000;
    if (a.no_smb2) {
      this.external.replace(smb2Addr, zeros(smb2Size));
      this.extOffset -= smb2Size;
      this.internal.b(0x69fc, 0x6a8c);
    } else {
      compressedLen = this.external.compress(smb2Addr, smb2Size);
      this.internal.bl(0x6a12, "memcpy_inflate");
      this.moveToCompressedMemory(smb2Addr, compressedLen, 0x7374);
      this.extOffset -= smb2Size - roundDownWord(compressedLen);
      const padded = roundUpPage(compressedLen);
      this.internal.asm(0x6a0a, `mov.w r2, #${padded}`);
      this.internal.asm(0x6a1e, `mov.w r3, #${padded}`);
    }

    this.moveToCompressedMemory(0xbec58, 8 * 2, 0x10964);

    this.moveToCompressedMemory(0xbec68, 320, null);
    this.moveToCompressedMemory(0xbeda8, 320, null);
    this.moveToCompressedMemory(0xbeee8, 320, null);
    this.moveToCompressedMemory(0xbf028, 320, null);
    this.moveToCompressedMemory(0xbf168, 320, null);

    this.moveToCompressedMemory(0xbf2a8, 45 * 8, null);
    this.moveToCompressedMemory(0xbf410, 144, 0x1658c);

    const lookupTableStart = 0xb_f4a0;
    const lookupTableEnd = 0xb_f838;
    for (let addr = lookupTableStart; addr < lookupTableEnd; addr += 4) this.external.lookupRefs(addr);
    this.moveToCompressedMemory(lookupTableStart, lookupTableEnd - lookupTableStart, 0xdf88);

    this.moveToCompressedMemory(0xbf838, 280, [0xe8f8, 0xf4ec, 0xf4f8, 0x10098, 0x105b0]);
    this.moveToCompressedMemory(0xbf950, 180, [0xe2e4, 0xf4fc]);
    this.moveToCompressedMemory(0xbfa04, 8, 0x1_6590);
    this.moveToCompressedMemory(0xbfa0c, 784, 0x1_0f9c);

    const newLoc = this.moveExt(0xb_fd1c, 14244, null);
    for (const reference of [
      0x00d330, 0x00d310, 0x00d308, 0x00d338, 0x00d348, 0x00d360, 0x00d368, 0x00d388, 0x00d358, 0x00d320,
      0x00d350, 0x00d380, 0x00d378, 0x00d318, 0x00d390, 0x00d370, 0x00d340, 0x00d398, 0x00d328,
    ]) {
      this.internal.lookupRefs(reference);
    }
    for (let reference of [0xc_1174, 0xc_313c, 0xc_049c, 0xc_1178, 0xc_220c, 0xc_3490, 0xc_3498]) {
      reference = reference - 0xb_fd1c + newLoc;
      try {
        this.internal.lookupRefs(reference);
      } catch {
        this.external.lookupRefs(reference);
      }
    }

    this.moveToCompressedMemory(0xc34c0, 6168, 0x43ec);
    this.rwdataLookup(0xc34c0, 6168);
    this.moveToCompressedMemory(0xc4cd8, 2984, 0x459c);
    this.moveToCompressedMemory(0xc5880, 120, 0x4594);

    const totalImageLength = 193_568;
    const imageRefs = [0x1097c, 0x1097c + 4, 0x1097c + 8, 0x1097c + 12, 0x1097c + 16];
    if (a.no_sleep_images) {
      this.external.replace(0xc58f8, zeros(totalImageLength));
      for (const reference of imageRefs) this.internal.replace(reference, zeros(4));
      this.extOffset -= totalImageLength;
    } else {
      this.moveExt(0xc58f8, totalImageLength, imageRefs);
    }

    this.moveToCompressedMemory(0xf4d18, 2880, 0x10960);

    this.external.replace(0xf5858, zeros(34728));
    this.extOffset -= 34728;

    if (this.compressedMemoryPos) {
      this.internal.rwdata!.append(
        this.compressedMemory.buf.getSlice(0, this.compressedMemoryPos),
        this.compressedMemory.FLASH_BASE,
      );
    }

    this.intPos += this.internal.rwdata!.writeTableAndData(0x17db4, this.intPos, this.compress);

    this.extOffset = roundUpPage(this.extOffset);

    if (a.no_save) {
      for (const nop of [0x495e, 0x49a6, 0x49b2]) this.internal.nop(nop, 2);
      this.internal.b(0x4988, 0x49c0);
      this.internal.b(0x48be, 0x4912);
      this.extOffset -= 8192;
    } else {
      this.internal.asm(
        0x4856,
        `ite ne; movne.w r4, #${hex(0xff000 + this.extOffset)}; moveq.w r4, #${hex(0xfe000 + this.extOffset)}`,
      );
      this.internal.asm(
        0x48c0,
        `ite ne; movne.w r4, #${hex(0xff000 + this.extOffset)}; moveq.w r4, #${hex(0xfe000 + this.extOffset)}`,
      );
    }

    this.internal.add(0x1_06ec, this.extOffset);
    this.external.shorten(this.extOffset);

    return [this.internal.length - this.intPos, this.compressedMemory.length - this.compressedMemoryPos];
  }
}

const hex = (n: number) => "0x" + n.toString(16);
