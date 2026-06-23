import { buildCoresLittlefs } from "./packages/fs-builders/dist/flashImage.js";

const cores = [
  { path: "cores/tama.bin", data: new Uint8Array(1024 * 1024) },
  { path: "cores/nestopia.bin", data: new Uint8Array(1024 * 1024) }
];

buildCoresLittlefs(cores, { blockSize: 4096, blockCount: 2048 })
  .then(() => console.log("Success!"))
  .catch(e => console.error("Failed:", e));
