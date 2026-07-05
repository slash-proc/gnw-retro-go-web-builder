#!/usr/bin/env python3
"""Supplement <system>.json with games missing from the xlsx source, sourced from
references/libretro-database's per-system .cht files (Game Genie / GameShark tagged
only — untagged files use an incompatible raw address:value format).
Existing <system>.json entries are never touched or merged into; this only ADDS games
that aren't already present. Stdlib only.
Re-run: python3 apps/web/src/lib/cheats/ingest_libretro.py
"""
import os, re, json

ROOT = "references/libretro-database/cht"
JSON_DIR = "apps/web/src/lib/cheats"
META_JSON = os.path.join(JSON_DIR, "cheatsMeta.json")

# One entry per target system: json key -> libretro-database folder name(s).
SYSTEMS = {
    "gb": ["Nintendo - Game Boy", "Nintendo - Game Boy Color"],
    "nes": ["Nintendo - Nintendo Entertainment System"],
}

TAG_RE = re.compile(r"\s*\([^)]*\)")
CODE_RE = re.compile(r"^[A-Za-z0-9\-]+(\s*\+\s*[A-Za-z0-9\-]+)*$")

REGION_PRIORITY = ["world", "usa, europe", "usa", "europe", "japan, usa", "japan"]


def norm(t: str) -> str:
    """Must mirror ingest.py's norm() / index.ts's normalizeTitle() exactly."""
    t = re.sub(r"\([^)]*\)", "", t).lower()
    t = re.sub(r"^(the|a)\s+", "", t)
    return re.sub(r"[^a-z0-9]", "", t)


def filename_to_title(fname: str) -> str:
    name = fname[:-4]  # strip .cht
    name = TAG_RE.sub("", name).strip()
    # comma-inversion: "Addams Family, The" / "Legend of Zelda, The - Link's Awakening DX"
    name = re.sub(r"^(.*?), (The|A|An)\b", r"\2 \1", name)
    return name.strip()


def region_rank(fname: str) -> int:
    tags = re.findall(r"\(([^)]*)\)", fname)
    for tag in tags:
        low = tag.lower()
        for i, pref in enumerate(REGION_PRIORITY):
            if pref in low:
                return i
    return len(REGION_PRIORITY)


def parse_cht(path: str):
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    descs = dict(re.findall(r'cheat(\d+)_desc\s*=\s*"([^"]*)"', text))
    codes = dict(re.findall(r'cheat(\d+)_code\s*=\s*"([^"]*)"', text))
    out = []
    for k in sorted(codes, key=int):
        code = codes[k].strip()
        if not code or not CODE_RE.match(code):
            continue
        out.append({"code": code, "effect": descs.get(k, "").strip()})
    return out


def ingest_system(system_key: str, folders: list):
    json_path = os.path.join(JSON_DIR, f"{system_key}.json")
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    existing_keys = {g["key"] for g in data}

    # candidates: key -> list of (fname, fullpath, title)
    candidates = {}
    skipped_untagged = 0
    skipped_existing = 0
    for folder in folders:
        d = os.path.join(ROOT, folder)
        for fname in os.listdir(d):
            if not fname.endswith(".cht"):
                continue
            if "(Game Genie)" not in fname and "(GameShark)" not in fname:
                skipped_untagged += 1
                continue
            title = filename_to_title(fname)
            key = norm(title)
            if key in existing_keys:
                skipped_existing += 1
                continue
            candidates.setdefault(key, []).append((fname, os.path.join(d, fname), title))

    def sort_key(item):
        fname, _, _ = item
        is_diff = 1 if "(diff)" in fname else 0
        is_gameshark = 1 if "(Game Genie)" not in fname else 0  # prefer Game Genie
        return (is_diff, region_rank(fname), is_gameshark, fname)

    added = []
    skipped_parse_empty = 0
    for key, files in candidates.items():
        files.sort(key=sort_key)
        fname, path, title = files[0]
        cheats = parse_cht(path)
        if not cheats:
            skipped_parse_empty += 1
            continue
        added.append({"title": title, "key": key, "cheats": cheats})

    added.sort(key=lambda g: g["title"].lower())
    out = data + added
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    return {
        "before": len(data),
        "added": len(added),
        "after": out,
        "skipped_untagged": skipped_untagged,
        "skipped_existing": skipped_existing,
        "skipped_parse_empty": skipped_parse_empty,
    }


def main():
    with open(META_JSON, encoding="utf-8") as f:
        meta = json.load(f)

    for system_key, folders in SYSTEMS.items():
        result = ingest_system(system_key, folders)
        out = result["after"]
        total_codes = sum(len(g["cheats"]) for g in out)
        meta["counts"][system_key] = {"games": len(out), "codes": total_codes}
        meta[f"{system_key}Note"] = (
            f"{system_key}.json also incorporates Game Genie/GameShark-tagged entries "
            "from references/libretro-database (games missing from the xlsx source "
            "only; existing xlsx-sourced entries were never touched or merged) — see "
            "ingest_libretro.py."
        )

        print(f"=== {system_key} ===")
        print(f"before: {result['before']} games")
        print(f"added:  {result['added']} games")
        print(f"after:  {len(out)} games, {total_codes} total codes")
        print(f"skipped (untagged, incompatible format): {result['skipped_untagged']}")
        print(f"skipped (already present):               {result['skipped_existing']}")
        print(f"skipped (tagged file had no valid codes): {result['skipped_parse_empty']}")
        print()

    with open(META_JSON, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
