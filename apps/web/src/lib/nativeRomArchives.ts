/** Serializable scan policy: native cartridge archives are files, not ROM wrappers. */
export interface NativeArchiveRules {
  folders: readonly string[];
  loose: boolean;
}

export function isNativeRomArchive(path: string, rules?: NativeArchiveRules): boolean {
  if (!rules || !/\.zip$/i.test(path)) return false;
  const parts = path.toLowerCase().split("/");
  if (parts[0] === "roms") parts.shift();
  return parts.length === 1 ? rules.loose : rules.folders.includes(parts[0]);
}
