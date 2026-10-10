#!/usr/bin/env python3
"""Prepare a published Retro-Go release and run the browser/device smoke test."""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import queue
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

import yaml
from local_state import local_root, reports_root

ROOT = Path(__file__).resolve().parents[2]
BANK_SIZE = 256 * 1024
EXTFLASH_SIZE = 64 * 1024 * 1024
SD_SIZE = 256 * 1024 * 1024
PARTITION_OFFSET = 2048  # sectors (1 MiB), the firmware's expected MBR layout


def run(args, **kwargs):
    print("+", " ".join(map(str, args)), flush=True)
    return subprocess.run(args, check=True, **kwargs)


def run_core_workflow_checks(report):
    """Run the fast Node checks for backup, flash, install, and Library logic."""
    command = ["docker", "compose", "exec", "-T", "dev", "npm", "run", "check:core-workflows", "--workspace", "@gnw/web"]
    print("+", " ".join(command), flush=True)
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    output = result.stdout + result.stderr
    (report / "core-workflow-checks.log").write_text(output, encoding="utf-8")
    if output:
        print(output, end="" if output.endswith("\n") else "\n", flush=True)
    if result.returncode:
        raise RuntimeError(f"Core non-browser workflow checks failed; see {report / 'core-workflow-checks.log'}")
    return {"status": "passed", "command": "npm run check:core-workflows --workspace @gnw/web", "log": "core-workflow-checks.log"}


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def free_ports(count):
    """Choose distinct ephemeral ports without releasing earlier choices first."""
    sockets = []
    try:
        ports = []
        for _ in range(count):
            sock = socket.socket()
            sock.bind(("127.0.0.1", 0))
            sockets.append(sock)
            ports.append(sock.getsockname()[1])
        return ports
    finally:
        for sock in sockets:
            sock.close()


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "gnw-device-test/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "gnw-device-test/1"})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as out:
        shutil.copyfileobj(response, out)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_release(config, cache):
    spec = config.get("retro_go", {})
    index_url = spec.get(
        "versions_url",
        "https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/versions.json",
    )
    index = fetch_json(index_url)
    versions = index.get("versions", [])
    wanted = spec.get("version", "latest")
    version = next((item for item in versions if wanted == "latest" or item.get("tag") == wanted), None)
    if not version:
        raise RuntimeError(f"Retro-Go release {wanted!r} is not in {index_url}")
    manifest_url = urllib.parse.urljoin(index_url, version["manifest"])
    manifest = fetch_json(manifest_url)
    build_id = spec.get("build", "sd-bank1")
    build = next((item for item in manifest.get("builds", []) if item.get("id") == build_id), None)
    if not build:
        raise RuntimeError(f"build {build_id!r} is missing from {manifest_url}")
    bundle_meta = build["bundle"]
    bundle_url = urllib.parse.urljoin(manifest_url, bundle_meta["url"])
    bundle = cache / Path(urllib.parse.urlparse(bundle_url).path).name
    if not bundle.exists():
        download(bundle_url, bundle)
    if bundle.stat().st_size != bundle_meta["bytes"] or sha256(bundle) != bundle_meta["sha256"]:
        bundle.unlink(missing_ok=True)
        raise RuntimeError("Downloaded release bundle does not match its published size/SHA-256")

    output = cache / "release-media"
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())

        def extract(entry, destination):
            member = entry["path"]
            path = PurePosixPath(member)
            if path.is_absolute() or ".." in path.parts or member not in names:
                raise RuntimeError(f"Unsafe or missing bundle member: {member}")
            data = archive.read(member)
            if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise RuntimeError(f"Bundle member failed published hash check: {member}")
            target = output / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            return target

        firmware = extract(build["image"], "retro-go-intflash.bin")
        elf_member = "debug/retro-go-debug.elf"
        if elf_member not in names:
            raise RuntimeError("Published bundle has no matching debug ELF")
        elf = output / "gw_retro_go.elf"
        elf.write_bytes(archive.read(elf_member))
        for entry in build.get("content", []):
            install = PurePosixPath(entry["install"].lstrip("/"))
            if install.is_absolute() or ".." in install.parts:
                raise RuntimeError(f"Unsafe SD install path: {entry['install']}")
            extract(entry, Path("sd-content") / Path(*install.parts))

    return {
        "tag": version["tag"], "build": build_id, "manifest_url": manifest_url,
        "bundle_url": bundle_url, "bundle_sha256": sha256(bundle),
        "firmware_sha256": sha256(firmware), "elf_sha256": sha256(elf),
        "firmware": firmware, "elf": elf, "content": output / "sd-content",
    }


def write_media(release, run_dir):
    bank1 = run_dir / "qemu_bank1.bin"
    raw = release["firmware"].read_bytes()
    if len(raw) > BANK_SIZE:
        raise RuntimeError(f"firmware image is larger than one flash bank ({len(raw)} bytes)")
    bank1.write_bytes(raw.ljust(BANK_SIZE, b"\0"))
    (run_dir / "qemu_bank2.bin").write_bytes(bytes(BANK_SIZE))
    with (run_dir / "extflash.bin").open("wb") as stream:
        stream.truncate(EXTFLASH_SIZE)
    sd = run_dir / "sdcard.img"
    with sd.open("wb") as stream:
        stream.truncate(SD_SIZE)
        mbr = bytearray(512)
        start = PARTITION_OFFSET
        sectors = SD_SIZE // 512 - start
        mbr[446:462] = bytes((0, 0xFF, 0xFF, 0xFF, 0x0C, 0xFF, 0xFF, 0xFF)) + start.to_bytes(4, "little") + sectors.to_bytes(4, "little")
        mbr[510:512] = b"\x55\xaa"
        stream.seek(0)
        stream.write(mbr)
    spec = f"{sd}@@1M"
    run(["mformat", "-i", spec, "-F", "-v", "RETROGO", "::"])
    entries = sorted(release["content"].iterdir())
    if entries:
        run(["mcopy", "-i", spec, "-s", *map(str, entries), "::/"])
    shutil.copy2(release["elf"], run_dir / "gw_retro_go.elf")


def write_stock_media(backup_dirs, run_dir):
    """Compatibility adapter: provisioning belongs to gwprov, including legacy runs."""
    from provisioning import gwprov_command
    instance = run_dir / ('stock-profile-' + uuid.uuid4().hex)
    command = [*gwprov_command({}), 'profile', 'stock', str(instance)]
    for folder in backup_dirs:
        command += ['--backup-dir', str(folder)]
    run(command)
    provenance = json.loads((instance / 'provision.json').read_text())
    return {**provenance, 'bank1': instance / 'bank1.bin',
            'bank2': instance / 'bank2.bin', 'extflash': instance / 'extflash.bin'}


