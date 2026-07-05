/** Trigger a browser download of `data` (raw bytes or an already-built Blob) as `name`.
 *  The <a> is appended to the document before clicking — some browsers don't reliably
 *  fire a click on a fully detached element, so this is the more broadly spec-compliant
 *  form (previously only 2 of 7 call sites did this before they were consolidated here). */
export function download(name: string, data: Uint8Array | Blob): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const kb = (n: number): number | string => (n > 0 && n < 512) ? "<1" : Math.round(n / 1024);

/** Local-time `YYYY-MM-DD HH:MM:SS` timestamp (e.g. `2026-07-03 17:14:13`) for log lines. */
export function timestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
