"""Suggest device-test workflows from a Git base-to-worktree diff.

This is deliberately advisory: it does not run tests or change the normal CI gate.
Symbol extraction is a lightweight declaration heuristic, not a language parser.
"""
import argparse
import fnmatch
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from catalog import SUITES, TESTS


RULES = [
    {
        "paths": [
            "apps/web/src/lib/device.svelte.ts",
            "apps/web/src/lib/engine/**",
            "tools/device-test/device.mjs",
            "tools/device-test/workflows/status.mjs",
            "tools/remote-gdb/**",
        ],
        "tests": ["overview/status-page-retro-go", "overview/status-page-locked", "overview/status-page-unlocked"],
        "suites": ["retro-go-ready", "locked-backup-patch", "dualboot-install"],
        "commands": ["npm --prefix apps/web run check:targetreconnect"],
        "reason": "Connection, adapter, or target-liveness behavior can affect every device-backed workflow.",
    },
    {
        "paths": [
            "apps/web/src/lib/firmware/**",
            "apps/web/src/lib/views/Wizard.svelte",
            "apps/web/src/lib/views/Advanced.svelte",
            "apps/web/src/lib/installProgress.svelte.ts",
            "apps/web/src/lib/device.svelte.ts",
            "tools/device-test/workflows/backup.mjs",
            "tools/device-test/workflows/patch.mjs",
            "tools/device-test/workflows/retro-go.mjs",
        ],
        "tests": ["firmware/device-backup", "firmware/device-patch-unlock", "firmware/dualboot-install"],
        "suites": ["locked-backup-patch", "dualboot-install"],
        "commands": ["npm --prefix apps/web run check:core-workflows"],
        "reason": "Firmware writes should exercise the locked backup/unlock path and the install path.",
    },
    {
        "paths": [
            "apps/web/src/lib/sources/**",
            "apps/web/src/lib/views/Sources.svelte",
            "tools/device-test/workflows/sources.mjs",
            "tools/device-test/tests/directory-sources.spec.mjs",
            "tools/device-test/tests/native-directory-seed.spec.mjs",
        ],
        "tests": ["sources/directories-persist", "sources/add-directories", "sources/add-ofw-backup"],
        "suites": ["directory-source-resume", "full-library"],
        "commands": ["npm --prefix apps/web run check:localfolders"],
        "reason": "Source handles, grants, and scanning are covered by the persistence and full-library flows.",
    },
    {
        "paths": [
            "apps/web/src/lib/firmwareDist/**",
            "apps/web/src/lib/ui/RetroGoRepositories.svelte",
            "apps/web/src/lib/ui/AddSourcesModal.svelte",
            "apps/web/src/lib/advanced/RomSection.svelte",
            "apps/web/src/lib/views/Wizard.svelte",
            "apps/web/test/firmwarerepositories.mjs",
            "apps/web/test/curatedsources.mjs",
            "apps/web/test/firmwarecutover.mjs",
        ],
        "tests": ["sources/included-in", "sources/retro-go-config"],
        "suites": ["remote-sources"],
        "commands": [
            "npm --prefix apps/web run check:firmwarerepositories",
            "npm --prefix apps/web run check:firmwarecutover",
            "npm --prefix apps/web run check:curatedsources",
        ],
        "reason": "Retro-Go repositories feed the source catalogue, Advanced installs, and Guided Setup; verify repository configuration navigation and Core/Homebrew inclusion provenance.",
    },
    {
        "paths": [
            "apps/web/src/lib/library.svelte.ts",
            "apps/web/src/lib/libraryPerformance.ts",
            "apps/web/src/lib/ui/GeometryBar.svelte",
            "apps/web/src/lib/sources/coreRegistry.ts",
            "apps/web/src/lib/sources/carouselAtlas.ts",
            "apps/web/src/lib/sources/carouselAtlasWorker.ts",
            "apps/web/src/lib/ui/Carousel.svelte",
            "apps/web/src/lib/views/RomManagementTab.svelte",
            "tools/device-test/workflows/library.mjs",
            "tools/device-test/workflows/retro-go.mjs",
        ],
        "tests": ["library/settle", "library/sync-tetris"],
        "suites": ["full-library", "library-sync"],
        "commands": ["npm --prefix apps/web run check:core-workflows", "npm --prefix apps/web run check:libraryscan"],
        "reason": "Collection changes need a large-library settle; device-sync changes also need the UI sync flow.",
    },
    {
        "paths": [
            "apps/web/src/App.svelte",
            "apps/web/src/lib/views/OverviewTab.svelte",
            "apps/web/src/lib/views/Wizard.svelte",
            "tools/device-test/workflows/navigation.mjs",
            "tools/device-test/workflows/guided-setup.mjs",
            "tools/device-test/workflows/status.mjs",
        ],
        "tests": ["overview/navigation", "overview/status", "firmware/guided-setup"],
        "suites": ["navigation"],
        "reason": "Primary tabs and dependent Overview panes should be checked through their shared navigation flow.",
    },
    {
        "paths": ["tools/device-test/**", "apps/web/test/**", "apps/web/package.json"],
        "tests": [],
        "suites": [],
        "reason": "Harness changes can invalidate multiple scenarios; run the full app check and relevant composed suite.",
        "commands": ["npm --prefix apps/web run check"],
    },
    {
        "paths": ["tools/device-test/tests/navigation-smoke.spec.mjs", "tools/device-test/workflows/navigation.mjs"],
        "tests": ["overview/navigation"],
        "suites": ["navigation"],
        "reason": "The navigation smoke test covers primary tabs and the required Overview-to-pane path.",
    },
    {
        "paths": ["tools/device-test/tests/library-sources.spec.mjs", "tools/device-test/workflows/library.mjs"],
        "tests": ["library/settle"],
        "suites": ["full-library"],
        "reason": "The composed library test verifies sources and waits for the complete collection to settle.",
    },
    {
        "paths": ["tools/device-test/tests/library-sync.spec.mjs"],
        "tests": ["library/sync-tetris"],
        "suites": ["library-sync"],
        "reason": "The test exercises Library-to-device synchronization on Retro-Go.",
    },
    {
        "paths": ["tools/device-test/tests/dualboot-install.spec.mjs"],
        "tests": ["firmware/dualboot-install"],
        "suites": ["dualboot-install"],
        "reason": "The spec covers the UI-driven stock-to-dual-boot install workflow.",
    },
    {
        "paths": ["tools/device-test/tests/pristine-backup-unlock.spec.mjs", "tools/device-test/workflows/backup.mjs", "tools/device-test/workflows/patch.mjs"],
        "tests": ["overview/status-page-locked", "sources/add-ofw-backup", "firmware/device-backup", "firmware/device-patch-unlock", "overview/status-page-unlocked"],
        "suites": ["locked-backup-patch"],
        "reason": "These changes belong to the locked stock backup, patch/unlock, return-to-stock, and unlocked Status sequence.",
    },
    {
        "paths": ["tools/device-test/tests/advanced-panes.spec.mjs"],
        "tests": ["firmware/advanced-panes"],
        "suites": [],
        "reason": "The Advanced pane test opens each firmware pane without performing destructive operations.",
    },
    {
        "paths": ["tools/device-test/scenarios/shared-device-scenario.mjs", "tools/device-test/tests/native-session.spec.mjs"],
        "tests": ["firmware/device-backup", "firmware/device-patch-unlock", "firmware/dualboot-install", "library/sync-tetris", "library/settle", "sources/directories-persist"],
        "suites": ["locked-backup-patch", "dualboot-install", "library-sync", "full-library", "directory-source-resume"],
        "reason": "The shared scenario/session dispatcher composes several critical workflows; run each affected end-to-end path.",
    },
    {
        "paths": ["tools/device-test/tests/browser-instrumentation.spec.mjs", "apps/web/src/lib/auditLog.svelte.ts", "apps/web/test/auditlog.mjs"],
        "tests": ["overview/status"],
        "suites": [],
        "reason": "Audit capture should be checked in a real Status run; its high-volume capture probe is a separate browser diagnostic.",
        "commands": ["npm --prefix apps/web run check:auditlog", "npm --prefix apps/web run check"],
    },
]

