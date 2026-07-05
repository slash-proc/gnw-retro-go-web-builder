// Lightweight AES-GCM obfuscation for localStorage values that shouldn't sit around as
// bare plaintext (e.g. a remembered ScreenScraper password). This is NOT a real security
// boundary — the key is embedded in the shipped JS bundle, so anyone who can read the app's
// source can decrypt it. What it DOES defeat: casual exposure via devtools' Application tab,
// browser extensions/support tools that dump localStorage as text, or a screen-share showing
// the raw value. Callers must still tell the user it's "obfuscated, not secure."

const KEY_MATERIAL = "gnw-web-builder:local-obfuscation:v1";

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_MATERIAL));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Obfuscate a plaintext string for localStorage. Returns a base64 "iv:ciphertext" blob. */
export async function obfuscate(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/** Reverse of obfuscate(). Returns "" if the stored value is missing, malformed, or from a
 *  different key generation (e.g. an old plaintext value) — never throws. */
export async function deobfuscate(stored: string | null): Promise<string> {
  if (!stored) return "";
  const [ivB64, ctB64] = stored.split(":");
  if (!ivB64 || !ctB64) return "";
  try {
    const key = await getKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivB64) },
      key,
      fromBase64(ctB64),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}
