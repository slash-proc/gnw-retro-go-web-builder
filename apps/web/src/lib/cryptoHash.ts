import { createSHA1, createSHA256 } from "hash-wasm/dist/index.esm.js";

/** Hash bytes in secure and insecure browser contexts. WebCrypto is preferred when present;
 * hash-wasm keeps local HTTP installs working where crypto.subtle is unavailable. */
export async function hashBytes(algorithm: "SHA-1" | "SHA-256", bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return new Uint8Array(await subtle.digest(algorithm, bytes as BufferSource));

  const hasher = algorithm === "SHA-1" ? await createSHA1() : await createSHA256();
  hasher.init();
  hasher.update(bytes);
  const hex = hasher.digest("hex");
  const digest = new Uint8Array(hex.length / 2);
  for (let i = 0; i < digest.length; i++) digest[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return digest;
}

export async function hashHex(algorithm: "SHA-1" | "SHA-256", bytes: Uint8Array): Promise<string> {
  return Array.from(await hashBytes(algorithm, bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
