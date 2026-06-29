import { createCRC32, createMD5, createSHA1 } from "hash-wasm";

export async function createHashers() {
  return {
    crc: await createCRC32(),
    md5: await createMD5(),
    sha1: await createSHA1(),
  };
}

export async function hashFile(file, hashers) {
  hashers.crc.init();
  hashers.md5.init();
  hashers.sha1.init();
  const reader = file.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hashers.crc.update(value);
    hashers.md5.update(value);
    hashers.sha1.update(value);
  }
  return {
    crc: hashers.crc.digest("hex").toUpperCase(),
    md5: hashers.md5.digest("hex"),
    sha1: hashers.sha1.digest("hex"),
    size: file.size,
  };
}
