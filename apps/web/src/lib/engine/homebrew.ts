/**
 * Homebrew title manifest (HAND-MAINTAINED — owner: "we gotta maintain the list in that way").
 *
 * Homebrew are native apps, not emulated ROMs. Their on-device files are GENERATED at build time:
 * an engine `.bin` (shipped in the firmware bundle) + restool assets derived from a user-supplied
 * source ROM. So they DON'T map 1:1 to a folder file and must not be treated as removable games.
 * Example: a `zelda3.sfc` in the ROM folder yields `zelda3.ro` + `Zelda 3.bin` on the device.
 *
 * A title is COMPLETE only if ALL its `deviceFiles` are present in the device FrogFS; a partial set
 * means it needs a re-install. Actually GENERATING the assets (restool) is the deferred homebrew
 * module — this list is its data foundation + lets the games comparison treat homebrew correctly.
 *
 * deviceFiles live under `roms/homebrew/`. sourceRoms are the folder file(s) the user supplies.
 */
export interface HomebrewTitle {
  /** Stable id. */
  key: string;
  label: string;
  /** User-supplied source ROM filename(s) under the ROM folder (empty = no ROM needed). */
  sourceRoms: string[];
  /** Files expected under roms/homebrew/ on the device once installed. */
  deviceFiles: string[];
}

export const HOMEBREW_TITLES: HomebrewTitle[] = [
  // Self-contained — no user ROM needed.
  { key: "celeste", label: "Celeste", sourceRoms: [], deviceFiles: ["celeste.bin"] },
  // zelda3.sfc → zelda3_assets.dat + zelda3.ro + Zelda 3.bin
  {
    key: "zelda3",
    label: "Zelda 3 (A Link to the Past)",
    sourceRoms: ["zelda3.sfc"],
    deviceFiles: ["zelda3_assets.dat", "zelda3.ro", "Zelda 3.bin"],
  },
  {
    key: "smw",
    label: "Super Mario World",
    sourceRoms: ["smw.sfc"],
    deviceFiles: ["smw_assets.dat", "Super Mario World.bin"],
  },
];

/** Every filename we recognize as belonging to a homebrew title (under roms/homebrew/). */
export const HOMEBREW_DEVICE_FILES: ReadonlySet<string> = new Set(
  HOMEBREW_TITLES.flatMap((t) => t.deviceFiles),
);

/** Completeness of each homebrew title given the set of homebrew filenames present on the device. */
export function homebrewStatus(
  presentDeviceFiles: Iterable<string>,
): { title: HomebrewTitle; present: number; complete: boolean }[] {
  const present = new Set(presentDeviceFiles);
  return HOMEBREW_TITLES.map((title) => {
    const have = title.deviceFiles.filter((f) => present.has(f)).length;
    return { title, present: have, complete: have === title.deviceFiles.length && have > 0 };
  }).filter((s) => s.present > 0);
}
