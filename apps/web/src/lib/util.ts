import { locale } from "./i18n/locale.svelte.js";

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

/** Human byte size that never pads a whole number with dead decimals: `2 MB`, `512 KB`,
 *  `900 B`, `5.12 MB`, `1.4 KB` — never `2.00 MB`. At most 2 decimals, trailing zeros
 *  trimmed. `—` for a non-finite input.
 *
 *  Units are 1024-based but keep the LOOSE labels (`KB`/`MB`/`GB`, not `KiB`/`MiB`/`GiB`) —
 *  deliberate, matching the rest of the UI copy and the owner's ruling. The suffixes and the
 *  number/unit separator come from the active locale (`shared.units`), because several
 *  languages don't use the English ones: French says *octet*, so `o`/`Ko`/`Mo`/`Go`, and
 *  Japanese sets no space between the number and the unit.
 *
 *  Reading the locale STORE here (rather than taking a locale argument) is what keeps all 19
 *  call sites — `.svelte` components and plain `.ts` modules alike — unchanged. It is safe
 *  from an import cycle: nothing under `src/lib/i18n/` imports `util.ts` (nor does
 *  `persist.ts`, which `locale.svelte.ts` does import), so this edge only ever points one way.
 *  In a component the `locale.current` read inside `t` also makes the call reactive, so a
 *  language switch re-renders sizes along with everything else. */
export function formatSize(bytes: number): string {
  const trim = (n: number, dp: number) => String(parseFloat(n.toFixed(dp)));
  if (!Number.isFinite(bytes)) return "—";
  const u = locale.t.shared.units;
  const fmt = (n: string, unit: string) => `${n}${u.space}${unit}`;
  if (bytes >= 1073741824) return fmt(trim(bytes / 1073741824, 2), u.gb);
  if (bytes >= 1048576) return fmt(trim(bytes / 1048576, 2), u.mb);
  if (bytes >= 1024) return fmt(trim(bytes / 1024, 2), u.kb);
  return fmt(String(Math.round(bytes)), u.b);
}

/** Bare kilobyte NUMBER (not a formatted string) — `<1` below 512 B. Deliberately NOT routed
 *  through the locale: it returns a NUMBER, and the unit is the caller's business. The
 *  call sites that used to append a hardcoded `KB` next to it now use `formatSize` or
 *  `formatSizePair` instead; only `DumpSection` still pairs it with a translated
 *  `progressLabel(...)` string function that names the unit itself. */
export const kb = (n: number): number | string => (n > 0 && n < 512) ? "<1" : Math.round(n / 1024);

/** A `value/max` byte counter that names the unit ONCE, on the total: `1.6/3.4 MB`,
 *  `137/137 KB`, `900/1024 B`. The artboard (`GuidedFlashing.dc.html`) draws it bracketed as
 *  `[1.6/3.4 MB]`; the brackets are the caller's, the pair is this. One decimal for KB/MB/GB
 *  (so a moving counter doesn't jitter through two decimal places) and none for bytes —
 *  deliberately fixed-precision, unlike `formatSize`, because both halves must share a scale.
 *  The unit label and the number/unit separator come from the active locale (`shared.units`),
 *  so French reads `1,6/3,4 Mo`-style units (`o`/`Ko`/`Mo`/`Go`) like every other size. */
export function formatSizePair(value: number, max: number, sep: string = "/"): string {
  const u = locale.t.shared.units;
  const [unit, div] = max >= 1073741824 ? [u.gb, 1073741824]
    : max >= 1048576 ? [u.mb, 1048576]
    : max >= 1024 ? [u.kb, 1024]
    : [u.b, 1];
  const n = (v: number) => String(parseFloat((v / div).toFixed(div === 1 ? 0 : 1)));
  return `${n(value)}${sep}${n(max)}${u.space}${unit}`;
}

/** Local-time `YYYY-MM-DD HH:MM:SS` timestamp (e.g. `2026-07-03 17:14:13`) for log lines. */
export function timestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
