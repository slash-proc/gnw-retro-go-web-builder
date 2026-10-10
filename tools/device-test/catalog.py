"""User-facing test names and ordered suites; kept out of runtime plumbing."""
TESTS = {
    "overview/status": {},
    "firmware/guided-setup": {},
    "sources/directories-persist": {"native": True, "description": "Read native saved handles after restarting Chromium"},
    "overview/navigation": {"spec": "tests/navigation-smoke.spec.mjs", "scope": "app-only"},
    "overview/status-page-retro-go": {"device": True},
    "overview/status-page-locked": {"device": True},
    "overview/status-page-unlocked": {"device": True},
    "sources/add-directories": {"spec": "tests/directory-sources.spec.mjs", "scope": "full", "directory": True},
    "sources/add-ofw-backup": {"directory": True},
    "library/settle": {"spec": "tests/library-sources.spec.mjs", "scope": "full", "session": True},
    "library/sync-tetris": {"spec": "tests/library-sync.spec.mjs", "scope": "tetris-smoke", "sync": True, "device": True},
    "firmware/dualboot-install": {"spec": "tests/dualboot-install.spec.mjs", "scope": "full", "install": True, "device": True},
    "firmware/advanced-panes": {"spec": "tests/advanced-panes.spec.mjs", "scope": "app-only", "device": True},
    "firmware/device-backup": {"device": True},
    "firmware/device-patch-unlock": {"device": True},
}
LOCKED_FLOW = ["overview/status-page-locked", "sources/add-ofw-backup", "firmware/device-backup",
               "firmware/device-patch-unlock", "overview/status-page-unlocked"]
SUITES = {
    "directory-source-seed": {"tests": ["sources/directories-persist"], "seed": True},
    "directory-source-resume": {"tests": ["sources/directories-persist"]},
    "locked-backup-patch": {"tests": LOCKED_FLOW},
    "full-library": {"tests": ["sources/add-directories", "library/settle"]},
    "navigation": {"tests": ["overview/navigation"]},
    "dualboot-install": {"tests": ["firmware/dualboot-install"]},
    "retro-go-ready": {"tests": ["overview/status-page-retro-go"]},
    "library-sync": {"tests": ["overview/status-page-retro-go", "library/sync-tetris"]},
}

def expand(tests, suites):
    return expand_ordered([*(('test', test) for test in tests), *(('suite', suite) for suite in suites)])

def expand_ordered(items):
    result = []
    for kind, name in items:
        if kind == 'test':
            if name not in TESTS:
                raise ValueError(f"Unknown test {name!r}; use --list-tests")
            result.append(name)
            continue
        suite = name
        if suite not in SUITES:
            raise ValueError(f"Unknown suite {suite!r}; use --list-suites")
        result.extend(SUITES[suite]["tests"])
    return result
