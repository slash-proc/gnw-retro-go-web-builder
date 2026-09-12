/**
 * Install locations, taken from the firmware's own manifest rather than hardcoded here.
 *
 * `manifest.json.paths` (docs/FIRMWARE_DIST.md, section `paths`) is the firmware's
 * declaration of where each role lives:
 *
 *   { "cores": "/cores", "homebrew": "/homebrews", "bios": "/bios", "roms": "/roms",
 *     "covers": "/covers", "cheats": "/cheats", "data": "/data" }
 *
 * Three rules from that document drive this module:
 *
 *  1. **Values are absolute from the storage root** (`/roms`), while every key we build
 *     internally is relative to it (`roms/nes/x.nes`). The leading slash is stripped
 *     ONCE, HERE, in `normalizeRole()` — nowhere else in fs-builders or apps/web may a
 *     manifest path be sliced, joined or trimmed. Everything downstream sees a plain
 *     relative directory with no leading and no trailing separator, so callers always
 *     join with a single explicit `"/"` (see `under()`).
 *
 *  2. **The object is open** — a later firmware may name a role this one does not. Unknown
 *     roles are carried through untouched (`extra`), never refused.
 *
 *  3. **A role we need may be absent.** Absent ⇒ fall back to `DEFAULT_INSTALL_PATHS`, the
 *     literal this code used before the manifest existed. Rationale: the schema does not
 *     mark individual roles required, and the doc explicitly says to ignore a role you do
 *     not use — so "absent" carries no intent, it is just a manifest that didn't mention
 *     it. Falling back reproduces exactly today's behaviour, which is strictly better than
 *     refusing to install against an older or slimmer manifest. `undefined/nes/x.nes` is
 *     impossible: every role on `InstallPaths` is a non-optional string.
 *
 * A *present but malformed* value is the opposite case: it carries intent, and the intent
 * is unusable. Those are REFUSED (`InstallPathError`), never sanitised into a guess — a
 * path is third-party data here, and silently repairing `../../x` is exactly the bug class
 * validation exists to stop.
 */

/** Thrown when a manifest declares a role whose value cannot be used as a storage path. */
export class InstallPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallPathError";
  }
}

/** The roles this codebase installs into. Relative to the storage root, no leading/trailing "/". */
export interface InstallPaths {
  /** Emulator/core binaries (they go to the LittleFS partition, not FrogFS). */
  cores: string;
  /** Homebrew binaries. NOTE the firmware names this directory `/homebrews`, plural. */
  homebrew: string;
  bios: string;
  roms: string;
  covers: string;
  cheats: string;
  data: string;
  /** Roles the firmware declared that this codebase has no use for, normalized the same way. */
  extra: Readonly<Record<string, string>>;
}

/**
 * What each role was hardcoded to before `manifest.paths` existed. Used ONLY as the
 * per-role fallback for a role the manifest does not declare (see the header note).
 */
export const DEFAULT_INSTALL_PATHS: Readonly<InstallPaths> = Object.freeze({
  cores: "cores",
  homebrew: "roms/homebrew",
  bios: "bios",
  roms: "roms",
  covers: "covers",
  cheats: "cheats",
  data: "data",
  extra: Object.freeze({}),
});

const KNOWN_ROLES: readonly string[] = Object.keys(DEFAULT_INSTALL_PATHS).filter(
  (k) => k !== "extra",
);

/** Control characters, spelled with escapes so the source stays plain ASCII. */
const CONTROL = /[\u0000-\u001f\u007f]/;
const SAFE_SEGMENT_CHARS = /^[A-Za-z0-9._\-/]+$/;

/**
 * The ONE place a manifest storage path becomes an internal relative key.
 * Refuses anything that is not a plain absolute directory under the storage root.
 */
function normalizeRole(role: string, raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InstallPathError(`paths.${role}: expected a string, got ${typeof raw}`);
  }
  const bad = (why: string): never => {
    throw new InstallPathError(`paths.${role}: ${why} (${JSON.stringify(raw)})`);
  };
  if (CONTROL.test(raw)) bad("contains a control character");
  if (raw.includes("\\")) bad("contains a backslash");
  if (!raw.startsWith("/")) bad("not absolute from the storage root");
  // Strip the leading slash exactly once, then any trailing separator. `"/"` itself (the
  // storage root) is not a usable install directory for any role, so it is refused rather
  // than collapsing to "" and yielding a rootless `nes/x.nes`.
  const rel = raw.slice(1).replace(/\/+$/, "");
  if (rel === "") bad("names the storage root, not a directory");
  for (const seg of rel.split("/")) {
    if (seg === "") bad("has an empty path segment");
    if (seg === "." || seg === "..") bad("has a relative segment");
  }
  if (!SAFE_SEGMENT_CHARS.test(rel)) bad("has a character outside [A-Za-z0-9._-] and /");
  return rel;
}

/**
 * Resolve a manifest `paths` object into the relative directories this code installs into.
 * An absent object (or an absent role) falls back to `DEFAULT_INSTALL_PATHS`; any
 * declared-but-malformed value throws `InstallPathError`.
 */
export function resolveInstallPaths(raw?: Readonly<Record<string, unknown>> | null): InstallPaths {
  const out = { ...DEFAULT_INSTALL_PATHS } as InstallPaths;
  const extra: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [role, value] of Object.entries(raw)) {
      const rel = normalizeRole(role, value);
      if (KNOWN_ROLES.includes(role)) {
        (out as unknown as Record<string, string>)[role] = rel;
      } else {
        extra[role] = rel;
      }
    }
  }
  out.extra = Object.freeze(extra);
  return Object.freeze(out);
}

/** Join a resolved role directory with a relative remainder. Exactly one separator. */
export const under = (dir: string, rest: string): string => `${dir}/${rest}`;
