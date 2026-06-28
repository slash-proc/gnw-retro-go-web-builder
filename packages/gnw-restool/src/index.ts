export interface AssetExtractionResult {
  game: "zelda3" | "smw";
  success: boolean;
  error?: string;
  files?: Record<string, Uint8Array>;
}

export interface AssetExtractionRequest {
  game: "zelda3" | "smw";
  romData: Uint8Array;
  zipUrl: string;
}

let worker: Worker | null = null;
let currentResolve: ((res: AssetExtractionResult) => void) | null = null;

export async function extractHomebrewAssets(
  game: "zelda3" | "smw",
  romData: Uint8Array,
  zipUrl: string
): Promise<AssetExtractionResult> {
  if (!worker) {
    worker = new Worker(new URL("./restool.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      if (currentResolve) {
        currentResolve(e.data);
        currentResolve = null;
      }
    };
  }
  
  if (currentResolve) {
    throw new Error("Worker is already busy extracting assets.");
  }

  return new Promise((resolve) => {
    currentResolve = resolve;
    worker!.postMessage({ game, romData, zipUrl } as AssetExtractionRequest);
  });
}