SYMBOL_RULES = [
    {
        "pattern": r"reconnect|connectRemoteProbe|passiveLiveness|targetAlive|attachStlink",
        "tests": ["overview/status-page-retro-go", "overview/status-page-locked"],
        "suites": ["retro-go-ready", "locked-backup-patch", "dualboot-install"],
        "commands": ["npm --prefix apps/web run check:targetreconnect"],
        "reason": "A changed connection/liveness symbol needs a device-return or reconnect scenario.",
    },
    {
        "pattern": r"backupLockedStock|patchStockFirmware|unlock|flash|writeImage|erase|dumpFirmware",
        "tests": ["firmware/device-backup", "firmware/device-patch-unlock", "firmware/dualboot-install"],
        "suites": ["locked-backup-patch", "dualboot-install"],
        "commands": ["npm --prefix apps/web run check:core-workflows"],
        "reason": "A changed firmware mutation symbol needs backup/unlock and install coverage.",
    },
    {
        "pattern": r"syncLibraryItem|waitForLibrarySettled|prepareCarouselAtlas|loadCover|scanLibrary|reconcileLibrary",
        "tests": ["library/settle", "library/sync-tetris"],
        "suites": ["full-library", "library-sync"],
        "commands": ["npm --prefix apps/web run check:libraryscan"],
        "reason": "A changed library pipeline symbol needs both large-collection and device-sync coverage.",
    },
    {
        "pattern": r"addDirectorySource|openDirectorySources|directoryHandle|requestPermission|isPersisted",
        "tests": ["sources/directories-persist", "sources/add-directories"],
        "suites": ["directory-source-resume", "full-library"],
        "commands": ["npm --prefix apps/web run check:localfolders"],
        "reason": "A changed directory permission/handle symbol needs persistence and real-source coverage.",
    },
]