def provision_gwemu_profile(config_path, profile_name, state, replace=False):
    """Provision reusable GWemu media without using the app's install UI."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", profile_name):
        raise RuntimeError("GWemu profile names must be 1-64 letters, digits, dots, underscores or dashes")
    if state not in {"stock", "retro-go"}:
        raise RuntimeError("GWemu profile state must be 'stock' or 'retro-go'")
    config = load_config(config_path)
    profile_dir = local_root(config) / "gwemu-profiles" / profile_name
    if profile_dir.exists():
        if not replace:
            raise RuntimeError(f"GWemu profile already exists: {profile_dir}; use --replace-gwemu-profile to rebuild it")
        shutil.rmtree(profile_dir)
    profile_dir.mkdir(parents=True)
    if state == "retro-go":
        for tool in ("mformat", "mcopy"):
            if not shutil.which(tool):
                raise RuntimeError(f"Required executable is missing: {tool}")
        cache = local_root(config) / "cache"
        cache.mkdir(parents=True, exist_ok=True)
        release = resolve_release(config, cache)
        write_media(release, profile_dir)
        manifest = {"schemaVersion": 1, "name": profile_name, "state": state,
                    "release": {key: value for key, value in release.items()
                                if key not in {"firmware", "elf", "content"}}}
    else:
        backups = [Path(value).expanduser().resolve() for value in config.get("ofw_backups", [])]
        if not backups or any(not folder.is_dir() for folder in backups):
            raise RuntimeError(f"{config_path}: configure valid ofw_backups directories for a stock GWemu profile")
        stock = write_stock_media(backups, profile_dir)
        shutil.copy2(stock["bank1"], profile_dir / "qemu_bank1.bin")
        shutil.copy2(stock["bank2"], profile_dir / "qemu_bank2.bin")
        shutil.copy2(stock["extflash"], profile_dir / "extflash.bin")
        manifest = {"schemaVersion": 1, "name": profile_name, "state": state,
                    "model": stock["model"], "internal_sha256": stock["internal_sha256"],
                    "external_sha256": stock["external_sha256"]}
    (profile_dir / "profile.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"GWemu profile ready: {profile_dir} ({state})")
    return profile_dir


def wait_http(url, process=None, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError("GDB bridge exited before becoming ready")
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {url}")


def wait_tcp(port, process=None, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError("GDB bridge exited before becoming ready")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for TCP port {port}")


def prune_reports(reports_dir, keep_count, reserve_new_report=True):
    """Keep the newest completed run reports, preserving any live run directory."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    # Native-session reports use a random hex suffix; older reports used a
    # descriptive suffix such as "directory-persistence". Both are reports
    # and count toward the same retention limit.
    run_id_pattern = re.compile(r"\d{8}-\d{6}-.+$")
    completed = []
    active = 0
    for report in reports_dir.iterdir():
        if not report.is_dir() or report.is_symlink() or not run_id_pattern.fullmatch(report.name):
            continue
        try:
            pid = int((report / ".runner.pid").read_text(encoding="ascii").strip())
            os.kill(pid, 0)
            active += 1
            continue
        except (OSError, ValueError):
            pass
        metadata_path = report / "run.json"
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if metadata.get("run") and metadata["run"] != report.name:
                    continue
            except (OSError, ValueError):
                pass  # a crashed or incomplete report folder is still prunable
        completed.append(report)
    completed.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    reserved = 1 if reserve_new_report else 0
    completed_to_keep = max(0, keep_count - active - reserved)
    for stale in completed[completed_to_keep:]:
        try:
            shutil.rmtree(stale)
        except PermissionError:
            # Older browser containers ran with an unmapped UID and left report
            # assets owned by nobody. Reuse the already-built test image's root
            # user to remove only this validated, direct child run directory.
            image = "gnw-device-test-chromium:latest"
            available = subprocess.run(["docker", "image", "inspect", image],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if available.returncode:
                raise RuntimeError(
                    f"Cannot prune {stale}: it contains files owned by an unmapped container user. "
                    f"Run a browser test once to build {image}, then prune reports again."
                )
            subprocess.run(["docker", "run", "--rm", "--user", "0:0", "-v",
                            f"{reports_dir}:/reports", "--entrypoint", "/bin/rm", image,
                            "-rf", f"/reports/{stale.name}"], check=True)


def load_config(path):
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def docker_memory_mb(container):
    result = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", container],
        capture_output=True, text=True,
    )
    if result.returncode:
        return None
    match = re.match(r"\s*([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)", result.stdout)
    if not match:
        return None
    scale = {"B": 1 / 1_000_000, "KiB": 1024 / 1_000_000,
             "MiB": 1024**2 / 1_000_000, "GiB": 1024**3 / 1_000_000,
             "kB": 1 / 1000, "MB": 1, "GB": 1000}
    return float(match.group(1)) * scale[match.group(2)]


def docker_chromium_memory_mb(container):
    """Sum Chromium process RSS and proportional set size, excluding Playwright's Node workers."""
    result = subprocess.run(
        ["docker", "exec", container, "sh", "-c",
         'for p in /proc/[0-9]*; do '
         'comm=$(cat "$p/comm" 2>/dev/null) || continue; '
         'case "$comm" in chrome*|chromium*) '
         'rss=$(awk \'/^VmRSS:/ {print $2}\' "$p/status" 2>/dev/null); '
         'pss=$(awk \'/^Pss:/ {print $2}\' "$p/smaps_rollup" 2>/dev/null); '
         'cmd=$(tr "\\000" " " < "$p/cmdline" 2>/dev/null | cut -c1-180); '
         'printf "%s %s %s %s %s\\n" "${p##*/}" "$comm" "${rss:-0}" "${pss:-0}" "$cmd";; esac; done'],
        capture_output=True, text=True,
    )
    if result.returncode:
        return None, None, []
    rss_kb = 0
    pss_kb = 0
    rows = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) < 4 or not fields[1].lower().startswith(("chrome", "chromium")):
            continue
        try:
            rss, pss = int(fields[2]), int(fields[3])
            rss_kb += rss
            pss_kb += pss
            rows.append({"pid": int(fields[0]), "name": fields[1], "rss_mb": round(rss / 1000, 1),
                         "pss_mb": round(pss / 1000, 1), "command": " ".join(fields[4:])})
        except (ValueError, IndexError):
            continue
    if not rows:
        return None, None, []
    return rss_kb / 1000, (pss_kb / 1000 if pss_kb else None), rows


def docker_process_smaps(container, pid):
    """Capture native memory categories for a Chromium process while it is alive."""
    result = subprocess.run(
        ["docker", "exec", container, "cat", f"/proc/{pid}/smaps_rollup"],
        capture_output=True, text=True,
    )
    if result.returncode:
        return None
    values = {}
    for line in result.stdout.splitlines():
        match = re.match(r"^(Rss|Pss|Pss_Anon|Pss_File|Pss_Shmem|Shared_Clean|Shared_Dirty|Private_Clean|Private_Dirty|Anonymous|AnonHugePages|Swap):\s+(\d+) kB$", line)
        if match:
            values[match.group(1)] = round(int(match.group(2)) / 1000, 1)
    return values or None


