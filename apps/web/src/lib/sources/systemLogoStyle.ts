/** Return a themeable mask style scaled to a consistent display height. */
export function systemLogoStyle(dataUrl: string, height: number): string {
  const encodedSvg = dataUrl.slice(dataUrl.indexOf(",") + 1);
  let header = "";
  try {
    header = decodeURIComponent(encodedSvg.split("%3Cpath")[0] ?? "");
  } catch {
    // Keep a sensible ratio if a persisted value was truncated or malformed.
  }
  const dimensions = /viewBox="0 0 (\d+) (\d+)"/.exec(header);
  const width = Number(dimensions?.[1]);
  const sourceHeight = Number(dimensions?.[2]);
  const aspect = width > 0 && sourceHeight > 0 ? width / sourceHeight : 1.5;
  const displayWidth = Math.max(1, Math.round(height * aspect));
  return `--system-logo: url("${dataUrl}"); --system-logo-width: ${displayWidth}px; --system-logo-height: ${height}px`;
}
