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
type Task = { request: AssetExtractionRequest; resolve: (res: AssetExtractionResult) => void };
const queue: Task[] = [];
let isBusy = false;

function processQueue() {
  if (isBusy || queue.length === 0 || !worker) return;
  const task = queue.shift()!;
  isBusy = true;
  
  worker.onmessage = (e) => {
    isBusy = false;
    task.resolve(e.data);
    processQueue();
  };
  
  worker.postMessage(task.request);
}

export async function extractHomebrewAssets(
  game: "zelda3" | "smw",
  romData: Uint8Array,
  zipUrl: string
): Promise<AssetExtractionResult> {
  if (!worker) {
    worker = new Worker(new URL("./restool.worker.js", import.meta.url), { type: "module" });
  }
  
  return new Promise((resolve) => {
    queue.push({ request: { game, romData, zipUrl }, resolve });
    processQueue();
  });
}
