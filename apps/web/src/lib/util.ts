export function download(name: string, data: Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export const kb = (n: number): number => Math.round(n / 1024);
