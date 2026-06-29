import { planFlashImage } from './packages/fs-builders/dist/flashImage.js';

const userRoms = new Map([
  ['roms/nes/mario.nes', new Uint8Array(10)],
  ['covers/nes/mario.img', new Uint8Array(10)]
]);

const plan = planFlashImage({
  defaultContent: new Map(),
  userRoms,
  lzmaRaw: null,
  compress: false,
});

console.log(plan.frogfsFiles.map(f => f.path));
