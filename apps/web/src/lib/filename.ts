/** Match the longest extension declared by a core against the complete filename suffix. */
export function matchFilenameExtension(
  filename: string,
  declaredExtensions: readonly string[] = [],
): string | undefined {
  const lower = filename.toLowerCase();
  return declaredExtensions
    .map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`)
    .filter((extension) => extension.length > 1 && lower.endsWith(extension))
    .sort((a, b) => b.length - a.length)[0];
}

/** Return a declared full suffix when available, otherwise the final filename suffix. */
export function filenameExtension(
  filename: string,
  declaredExtensions: readonly string[] = [],
): string {
  const declared = matchFilenameExtension(filename, declaredExtensions);
  if (declared) return declared;
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

/** Remove the complete declared extension from a filename-derived title. */
export function stripFilenameExtension(
  filename: string,
  declaredExtensions: readonly string[] = [],
): string {
  const suffix = filenameExtension(filename, declaredExtensions);
  return suffix ? filename.slice(0, -suffix.length) : filename;
}

/** Match firmware's path rule: remove only the final filename suffix. */
export function stripFinalFilenameExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}
