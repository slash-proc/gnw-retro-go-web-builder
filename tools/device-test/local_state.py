"""Machine-local storage. Recipes may be committed; runtime data never is."""
from pathlib import Path
import json
import re
import shutil
import uuid
import subprocess
import socket
import os

ROOT = Path(__file__).resolve().parents[2]

def local_root(config):
    value = Path(config.get("dev_local", "./dev-local")).expanduser()
    return (ROOT / value).resolve()

def reports_root(config):
    return local_root(config) / "reports"

def name(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", value):
        raise ValueError("Names must be 1–64 letters, digits, dots, underscores or dashes")
    return value

def profile_path(config, kind, value):
    return local_root(config) / f"{kind}-profiles" / name(value)

def copy_state(source, destination):
    """Publish complete copies atomically; never overwrite a seed or snapshot."""
    if destination.exists():
        raise ValueError(f"Already exists: {destination}")
    if not source.is_dir():
        raise ValueError(f"Missing source: {source}")
    # Chromium must be stopped before copying its databases and permission store.
    ensure_stopped(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.parent / f".copy-{uuid.uuid4().hex}"
    try:
        shutil.copytree(source, staging, symlinks=True,
                        ignore=shutil.ignore_patterns("SingletonLock", "SingletonSocket", "SingletonCookie"))
        staging.rename(destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

def ensure_stopped(source):
    """Detect live local/container users; a stopped container may leave stale links."""
    browser=(source/'browser').resolve()
    lock=browser/'SingletonLock'
    if lock.is_symlink():
        host,_,pid=os.readlink(lock).rpartition('-')
        if host==socket.gethostname() and pid.isdigit():
            try:os.kill(int(pid),0)
            except ProcessLookupError:pass
            else:raise ValueError(f'Close Chromium before copying {source}')
    ids=subprocess.run(['docker','ps','-q'],capture_output=True,text=True,check=True).stdout.split()
    if ids:
        rows=json.loads(subprocess.run(['docker','inspect',*ids],capture_output=True,text=True,check=True).stdout)
        for row in rows:
            for mount in row.get('Mounts',[]):
                path=Path(mount['Source']).resolve()
                if path==browser or path.is_relative_to(browser):
                    raise ValueError(f'Profile is mounted by running container {row["Name"]}; stop it first')

def migrate(config):
    """Move existing ignored artifacts once; preserve old report links."""
    root = local_root(config)
    root.mkdir(parents=True, exist_ok=True)
    legacy = ROOT / "build" / "device-test"
    for old, new in ((legacy / "profiles", root / "browser-profiles"),
                     (legacy / "gwemu-profiles", root / "gwemu-profiles"),
                     (legacy / "cache", root / "cache"),
                     (ROOT / "device-test-reports", root / "reports")):
        if old.exists() and not old.is_symlink():
            if new.exists():
                raise ValueError(f"Migration would overwrite {new}; merge it explicitly first")
            shutil.move(str(old), str(new))
            if old.name == "device-test-reports":
                old.symlink_to(new, target_is_directory=True)
    if legacy.exists():
        runs = root / "runs"
        runs.mkdir(exist_ok=True)
        for old in legacy.iterdir():
            if re.fullmatch(r"\d{8}-\d{6}-[0-9a-f]+", old.name) and not (runs / old.name).exists():
                shutil.move(str(old), str(runs / old.name))
    return root
