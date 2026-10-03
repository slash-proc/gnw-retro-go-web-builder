import { scanBiosArchiveFiles, type BiosSourceFolder } from "./biosArchiveIndex.js";

self.onmessage = (event: MessageEvent<{ folders: BiosSourceFolder[]; filenames: string[] }>) => {
  void scanBiosArchiveFiles(event.data.folders, event.data.filenames).then(
    (files) => self.postMessage({ files }),
    (error) => self.postMessage({ files: [], error: error instanceof Error ? error.message : String(error) }),
  );
};
