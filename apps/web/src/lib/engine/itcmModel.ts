/** GnWManager-identical model signatures for the readable ITCM firmware prefix. */
export const LOCKED_MODEL = {
  mario: { itcmOffset: 0, itcmSha1: "ca71a54c0a22cca5c6ee129faee9f99f3a346ca0", payloadOffset: 0 },
  zelda: { itcmOffset: 0x20, itcmSha1: "2f70156235ffd871599facf64457040d549353b4", payloadOffset: 0x30c3a8 },
} as const;

export type ItcmModel = keyof typeof LOCKED_MODEL;

export interface ItcmModelProbe {
  model: ItcmModel | null;
  /** The probe read enough ITCM bytes successfully to classify or reject the signatures. */
  readable: boolean;
  /** Both signature windows were readable and contain only erased/cleared bytes. */
  cleared: boolean;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const isFilledWith = (bytes: Uint8Array, value: number): boolean =>
  bytes.every((byte) => byte === value);

/** Match GnWManager's DeviceModel.autodetect and report a successfully cleared ITCM separately
 * from a failed read. Stock model hashes use 1,300 bytes at each model's ITCM offset. */
export async function probeModelFromItcm(transport: {
  readMemory(address: number, length: number): Promise<Uint8Array>;
}): Promise<ItcmModelProbe> {
  const windows: Uint8Array[] = [];
  for (const model of ["mario", "zelda"] as const) {
    const { itcmOffset, itcmSha1 } = LOCKED_MODEL[model];
    const bytes = await transport.readMemory(itcmOffset, 1300);
    if (bytes.length !== 1300) throw new Error(`Short ITCM read for ${model}: ${bytes.length} of 1300 bytes`);
    if (await sha1Hex(bytes) === itcmSha1) return { model, readable: true, cleared: false };
    windows.push(bytes);
  }
  const cleared = windows.every((bytes) => isFilledWith(bytes, 0x00)) ||
    windows.every((bytes) => isFilledWith(bytes, 0xff));
  return { model: null, readable: true, cleared };
}

/** Backwards-compatible model-only probe for callers that do not need the cleared signal. */
export async function detectModelFromItcm(transport: {
  readMemory(address: number, length: number): Promise<Uint8Array>;
}): Promise<ItcmModel | null> {
  return (await probeModelFromItcm(transport)).model;
}