DECLARATIONS = [
    re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)"),
    re.compile(r"^\s*(?:export\s+)?class\s+([\w$]+)"),
    re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^\n]*\)|[\w$]+)\s*=>)"),
    re.compile(r"^\s*(?:async\s+)?def\s+([\w$]+)\s*\("),
    re.compile(r"^\s*class\s+([\w$]+)\b"),
]


def git(*args, check=True):
    result = subprocess.run(["git", *args], text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result


def changed_files(base):
    result = git("diff", "--name-only", "-z", "--find-renames", base, "--", check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"Could not diff against {base!r}")
    paths = {p for p in result.stdout.split("\0") if p}
    extra = git("ls-files", "--others", "--exclude-standard", "-z")
    paths.update(p for p in extra.stdout.split("\0") if p)
    return sorted(paths)


def diff_symbols(base, path):
    """Find declaration names near changed lines in both old and new versions."""
    diff = git("diff", "--no-ext-diff", "--no-color", "--unified=0", base, "--", path)
    if diff.returncode:
        return set()
    current = Path(path)
    new_lines = current.read_text(errors="replace").splitlines() if current.is_file() else []
    tracked = git("ls-files", "--error-unmatch", "--", path, check=False).returncode == 0
    if not tracked:
        return {match.group(1) for line in new_lines for pattern in DECLARATIONS
                if (match := pattern.match(line))}
    old_result = git("show", f"{base}:{path}", check=False)
    old_lines = old_result.stdout.splitlines() if old_result.returncode == 0 else []
    symbols = set()
    old_at = new_at = 0
    for line in diff.stdout.splitlines():
        match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if match:
            old_at, new_at = int(match.group(1)), int(match.group(2))
            symbols.update(_nearby_symbols(old_lines, old_at))
            symbols.update(_nearby_symbols(new_lines, new_at))
            continue
        if line.startswith("+") and not line.startswith("+++"):
            symbols.update(_declaration_symbols(line[1:]))
            new_at += 1
        elif line.startswith("-") and not line.startswith("---"):
            symbols.update(_declaration_symbols(line[1:]))
            old_at += 1
        elif not line.startswith("\\"):
            old_at += 1
            new_at += 1
    return symbols


def _nearby_symbols(lines, line_number, distance=100):
    start = max(0, min(len(lines), line_number - 1) - distance)
    end = max(0, min(len(lines), line_number - 1))
    for line in reversed(lines[start:end]):
        for pattern in DECLARATIONS:
            match = pattern.match(line)
            if match:
                return {match.group(1)}
    return set()


def _declaration_symbols(line):
    for pattern in DECLARATIONS:
        match = pattern.match(line)
        if match:
            return {match.group(1)}
    return set()


def matching_rules(path, symbols):
    matches = []
    for rule in RULES:
        if not any(fnmatch.fnmatchcase(path, glob) for glob in rule["paths"]):
            continue
        matches.append(rule)
    return matches


def matching_symbol_rules(symbols):
    return [rule for rule in SYMBOL_RULES
            if any(re.search(rule["pattern"], symbol, re.I) for symbol in symbols)]


def validate_rules():
    for rule in RULES:
        unknown_tests = set(rule["tests"]) - set(TESTS)
        unknown_suites = set(rule["suites"]) - set(SUITES)
        if unknown_tests or unknown_suites:
            raise RuntimeError(f"Recommendation rule for {rule['paths']!r} references unknown catalog entries: "
                               f"tests={sorted(unknown_tests)}, suites={sorted(unknown_suites)}")
    for rule in SYMBOL_RULES:
        unknown_tests = set(rule["tests"]) - set(TESTS)
        unknown_suites = set(rule["suites"]) - set(SUITES)
        if unknown_tests or unknown_suites:
            raise RuntimeError(f"Symbol recommendation rule {rule['pattern']!r} references unknown catalog entries: "
                               f"tests={sorted(unknown_tests)}, suites={sorted(unknown_suites)}")


def recommend(base):
    validate_rules()
    verified = git("rev-parse", "--verify", f"{base}^{{commit}}", check=False)
    if verified.returncode:
        raise RuntimeError(f"Base {base!r} is not an available commit/ref. Fetch it first if it is remote.")
    files = changed_files(base)
    result = {"base": base, "files": [], "tests": defaultdict(set), "suites": defaultdict(set), "commands": defaultdict(set), "unmapped": []}
    for path in files:
        symbols = diff_symbols(base, path)
        item = {"path": path, "symbols": sorted(symbols)}
        result["files"].append(item)
        rules = [*matching_rules(path, symbols), *matching_symbol_rules(symbols)]
        if not rules:
            result["unmapped"].append(path)
        for rule in rules:
            for name in rule["tests"]:
                result["tests"][name].add(rule["reason"])
            for name in rule["suites"]:
                result["suites"][name].add(rule["reason"])
            for command in rule.get("commands", []):
                result["commands"][command].add(rule["reason"])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="gw-device-test recommend",
        description="Suggest relevant modular tests from a Git base-to-worktree diff. Suggestions are advisory; no tests are run or skipped.",
    )
    parser.add_argument("--base", required=True, help="Available commit, local branch, or fetched remote ref (for example origin/main)")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args(argv)
    try:
        report = recommend(args.base)
    except (RuntimeError, OSError) as error:
        parser.error(str(error))
    if args.json:
        import json
        report["tests"] = {key: sorted(value) for key, value in report["tests"].items()}
        report["suites"] = {key: sorted(value) for key, value in report["suites"].items()}
        report["commands"] = {key: sorted(value) for key, value in report["commands"].items()}
        print(json.dumps(report, indent=2))
        return 0
    print(f"Base: {args.base}")
    if not report["files"]:
        print("No tracked or untracked changes found.")
    else:
        print(f"Changed files: {len(report['files'])}")
        for item in report["files"]:
            symbols = ", ".join(item["symbols"]) if item["symbols"] else "symbols not identified"
            print(f"  {item['path']} — {symbols}")
    print("\nSuggested suites:")
    if report["suites"]:
        for name, reasons in sorted(report["suites"].items()):
            print(f"  --suite {name}")
            for reason in sorted(reasons):
                print(f"    {reason}")
    else:
        print("  No mapped suite.")
    print("\nSuggested individual tests:")
    if report["tests"]:
        for name, reasons in sorted(report["tests"].items()):
            print(f"  --test {name}")
            for reason in sorted(reasons):
                print(f"    {reason}")
    else:
        print("  No mapped test.")
    if report["commands"]:
        print("\nAdditional validation:")
        for command in sorted(report["commands"]):
            print(f"  {command}")
    if report["unmapped"]:
        print("\nNo specific test mapping for:")
        for path in report["unmapped"]:
            print(f"  {path}")
    print("\nAdvisory only: this does not run tests or replace the normal broad validation gate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