def embed_playwright_report_assets(report):
    """Write Playwright's own report as one file, with image assets inlined."""
    index = report / "html" / "index.html"
    source = index.read_text(encoding="utf-8")
    marker = '<template id="playwrightReportBase64">data:application/zip;base64,'
    start = source.find(marker)
    if start < 0:
        raise RuntimeError(f"Playwright report has no embedded data archive: {index}")
    start += len(marker)
    end = source.find("</template>", start)
    if end < 0:
        raise RuntimeError(f"Playwright report has a truncated data archive: {index}")

    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(source[start:end])))
    rewritten = io.BytesIO()

    def inline_attachments(value):
        if isinstance(value, dict):
            content_type = value.get("contentType", "")
            path = value.get("path", "")
            if content_type.startswith("image/") and path.startswith("data/"):
                asset = report / "html" / path
                if not asset.is_file():
                    raise RuntimeError(f"Playwright report attachment is missing: {asset}")
                encoded = base64.b64encode(asset.read_bytes()).decode("ascii")
                value["path"] = f"data:{content_type};base64,{encoded}"
            for child in value.values():
                inline_attachments(child)
        elif isinstance(value, list):
            for child in value:
                inline_attachments(child)

    with zipfile.ZipFile(rewritten, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for entry in archive.infolist():
            data = archive.read(entry.filename)
            if entry.filename.endswith(".json"):
                parsed = json.loads(data)
                inline_attachments(parsed)
                data = json.dumps(parsed, separators=(",", ":")).encode("utf-8")
            output.writestr(entry.filename, data)
    encoded_archive = base64.b64encode(rewritten.getvalue()).decode("ascii")
    source = source[:start] + encoded_archive + source[end:]
    # Ua() adds report-filter query params to same-origin links. A data URL must
    # be returned untouched or those params corrupt the base64 image payload.
    portable_source = source.replace(
        "function Ua(e){if(!e)return e;try{let t=new URL(e,window.location.href);",
        'function Ua(e){if(!e)return e;if(e.startsWith(`data:`))return e;try{let t=new URL(e,window.location.href);',
        1,
    )
    if portable_source == source:
        raise RuntimeError("Playwright report URL helper changed; cannot safely inline screenshot URLs")
    source = portable_source
    (report / "playwright-report.html").write_text(source, encoding="utf-8")


def run_directory_source_check(config_path, skip_app_start, full_scan=True, install_e2e=False,
                               profile_name=None, source_scope="full", gwemu_profile=None,
                               test_spec="tests/library-sources.spec.mjs",
                               reset_browser_profile=False, keep_reports=10, headed=False,
                               gwemu_gui_binary=None, keep_target=False, pristine_backup=False,
                               backup_unlock_only=False, skip_fast_checks=False,
                               library_sync_e2e=False, capture_gwemu_profile=None,
                               replace_gwemu_profile=False, browser="chromium",
                               gwemu_binary=None, browser_instrumentation="off"):
    """Run a browser workflow with persistent app and optional GWemu profiles."""
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if pristine_backup and not install_e2e:
        raise RuntimeError("--pristine-device-e2e requires the dual-boot install flow")
    if backup_unlock_only and not pristine_backup:
        raise RuntimeError("--pristine-backup-unlock-e2e requires a pristine locked-device run")
    if library_sync_e2e and (not gwemu_profile or install_e2e or pristine_backup):
        raise RuntimeError("--library-sync-e2e requires a prepared Retro-Go GWemu profile and cannot be combined with install flows")
    if capture_gwemu_profile and (not install_e2e or pristine_backup or library_sync_e2e):
        raise RuntimeError("--capture-gwemu-profile requires --dualboot-install-e2e and cannot capture a pristine backup-only or sync run")
    if capture_gwemu_profile and not (gwemu_binary or gwemu_gui_binary):
        raise RuntimeError("--capture-gwemu-profile requires --gwemu-binary or --gwemu-gui-binary; the headless Docker image deliberately discards its scratch flash copy")
    captured_profile_dir = local_root(config) / "gwemu-profiles" / capture_gwemu_profile if capture_gwemu_profile else None
    if captured_profile_dir and captured_profile_dir.exists() and not replace_gwemu_profile:
        raise RuntimeError(f"GWemu profile already exists: {captured_profile_dir}; use --replace-gwemu-profile to replace it")
    if library_sync_e2e and source_scope != "tetris-smoke":
        raise RuntimeError("--library-sync-e2e requires --source-scope tetris-smoke to keep this feature test isolated")
    scenario_requirements = {
        "tests/pristine-backup-unlock.spec.mjs": backup_unlock_only,
        "tests/dualboot-install.spec.mjs": install_e2e and not backup_unlock_only,
        "tests/library-sync.spec.mjs": library_sync_e2e,
        "tests/library-sources.spec.mjs": not install_e2e and not library_sync_e2e,
        "tests/directory-sources.spec.mjs": not install_e2e and not library_sync_e2e,
    }
    if test_spec in scenario_requirements and not scenario_requirements[test_spec]:
        raise RuntimeError(f"Playwright scenario {test_spec} does not match the selected runner workflow")
    if pristine_backup and (profile_name or gwemu_profile):
        raise RuntimeError("--pristine-device-e2e uses a fresh backup output directory and cannot resume browser or GWemu profiles")
    sections = ("roms", "firmware_bios", "ofw_backups")
    profile_defaults = {
        "full": {"groups": list(sections)},
        "roms-bios": {"groups": ["roms", "firmware_bios"]},
        "roms-only": {"groups": ["roms"]},
        "tetris-smoke": {"groups": ["roms"], "scan": "bounded"},
        "app-only": {"groups": []},
    }
    if source_scope not in profile_defaults:
        raise RuntimeError(f"Unknown source scope {source_scope!r}; available: {', '.join(sorted(profile_defaults))}")
    groups = ["ofw_backups"] if backup_unlock_only else list(sections)
    profile_state_path = None
    browser_profile_dir = None
    browser_profile_existed = False
    profile_state = None
    profile_config = {}
    if profile_name:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", profile_name):
            raise RuntimeError("Profile names must be 1-64 letters, digits, dots, underscores or dashes")
        profile_config = profile_defaults[source_scope]
        groups = profile_config.get("groups", list(sections))
        if (not isinstance(groups, list)
                or any(not isinstance(group, str) for group in groups)
                or len(set(groups)) != len(groups) or set(groups) - set(sections)):
            raise RuntimeError(f"Profile {profile_name!r} must name unique groups from: {', '.join(sections)}")
        if profile_config.get("scan") == "bounded":
            full_scan = False
        profile_dir = local_root(config) / "browser-profiles" / profile_name
        if reset_browser_profile and profile_dir.exists():
            shutil.rmtree(profile_dir)
        profile_state_path = profile_dir / "profile.json"
        browser_profile_dir = profile_dir / "browser"
        browser_profile_existed = browser_profile_dir.is_dir()
        if profile_state_path.is_file():
            profile_state = json.loads(profile_state_path.read_text(encoding="utf-8"))
            if profile_state.get("schemaVersion") != 1:
                raise RuntimeError(f"Unsupported browser profile schema in {profile_state_path}")
            if profile_state.get("sourceScope", "full") != source_scope:
                raise RuntimeError(f"Browser profile {profile_name!r} has a different source scope; delete {profile_state_path} to reprovision")

    configured_directories = {}
    for section in sections:
        if section not in groups:
            configured_directories[section] = []
            continue
        values = config.get(section)
        if not isinstance(values, list) or not values:
            raise RuntimeError(f"{config_path}: {section} must be a non-empty list of directories")
        resolved = []
        for value in values:
            directory = Path(value).expanduser().resolve()
            if not directory.is_dir():
                raise RuntimeError(f"{config_path}: directory does not exist: {directory}")
            resolved.append(directory)
        configured_directories[section] = resolved

    directories = {section: configured_directories[section] if section in groups else [] for section in sections}
    directory_map = []
    for section in sections:
        for source in directories[section]:
            source_id = f"source-{len(directory_map)}"
            directory_map.append({"id": source_id, "group": section, "path": str(source), "name": source.name})
    if profile_state:
        if profile_state.get("directories") != directory_map:
            raise RuntimeError(
                f"Browser profile {profile_name!r} was provisioned with different source paths. "
                f"Delete {profile_state_path} to provision it again."
            )
        bindings = profile_state.get("folderBindings")
        folders = profile_state.get("folders")
        expected_sources = {source["id"] for source in directory_map}
        if not isinstance(bindings, list) or not isinstance(folders, list):
            raise RuntimeError(f"Browser profile {profile_name!r} is missing its folder metadata; delete {profile_state_path} to reprovision")
        bound_sources = [row.get("sourceId") for row in bindings if isinstance(row, dict)]
        bound_folder_ids = [row.get("folderId") for row in bindings if isinstance(row, dict)]
        folder_ids = [row.get("id") for row in folders if isinstance(row, dict)]
        if (len(bindings) != len(directory_map)
                or any(not isinstance(value, str) or not value for value in bound_sources + bound_folder_ids + folder_ids)
                or set(bound_sources) != expected_sources
                or len(set(bound_folder_ids)) != len(bound_folder_ids)
                or set(bound_folder_ids) != set(folder_ids)):
            raise RuntimeError(f"Browser profile {profile_name!r} has inconsistent folder associations; delete {profile_state_path} to reprovision")
    tetris = next((directory / "Game Boy" / "Tetris.zip" for directory in directories["roms"]
                   if (directory / "Game Boy" / "Tetris.zip").is_file()), None)
    library_spec = test_spec in {"tests/library-sources.spec.mjs", "tests/directory-sources.spec.mjs"}
    rom_workflow_spec = library_spec or test_spec in {"tests/dualboot-install.spec.mjs", "tests/library-sync.spec.mjs"}
    if rom_workflow_spec and not backup_unlock_only and tetris is None:
        raise RuntimeError("The Library source workflow requires Game Boy/Tetris.zip in a configured ROM directory")
    spec_path = (ROOT / "tools" / "device-test" / test_spec).resolve()
    if not spec_path.is_relative_to(ROOT / "tools" / "device-test") or not spec_path.is_file():
        raise RuntimeError(f"Unknown Playwright spec: {test_spec}")

    reports = reports_root(config)
    prune_reports(reports, keep_reports)
    # The runner and container clocks can differ; use a long random suffix so
    # a fresh report never reuses an incomplete Docker-owned report directory.
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:16]
    report = reports / run_id
    while report.exists():
        run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:16]
        report = reports / run_id
    report.mkdir()
    (report / ".runner.pid").write_text(f"{os.getpid()}\n", encoding="ascii")
    scenario = {
        "tests/navigation-smoke.spec.mjs": "navigation-smoke",
        "tests/pristine-backup-unlock.spec.mjs": "pristine-backup-unlock",
        "tests/library-sync.spec.mjs": "library-sync-tetris",
        "tests/directory-sources.spec.mjs": "directory-source-check",
    }.get(test_spec)
    if test_spec == "tests/dualboot-install.spec.mjs":
        scenario = "pristine-device-install-tetris" if pristine_backup else "dualboot-install-tetris"
    elif test_spec == "tests/library-sources.spec.mjs":
        scenario = "full-library-session" if full_scan else "library-tetris-smoke"
    scenario = scenario or "custom-browser-spec"
    metadata = {"run": run_id, "scenario": scenario, "status": "running",
                "test_spec": test_spec, "source_scope": source_scope,
                "browser_instrumentation": browser_instrumentation,
                "full_library_scan": bool(full_scan),
                "directories": {key: [str(p) for p in value] for key, value in directories.items()},
                "test_rom": str(tetris) if tetris else None}
    if profile_name:
        metadata["browser_profile"] = profile_name
        metadata["browser_profile_reused"] = browser_profile_existed
        metadata["directory_sources_re_registered"] = profile_state is not None
    if gwemu_profile:
        metadata["gwemu_profile"] = gwemu_profile
        metadata["test_spec"] = test_spec
    (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")

    processes = []
    target_container = None
    target_gui_process = None
    run_dir = local_root(config) / "runs" / run_id
    try:
        if not shutil.which("docker"):
            raise RuntimeError("Required executable is missing: docker")
        run_dir.mkdir(parents=True, exist_ok=True)
        app_url = os.environ.get("GNW_TEST_APP_URL", "http://127.0.0.1:3000")
        if not skip_app_start:
            run(["docker", "compose", "up", "-d", "dev"], cwd=ROOT)
        wait_http(app_url)
        metadata["core_workflow_checks"] = ({"status": "skipped"} if skip_fast_checks
                                            else run_core_workflow_checks(report))
        (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")

        adapter_port = qmp_port = None
        target_enabled = install_e2e or gwemu_profile is not None
        target_media_dir = None
        target_files = None
        if gwemu_profile:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", gwemu_profile):
                raise RuntimeError("GWemu profile names must be 1-64 letters, digits, dots, underscores or dashes")
            profile_media_dir = local_root(config) / "gwemu-profiles" / gwemu_profile
            manifest_path = profile_media_dir / "profile.json"
            if not manifest_path.is_file():
                raise RuntimeError(f"GWemu profile is not provisioned: {profile_media_dir}; use --prepare-gwemu-profile")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("schemaVersion") != 1 or manifest.get("name") != gwemu_profile:
                raise RuntimeError(f"Invalid GWemu profile manifest: {manifest_path}")
            if install_e2e and manifest.get("state") != "stock":
                raise RuntimeError("--dualboot-install-e2e requires a stock GWemu profile")
            if library_sync_e2e and manifest.get("state") != "retro-go":
                raise RuntimeError("--library-sync-e2e requires a GWemu profile provisioned in retro-go state")
            # Sync changes extflash and SD media. Keep the prepared profile pristine by
            # running every sync against a disposable copy in this report's run directory.
            if library_sync_e2e:
                target_media_dir = run_dir / "gwemu-media"
                shutil.copytree(profile_media_dir, target_media_dir)
                metadata["gwemu_profile_working_copy"] = True
            else:
                target_media_dir = profile_media_dir
            target_files = {"bank1": target_media_dir / "qemu_bank1.bin",
                            "bank2": target_media_dir / "qemu_bank2.bin",
                            "extflash": target_media_dir / "extflash.bin",
                            "sdcard": target_media_dir / "sdcard.img"}
            missing = [str(target_files[key]) for key in ("bank1", "bank2", "extflash")
                       if not target_files[key].is_file()]
            if missing:
                raise RuntimeError(f"GWemu profile {gwemu_profile!r} is incomplete: {', '.join(missing)}")
            metadata["gwemu_state"] = manifest.get("state")
        elif install_e2e:
            stock_backup_dirs = directories["ofw_backups"]
            stock = write_stock_media(stock_backup_dirs, run_dir)
            metadata["stock_device"] = {"model": stock["model"], "internal_sha256": stock["internal_sha256"],
                                        "external_sha256": stock["external_sha256"]}
            (report / "stock-device.json").write_text(json.dumps(metadata["stock_device"], indent=2) + "\n")
            target_media_dir = run_dir
            target_files = {"bank1": stock["bank1"], "bank2": stock["bank2"], "extflash": stock["extflash"]}
            if pristine_backup:
                backup_output = report / "backup-output"
                backup_output.mkdir(parents=True, exist_ok=True)
                directories["ofw_backups"] = [backup_output]
                metadata["fresh_backup_output"] = str(backup_output)
                metadata["rdp_locked_at_start"] = True
                metadata["scenario"] = ("directory-sources-to-pristine-backup-unlock"
                                         if backup_unlock_only else
                                         "directory-sources-to-pristine-backup-unlock-dualboot-install-tetris")
                metadata["directories"] = {key: [str(p) for p in value] for key, value in directories.items()}
        if gwemu_gui_binary and (not headed or not target_enabled):
            raise RuntimeError("--gwemu-gui-binary requires --headed and a target-backed scenario")
        if gwemu_binary and not target_enabled:
            raise RuntimeError("--gwemu-binary requires a target-backed scenario")
        if gwemu_binary and gwemu_gui_binary:
            raise RuntimeError("Use only one of --gwemu-binary and --gwemu-gui-binary")
        if target_enabled:
            qmp_port, gdb_port, adapter_port = free_ports(3)
            target_cfg = config.get("targets", {}).get("gwemu", {})
            target_image = target_cfg.get("image", "slashproc/gwemu-headless:latest")
            if gwemu_gui_binary or gwemu_binary:
                host_binary = Path(gwemu_gui_binary or gwemu_binary).expanduser().resolve()
                if not host_binary.is_file() or not os.access(host_binary, os.X_OK):
                    raise RuntimeError(f"GWemu executable is missing or not executable: {host_binary}")
                target_log = (report / ("gwemu-gui.log" if gwemu_gui_binary else "gwemu-host.log")).open("w", encoding="utf-8")
                gui_config = report / "gwemu.toml"
                display = "gwemu" if gwemu_gui_binary else "none"
                target_cmd = [str(host_binary), "-M", "gnw-h7b0", "-display", display]
                if gwemu_gui_binary:
                    gui_config.write_text("[general]\nshow_welcome = false\nactive_profile = ''\n", encoding="utf-8")
                    target_cmd.extend(["-config_path", str(gui_config)])
                target_cmd.extend(["-global", f"gnw-h7b0-soc.bank1-image={target_files['bank1']}",
                                   "-global", f"gnw-h7b0-soc.bank2-image={target_files['bank2']}",
                                   "-global", f"gnw-h7b0-soc.extflash-image={target_files['extflash']}"])
                if pristine_backup:
                    target_cmd.extend(["-global", "gnw-h7b0-soc.rdp-locked=on",
                                       "-global", f"gnw-h7b0-soc.rdp-image={run_dir / 'rdp-state.bin'}"])
                if target_files.get("sdcard") and target_files["sdcard"].is_file():
                    target_cmd.extend(["-drive", f"if=sd,file={target_files['sdcard']}"])
                target_cmd.extend(["-qmp", f"tcp:127.0.0.1:{qmp_port},server=on,wait=off",
                                   "-gdb", f"tcp:127.0.0.1:{gdb_port},server=on,wait=off",
                                   "-audiodev", "none,id=snd0", "-global", "gnw-h7b0-sai1.audiodev=snd0"])
                host_env = os.environ.copy()
                if gwemu_gui_binary:
                    host_env.setdefault("SDL_VIDEODRIVER", "x11")
                host_process = subprocess.Popen(target_cmd, cwd=ROOT, env=host_env, stdout=target_log,
                                                stderr=subprocess.STDOUT)
                target_gui_process = host_process
                processes.append(host_process)
            else:
                run(["docker", "pull", target_image])
                target_container = "gnw-profile-e2e-" + run_id
                # Keep this container for its logs and cleanup diagnostics.
                target_cmd = ["docker", "run", "-d", "--name", target_container,
                              "-p", f"127.0.0.1:{gdb_port}:1234", "-p", f"127.0.0.1:{qmp_port}:4444",
                              "-v", f"{target_media_dir}:/images", "-v", f"{report}:/out", target_image,
                              "--bank1", f"/images/{target_files['bank1'].name}",
                              "--bank2", f"/images/{target_files['bank2'].name}",
                              "--extflash", f"/images/{target_files['extflash'].name}"]
                if target_files.get("sdcard") and target_files["sdcard"].is_file():
                    target_cmd.extend(["--sd", "/images/sdcard.img"])
                if pristine_backup:
                    target_cmd.append("--rdp-locked")
                target_cmd.extend(["--qmp-port", "4444", "--", "-s"])
                run(target_cmd, stdout=subprocess.PIPE, text=True)
            wait_tcp(qmp_port, timeout=45)
            wait_tcp(gdb_port, timeout=45)
            bridge = subprocess.Popen([sys.executable, str(ROOT / "tools/remote-gdb/gnw_remote.py"),
                                       "--bind", "127.0.0.1", "--port", str(adapter_port),
                                       "--gdb-host", "127.0.0.1", "--gdb-port", str(gdb_port),
                                       "--emulate-interrupt", "--trace-rsp"],
                                      cwd=ROOT, stdout=(report / "gdb-bridge.log").open("w"), stderr=subprocess.STDOUT)
            processes.append(bridge)
            wait_tcp(adapter_port, bridge)
            if bridge.poll() is not None:
                raise RuntimeError("GDB bridge failed to bind its configured port")

        image = "gnw-device-test-browser:local"
        run(["docker", "build", "-t", image, str(ROOT / "tools/device-test")], cwd=ROOT)
        mounts = []
        env = ["-e", f"GNW_TEST_APP_URL={app_url}", "-e", "GNW_TEST_REPORT_DIR=/reports",
               "-e", f"GNW_TEST_FULL_DIRECTORY_SCAN={int(full_scan)}",
               "-e", f"GNW_TEST_BROWSER={browser}"]
        display_mounts = []
        if headed:
            wayland_display = os.environ.get("WAYLAND_DISPLAY")
            runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
            if not wayland_display or not runtime_dir:
                raise RuntimeError("--headed requires an active Wayland session (WAYLAND_DISPLAY and XDG_RUNTIME_DIR)")
            wayland_socket = Path(runtime_dir) / wayland_display
            if not wayland_socket.exists():
                raise RuntimeError(f"Wayland display socket does not exist: {wayland_socket}")
            env.extend(["-e", "GNW_TEST_HEADLESS=0", "-e", "GNW_TEST_WAYLAND=1",
                        "-e", f"XDG_RUNTIME_DIR={runtime_dir}", "-e", f"WAYLAND_DISPLAY={wayland_display}"])
            display_mounts.extend(["-v", f"{wayland_socket}:{wayland_socket}"])
        if install_e2e:
            env.extend(["-e", "GNW_TEST_INSTALL_E2E=1", "-e", "GNW_TEST_INPUT_MODE=qmp"])
        if library_sync_e2e:
            env.append("-e")
            env.append("GNW_TEST_LIBRARY_SYNC=1")
        if pristine_backup:
            env.append("-e")
            env.append("GNW_TEST_PRISTINE_BACKUP=1")
        if backup_unlock_only:
            env.extend(["-e", "GNW_TEST_BACKUP_UNLOCK_ONLY=1"])
        if target_enabled:
            env.extend(["-e", "GNW_TEST_ADAPTER_ENABLED=1", "-e", "GNW_TEST_ADAPTER_HOST=127.0.0.1",
                        "-e", f"GNW_TEST_ADAPTER_PORT={adapter_port}", "-e", f"GNW_TEST_QMP_PORT={qmp_port}"])
        if capture_gwemu_profile:
            env.extend(["-e", f"GNW_TEST_CAPTURE_GWEMU_PROFILE={capture_gwemu_profile}",
                        "-e", "GNW_TEST_GWEMU_IMAGE_FILES=" + json.dumps({key: value.name for key, value in target_files.items()}, separators=(",", ":"))])
            mounts.extend(["-v", f"{target_media_dir}:/images:rw"])
        if gwemu_gui_binary or gwemu_binary:
            env.extend(["-e", "GNW_TEST_QMP_SCREENSHOT=/reports/stock-screen.ppm",
                        "-e", "GNW_TEST_QMP_SCREENSHOT_REPORT_PATH=/reports/stock-screen.ppm"])
            # Host GWemu QMP screendump paths must be host paths. Playwright reads
            # the same mounted report directory at /reports.
            env.extend(["-e", f"GNW_TEST_QMP_HOST_SCREENSHOT_DIR={report}"])
        mounted_directory_map = []
        for section in ("roms", "firmware_bios", "ofw_backups"):
            for source in directories[section]:
                source_id = f"source-{len(mounted_directory_map)}"
                mountpoint = f"/inputs/{source_id}"
                access = "rw" if pristine_backup and section == "ofw_backups" else "ro"
                mounts.extend(["-v", f"{source}:{mountpoint}:{access}"])
                mounted_directory_map.append({"id": source_id, "group": section, "path": mountpoint, "name": source.name})
        env.extend(["-e", "GNW_TEST_DIRECTORY_MAP=" + json.dumps(mounted_directory_map, separators=(",", ":"))])
        if profile_name:
            env.extend(["-e", f"GNW_TEST_PROFILE_NAME={profile_name}"])
            browser_profile_dir.mkdir(parents=True, exist_ok=True)
            mounts.extend(["-v", f"{browser_profile_dir}:/browser-profile"])
            env.extend(["-e", "GNW_TEST_BROWSER_PROFILE_DIR=/browser-profile"])
        env.extend(["-e", f"GNW_TEST_SPEC={test_spec}",
                    "-e", f"GNW_TEST_BROWSER_INSTRUMENTATION={browser_instrumentation}"])
        browser_container = "gnw-library-scan-" + run_id
        # Record Chromium proportional resident memory and total container memory separately.
        # Do not stop or cap this diagnostic run: the full uncapped scan is needed to see where
        # all supported library systems and the peak allocations actually land.
        command = ["docker", "run", "--rm", "--name", browser_container, "--network", "host", *env,
                   # Keep report/profile files owned by the host user. The browser image's
                   # default UID is not necessarily mapped to a writable host UID, and root
                   # inside a remapped Docker daemon can appear as nobody on bind mounts.
                   "--user", f"{os.getuid()}:{os.getgid()}", *display_mounts,
                   "-v", f"{report}:/reports", *mounts, image,
                   test_spec]
        memory_log = report / "browser-memory.csv"
        with memory_log.open("w", encoding="utf-8") as samples:
            sample_writer = csv.writer(samples)
            sample_writer.writerow(("elapsed_seconds", "container_memory_mb", "chromium_rss_mb", "chromium_pss_mb", "chromium_processes"))
            started = time.monotonic()
            process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, bufsize=1)
            output_lines = []
            output_queue = queue.Queue()
            def collect_output():
                for line in process.stdout:
                    output_queue.put(line)
                output_queue.put(None)
            output_reader = threading.Thread(target=collect_output, daemon=True)
            output_reader.start()
            peak_mb = 0.0
            container_peak_mb = 0.0
            process_diagnostics_written = False
            output_finished = False
            while process.poll() is None or not output_finished:
                try:
                    while True:
                        line = output_queue.get_nowait()
                        if line is None:
                            output_finished = True
                            break
                        output_lines.append(line)
                        print(line, end="", flush=True)
                except queue.Empty:
                    pass
                if process.poll() is not None and output_finished:
                    break
                usage = (docker_memory_mb(browser_container)
                         if browser_instrumentation == "full" else None)
                if usage is not None:
                    container_peak_mb = max(container_peak_mb, usage)
                    chrome_rss, chrome_pss, chrome_processes = docker_chromium_memory_mb(browser_container)
                    if chrome_pss is not None:
                        if chrome_pss > peak_mb:
                            peak_mb = chrome_pss
                            (report / "browser-peak-processes.json").write_text(json.dumps({
                                "elapsed_seconds": round(time.monotonic() - started, 2),
                                "container_memory_mb": round(usage, 1),
                                "chromium_rss_mb": round(chrome_rss, 1) if chrome_rss is not None else None,
                                "chromium_pss_mb": round(chrome_pss, 1),
                                "processes": sorted(chrome_processes, key=lambda row: row["pss_mb"], reverse=True),
                                "largest_renderer_smaps_mb": docker_process_smaps(
                                    browser_container,
                                    max((row for row in chrome_processes if "--type=renderer" in row["command"]),
                                        key=lambda row: row["pss_mb"], default={}).get("pid", -1),
                                ),
                            }, indent=2) + "\n")
                    sample_writer.writerow((
                        f"{time.monotonic() - started:.2f}", f"{usage:.1f}",
                        f"{chrome_rss:.1f}" if chrome_rss is not None else "",
                        f"{chrome_pss:.1f}" if chrome_pss is not None else "",
                        json.dumps(chrome_processes, separators=(",", ":")),
                    ))
                    samples.flush()
                    if usage >= 300 and not process_diagnostics_written:
                        process_listing = subprocess.run(
                            ["docker", "top", browser_container, "-eo", "pid,rss,comm,args"],
                            capture_output=True, text=True,
                        )
                        (report / "browser-processes.txt").write_text(
                            process_listing.stdout + process_listing.stderr, encoding="utf-8",
                        )
                        process_diagnostics_written = True
                time.sleep(0.5)
            output_reader.join(timeout=1)
            output = "".join(output_lines)
        (report / "playwright.log").write_text(output)
        profile_export = report / "profile-export.json"
        if profile_name and profile_export.is_file():
            exported = json.loads(profile_export.read_text(encoding="utf-8"))
            if exported.get("schemaVersion") != 1 or exported.get("name") != profile_name:
                raise RuntimeError(f"Playwright produced an invalid profile export: {profile_export}")
            profile_state_path.parent.mkdir(parents=True, exist_ok=True)
            profile_state_path.write_text(json.dumps({
                **exported,
                "sourceScope": source_scope,
                "groups": groups,
                "directories": directory_map,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, indent=2) + "\n", encoding="utf-8")
            metadata["browser_profile_saved_to"] = str(profile_state_path)
            (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
        if capture_gwemu_profile:
            snapshot_manifest = report / "gwemu-profile-snapshot" / "profile.json"
            if not snapshot_manifest.is_file():
                raise RuntimeError("Retro-Go install completed without producing the requested GWemu profile marker")
        (report / "exit-code.txt").write_text(f"{process.returncode}\n")
        if browser_instrumentation == "full":
            metadata["browser_peak_memory_mb"] = round(peak_mb, 1)
            metadata["browser_container_peak_memory_mb"] = round(container_peak_mb, 1)
        (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
        if process.returncode:
            raise RuntimeError(f"Playwright failed; see {report}")
        metadata["status"] = "passed"
        (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(f"PASS: report at {report}")
    except Exception as error:
        metadata["status"] = "failed"
        metadata["error"] = str(error)
        (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
        raise
    finally:
        for process in processes:
            if keep_target and process is target_gui_process:
                print(f"GWemu left running for inspection (PID {process.pid}; media {run_dir})", flush=True)
                continue
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        if target_container and not keep_target:
            subprocess.run(["docker", "stop", "--time", "10", target_container],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            logs = subprocess.run(["docker", "logs", target_container], capture_output=True, text=True)
            (report / "gwemu.log").write_text(logs.stdout + logs.stderr, encoding="utf-8")
        if capture_gwemu_profile and not keep_target:
            try:
                snapshot_dir = report / "gwemu-profile-snapshot"
                marker_path = snapshot_dir / "profile.json"
                if not marker_path.is_file() or target_files is None:
                    raise RuntimeError("GWemu install did not produce a profile marker and media paths")
                marker = json.loads(marker_path.read_text(encoding="utf-8"))
                if marker.get("name") != capture_gwemu_profile or marker.get("state") != "retro-go":
                    raise RuntimeError("GWemu profile marker does not match the requested Retro-Go profile")
                copied = {}
                for key, name in (("bank1", "qemu_bank1.bin"), ("bank2", "qemu_bank2.bin"),
                                  ("extflash", "extflash.bin"), ("sdcard", "sdcard.img")):
                    source = target_files.get(key)
                    if source is None or not source.is_file():
                        if key == "sdcard":
                            continue
                        raise RuntimeError(f"GWemu media image was not flushed: {key}")
                    destination = snapshot_dir / name
                    shutil.copy2(source, destination)
                    copied[name] = sha256(destination)
                marker["media_sha256"] = copied
                marker["capturedAfter"] = "qemu-exit-flush-after-published-retro-go-install"
                marker_path.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
                required_snapshot = ("qemu_bank1.bin", "qemu_bank2.bin", "extflash.bin", "profile.json")
                missing_snapshot = [name for name in required_snapshot if not (snapshot_dir / name).is_file()]
                if missing_snapshot:
                    raise RuntimeError(f"GWemu profile snapshot is incomplete: {', '.join(missing_snapshot)}")
                if captured_profile_dir.exists():
                    shutil.rmtree(captured_profile_dir)
                shutil.copytree(snapshot_dir, captured_profile_dir)
                metadata["captured_gwemu_profile"] = str(captured_profile_dir)
            except Exception as error:
                (report / "gwemu-profile-capture-error.txt").write_text(f"{error}\n", encoding="utf-8")
                if metadata.get("status") == "passed":
                    metadata["status"] = "failed"
                    metadata["error"] = f"GWemu profile capture failed: {error}"
        if target_container and not keep_target:
            subprocess.run(["docker", "rm", "-f", target_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (report / "run.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        if not keep_target:
            shutil.rmtree(run_dir, ignore_errors=True)
        if (report / "html" / "index.html").is_file():
            embed_playwright_report_assets(report)
        (report / ".runner.pid").unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "device-test.yaml")
    parser.add_argument("--keep-target", action="store_true",
                        help="leave GWemu and its media running after the test for inspection")
    parser.add_argument("--keep-reports", type=int, default=10,
                        help="number of recent completed reports to retain (default: 10)")
    parser.add_argument("--prune-reports-only", action="store_true",
                        help="prune old reports now and exit without running a test")
    parser.add_argument("--skip-app-start", action="store_true", help="use the already-running app")
    parser.add_argument("--skip-fast-checks", action="store_true",
                        help="skip the Node workflow checks (for app servers outside this Compose project)")
    parser.add_argument("--headed", action="store_true", help="show Chromium on the current Wayland desktop")
    parser.add_argument("--browser-instrumentation", choices=("off", "full"), default="off",
                        help="collect invasive browser profiling only when requested (default: off)")
    parser.add_argument("--browser", choices=("chromium", "firefox", "webkit"), default="chromium",
                        help="Playwright browser engine for this run (default: chromium)")
    parser.add_argument("--gwemu-gui-binary", help="run the interactive GWemu build on the desktop alongside any headed target-backed scenario")
    parser.add_argument("--gwemu-binary", help="run a local GWemu executable headless with persistent file-backed flash")
    parser.add_argument("--directory-sources-only", action="store_true",
                        help="add configured ROM/BIOS/OFW directories, then wait for Library")
    parser.add_argument("--session", action="store_true",
                        help="run the full real-library scan and cover settle baseline once for this testing session")
    parser.add_argument("--dualboot-install-e2e", action="store_true",
                        help="run the supplied-backup patch, Retro-Go install, and Game Boy Tetris scenario")
    parser.add_argument("--capture-gwemu-profile", metavar="NAME",
                        help="save a reusable Retro-Go GWemu profile immediately after the dual-boot install step")
    parser.add_argument("--pristine-device-e2e", action="store_true",
                        help="compose pristine backup/unlock with the dual-boot install flow")
    parser.add_argument("--pristine-backup-unlock-e2e", action="store_true",
                        help="run the fresh locked-device backup and patch/unlock steps, then stop before installing Retro-Go")
    parser.add_argument("--library-sync-e2e", action="store_true",
                        help="sync Game Boy Tetris to a prepared Retro-Go GWemu profile, independently of firmware setup")
    parser.add_argument("--bounded-directory-smoke", action="store_true",
                        help="limit the ROM source to Tetris.zip and skip BIOS/OFW file listings")
    parser.add_argument("--profile", help="resume or create a named persistent Chromium app session")
    parser.add_argument("--source-scope", choices=("full", "roms-bios", "roms-only", "tetris-smoke", "app-only"),
                        default="full", help="directory sources to provision in a new browser profile")
    parser.add_argument("--gwemu-profile", help="boot a previously provisioned, persistent GWemu media profile")
    parser.add_argument("--prepare-gwemu-profile", metavar="NAME",
                        help="prepare persistent GWemu media named NAME without using the app")
    parser.add_argument("--gwemu-state", choices=("stock", "retro-go"),
                        help="initial state for --prepare-gwemu-profile")
    parser.add_argument("--replace-gwemu-profile", action="store_true",
                        help="replace existing GWemu profile media when preparing it")
    parser.add_argument("--spec",
                        help="Override the scenario Playwright spec (normally selected by the workflow flag)")
    parser.add_argument("--reset-browser-profile", action="store_true",
                        help="delete the named browser profile before starting a fresh session")
    args = parser.parse_args()
    selected_spec = ("tests/library-sources.spec.mjs" if args.session else
                     "tests/pristine-backup-unlock.spec.mjs" if args.pristine_backup_unlock_e2e else
                     "tests/dualboot-install.spec.mjs" if args.dualboot_install_e2e or args.pristine_device_e2e else
                     "tests/library-sync.spec.mjs" if args.library_sync_e2e else
                     "tests/directory-sources.spec.mjs" if args.directory_sources_only else
                     "tests/library-sources.spec.mjs")
    test_spec = args.spec or selected_spec
    if args.spec and (args.session or args.directory_sources_only or args.dualboot_install_e2e or
                      args.pristine_device_e2e or args.pristine_backup_unlock_e2e or args.library_sync_e2e):
        expected = selected_spec
        if args.spec != expected:
            raise SystemExit(f"{args.spec} conflicts with the selected workflow; expected {expected}")
    if not args.config.is_file():
        raise SystemExit(f"Missing {args.config}. Copy tools/device-test/config.example.yaml there and edit local paths.")
    if args.keep_reports < 1:
        raise SystemExit("--keep-reports must be at least 1")
    if args.prune_reports_only:
        config = yaml.safe_load(args.config.read_text(encoding="utf-8")) or {}
        reports_dir = reports_root(config)
        prune_reports(reports_dir, args.keep_reports, reserve_new_report=False)
        print(f"Pruned reports in {reports_dir}; retained up to {args.keep_reports} completed runs.")
        return
    if args.prepare_gwemu_profile:
        if not args.gwemu_state:
            raise SystemExit("--prepare-gwemu-profile requires --gwemu-state stock|retro-go")
        provision_gwemu_profile(args.config, args.prepare_gwemu_profile, args.gwemu_state,
                                args.replace_gwemu_profile)
        return
    if args.source_scope != "full" and not args.profile:
        raise SystemExit("--source-scope requires --profile")
    device_workflow_flags = [args.dualboot_install_e2e, args.pristine_device_e2e, args.pristine_backup_unlock_e2e, args.library_sync_e2e]
    if sum(device_workflow_flags) > 1:
        raise SystemExit("Choose only one device workflow per runner invocation; compose them in a later suite runner")
    if args.session and (args.bounded_directory_smoke or args.dualboot_install_e2e or args.pristine_device_e2e
                         or args.pristine_backup_unlock_e2e):
        raise SystemExit("--session is the full-library baseline; run device workflows separately")
    if args.session and args.source_scope != "full":
        raise SystemExit("--session requires the full source scope so the real library is exercised")
    if args.library_sync_e2e and (not args.gwemu_profile or args.source_scope != "tetris-smoke" or args.session
                                  or args.dualboot_install_e2e or args.pristine_device_e2e
                                  or args.pristine_backup_unlock_e2e or args.bounded_directory_smoke):
        raise SystemExit("--library-sync-e2e requires --gwemu-profile RETRO_GO --profile NAME --source-scope tetris-smoke")
    if args.library_sync_e2e and not args.profile:
        raise SystemExit("--library-sync-e2e requires a persistent --profile to restore the ROM directory")
    if args.capture_gwemu_profile and not args.dualboot_install_e2e:
        raise SystemExit("--capture-gwemu-profile requires --dualboot-install-e2e")
    if args.capture_gwemu_profile and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", args.capture_gwemu_profile):
        raise SystemExit("--capture-gwemu-profile names must be 1-64 letters, digits, dots, underscores or dashes")
    if args.directory_sources_only or args.session or args.dualboot_install_e2e or args.pristine_device_e2e or args.pristine_backup_unlock_e2e or args.library_sync_e2e or args.profile or args.gwemu_profile or args.spec is not None:
        if args.reset_browser_profile and not args.profile:
            raise SystemExit("--reset-browser-profile requires --profile")
        run_directory_source_check(args.config, args.skip_app_start,
                                   bool((args.session or args.directory_sources_only or
                                         (args.profile and test_spec in {"tests/library-sources.spec.mjs", "tests/directory-sources.spec.mjs"}))
                                        and not args.bounded_directory_smoke),
                                   args.dualboot_install_e2e or args.pristine_device_e2e or args.pristine_backup_unlock_e2e,
                                   args.profile, args.source_scope, args.gwemu_profile, test_spec,
                                   args.reset_browser_profile, args.keep_reports, args.headed,
                                   args.gwemu_gui_binary, args.keep_target,
                                   args.pristine_device_e2e or args.pristine_backup_unlock_e2e,
                                   args.pristine_backup_unlock_e2e, args.skip_fast_checks,
                                   args.library_sync_e2e, args.capture_gwemu_profile,
                                   args.replace_gwemu_profile, args.browser, args.gwemu_binary,
                                   args.browser_instrumentation)
        return
    config = load_config(args.config)
    reports = reports_root(config)
    prune_reports(reports, args.keep_reports)
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    report = reports / run_id
    report.mkdir()
    (report / ".runner.pid").write_text(f"{os.getpid()}\n", encoding="ascii")
    run_dir = local_root(config) / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    cache = local_root(config) / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    processes = []
    container = "gnw-device-test-" + run_id
    keep = args.keep_target
    run_meta = {"run": run_id, "status": "running"}
    metadata_path = report / "run.json"
    metadata_path.write_text(json.dumps(run_meta, indent=2) + "\n")
    try:
        for tool in ("docker", "mformat", "mcopy"):
            if not shutil.which(tool):
                raise RuntimeError(f"Required executable is missing: {tool}")
        release = resolve_release(config, cache)
        write_media(release, run_dir)
        report_meta = {k: v for k, v in release.items() if k not in {"firmware", "elf", "content"}}
        run_meta["release"] = report_meta
        metadata_path.write_text(json.dumps(run_meta, indent=2) + "\n")

        app_url = config.get("browser", {}).get("app_url", "http://127.0.0.1:3000")
        if not args.skip_app_start:
            run(["docker", "compose", "up", "-d", "dev"], cwd=ROOT)
        wait_http(app_url)
        run_meta["core_workflow_checks"] = ({"status": "skipped"} if args.skip_fast_checks
                                            else run_core_workflow_checks(report))
        metadata_path.write_text(json.dumps(run_meta, indent=2) + "\n")

        browser = config.get("browser", {})
        qmp_port, gdb_port = free_port(), free_port()
        adapter_port = int(browser["adapter_port"]) if browser.get("adapter_port") else free_port()
        target_cfg = config.get("targets", {}).get("gwemu", {})
        image = target_cfg.get("image", "slashproc/gwemu-headless:latest")
        run(["docker", "pull", image])
        target_cmd = ["docker", "run", "-d", "--rm", "--name", container,
                      "-p", f"127.0.0.1:{gdb_port}:1234", "-p", f"127.0.0.1:{qmp_port}:4444",
                      "-v", f"{run_dir}:/images", "-v", f"{report}:/out", image,
                      "--bank1", "/images/qemu_bank1.bin", "--bank2", "/images/qemu_bank2.bin",
                      "--extflash", "/images/extflash.bin", "--sd", "/images/sdcard.img",
                      "--qmp-port", "4444", "--", "-s"]
        timeline = config.get("scenario", {}).get("timeline")
        if timeline:
            timeline = Path(timeline).expanduser().resolve()
            if not timeline.is_file():
                raise RuntimeError(f"Configured timeline does not exist: {timeline}")
            shutil.copy2(timeline, run_dir / "scenario.tl")
            target_cmd.insert(target_cmd.index(image), "GNW_TIMELINE=/images/scenario.tl")
            target_cmd.insert(target_cmd.index(image), "-e")
        run(target_cmd, stdout=subprocess.PIPE, text=True)
        wait_tcp(qmp_port, timeout=45)
        wait_tcp(gdb_port, timeout=45)

        bridge = subprocess.Popen([sys.executable, str(ROOT / "tools/remote-gdb/gnw_remote.py"),
                                   "--bind", "127.0.0.1", "--port", str(adapter_port),
                                   "--gdb-host", "127.0.0.1", "--gdb-port", str(gdb_port), "--trace-rsp"],
                                  cwd=ROOT, stdout=(report / "gdb-bridge.log").open("w"), stderr=subprocess.STDOUT)
        processes.append(bridge)
        wait_tcp(adapter_port, bridge)
        if bridge.poll() is not None:
            raise RuntimeError("GDB bridge failed to bind its configured port")

        base_image = browser.get("image", "mcr.microsoft.com/playwright:v1.63.0-noble")
        image_name = "gnw-device-test-browser:local"
        run(["docker", "build", "--build-arg", f"PLAYWRIGHT_IMAGE={base_image}", "-t", image_name,
             str(ROOT / "tools/device-test")], cwd=ROOT)
        test_cmd = ["docker", "run", "--rm", "--network", "host",
                    "-e", f"GNW_TEST_APP_URL={app_url}", "-e", f"GNW_TEST_ADAPTER_HOST={browser.get('adapter_host', '127.0.0.1')}",
                    "-e", f"GNW_TEST_BROWSER={args.browser}",
                    "-e", f"GNW_TEST_ADAPTER_PORT={adapter_port}", "-e", f"GNW_TEST_QMP_PORT={qmp_port}",
                    "-e", "GNW_TEST_QMP_SCREENSHOT=/out/device-screen.ppm",
                    "-e", "GNW_TEST_QMP_SCREENSHOT_REPORT_PATH=/reports/device-screen.ppm",
                    "-e", "GNW_TEST_REPORT_DIR=/reports", "-v", f"{report}:/reports",
                    image_name]
        result = subprocess.run(test_cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (report / "playwright.log").write_text(result.stdout)
        print(result.stdout, end="", flush=True)
        (report / "exit-code.txt").write_text(f"{result.returncode}\n")
        if result.returncode:
            raise RuntimeError(f"Playwright failed; see {report}")
        run_meta["status"] = "passed"
        metadata_path.write_text(json.dumps(run_meta, indent=2) + "\n")
        print(f"PASS: report at {report}")
    except Exception as error:
        run_meta["status"] = "failed"
        run_meta["error"] = str(error)
        metadata_path.write_text(json.dumps(run_meta, indent=2) + "\n")
        raise
    finally:
        for process in processes:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        if not keep:
            logs = subprocess.run(["docker", "logs", container], capture_output=True, text=True)
            (report / "gwemu.log").write_text(logs.stdout + logs.stderr)
            subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            shutil.rmtree(run_dir, ignore_errors=True)
        if (report / "html" / "index.html").is_file():
            embed_playwright_report_assets(report)
        # QMP only writes PPM. It is a transient source for the PNG attachment;
        # never retain the unsupported format in the run report.
        for ppm in report.rglob("*.ppm"):
            ppm.unlink()
        (report / ".runner.pid").unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"device-test: {error}", file=sys.stderr)
        raise SystemExit(1)
