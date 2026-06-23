export type SupportedGame = "smw" | "zelda3";

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<number, { resolve: (data: Uint8Array) => void; reject: (err: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./restool.worker.ts", import.meta.url), { type: "classic" });
    worker.onmessage = (e) => {
      const { id, success, data, error } = e.data;
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        if (success) {
          p.resolve(new Uint8Array(data));
        } else {
          p.reject(new Error(error));
        }
      }
    };
  }
  return worker;
}

/**
 * Extracts game assets (smw_assets.dat / zelda3_assets.dat) from a ROM
 * using the upstream python restool.py scripts running inside Pyodide.
 *
 * @param game "smw" or "zelda3"
 * @param romData The original SNES ROM contents
 * @param restoolZip The zipped Python scripts (from web-artifacts.zip)
 */
export async function extractAssets(
  game: SupportedGame,
  romData: Uint8Array,
  restoolZip: ArrayBuffer
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage(
      {
        id,
        action: "extract",
        game,
        romData,
        restoolZip,
      },
      [romData.buffer]
    );
  });
}
