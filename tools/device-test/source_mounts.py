"""Stable container paths for every machine-local source directory."""
from pathlib import Path
from local_state import ROOT

CONTAINER_HOME = Path('/home/user')

def directory_mounts(config):
    directories = []
    home = Path.home().resolve()
    for group in ('roms', 'firmware_bios', 'ofw_backups'):
        values = config.get(group, [])
        if not isinstance(values, list):
            raise ValueError(f'{group} must be a list of directory paths')
        for index, value in enumerate(values):
            host = (ROOT / Path(value).expanduser()).resolve()
            if not host.is_dir():
                raise ValueError(f'Missing directory: {host}')
            if host.is_relative_to(home):
                container = CONTAINER_HOME / host.relative_to(home)
            else:
                container = Path('/inputs') / group / str(index) / host.name
            directories.append(dict(group=group, hostPath=str(host), path=str(container), name=host.name))
    return directories

def mount_arguments(directories):
    result = []
    seen = set()
    for directory in directories:
        pair = (directory['hostPath'], directory['path'])
        if pair in seen:
            continue
        seen.add(pair)
        result += ['--mount', f'type=bind,source={pair[0]},target={pair[1]}']
    return result
