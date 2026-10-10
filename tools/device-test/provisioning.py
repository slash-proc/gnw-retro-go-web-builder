"""Translate test recipes to gwprov CLI commands; never construct device media here."""
import json
import os
from pathlib import Path
import subprocess
from local_state import ROOT


def gwprov_command(config):
    command = config.get('gwprov', {}).get('command', os.environ.get('GNW_TEST_GWPROV', 'gwprov'))
    if isinstance(command, str):
        command = [command]
    if not isinstance(command, list) or not command or any(not isinstance(x, str) for x in command):
        raise ValueError('gwprov.command must be an executable path or a list of command arguments')
    return command


def local_input(value):
    return str((ROOT / Path(value).expanduser()).resolve())


def provision_device(config, preset, workspace, log):
    """Return a complete gwprov instance and metadata after every command succeeds."""
    prefix = gwprov_command(config)
    instance = workspace / 'instance'
    commands = []

    def invoke(*args):
        command = [*prefix, *map(str, args)]
        commands.append(command)
        with log.open('a') as output:
            output.write('+ ' + json.dumps(command) + '\n')
            output.flush()
            try:
                subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, check=True)
            except FileNotFoundError as error:
                raise ValueError('gwprov is not installed; configure gwprov.command or GNW_TEST_GWPROV') from error
            except subprocess.CalledProcessError as error:
                raise RuntimeError(f'gwprov provisioning failed; see {log}') from error

    if preset in ('stock-locked', 'stock-unlocked'):
        args = ['profile', 'stock', instance]
        backups = config.get('ofw_backups', [])
        if not backups:
            raise ValueError('Stock provisioning requires configured ofw_backups')
        for folder in backups:
            args += ['--backup-dir', local_input(folder)]
        if preset == 'stock-locked':
            args += ['--locked']
        invoke(*args)
    elif preset == 'retro-go':
        recipe = config.get('gwemu_presets', {}).get('retro-go', {})
        if recipe.get('variant', 'flash') != 'flash':
            raise ValueError('The Retro-Go test preset currently supports flash only')
        if recipe.get('extflash_mib', 64) != 64:
            raise ValueError('The current GWemu test image supports 64 MiB extflash; gwprov itself also supports 128/256 MiB')
        content = workspace / 'content'
        args = ['retro-go', 'install', '--variant', 'flash', '--output', content]
        for key in ('repo', 'version'):
            if recipe.get(key):
                args += ['--' + key, recipe[key]]
        invoke(*args)
        # A GB core supports subsequent sync; Doom provides a shipped game without
        # copyrighted fixture inputs. Tetris deliberately starts uninstalled.
        projects = recipe.get('projects', ['tgb', 'doom'])
        if not isinstance(projects, list):
            raise ValueError('gwemu_presets.retro-go.projects must be a list')
        for project in projects:
            project = {'name': project} if isinstance(project, str) else project
            if not isinstance(project, dict) or not project.get('name'):
                raise ValueError('Each Retro-Go project needs a name')
            args = ['project', 'install', project['name'], '--variant', 'flash', '--output', content]
            for key in ('version', 'target'):
                if project.get(key):
                    args += ['--' + key, project[key]]
            for key in ('input', 'input_dir', 'game', 'game_dir', 'firmware', 'firmware_dir'):
                values = project.get(key, [])
                if not isinstance(values, list):
                    raise ValueError(f'Project {key} must be a list')
                for value in values:
                    slot, sep, path = value.partition('=')
                    value = slot + '=' + local_input(path) if sep else local_input(value)
                    args += ['--' + key.replace('_', '-'), value]
            invoke(*args)
        invoke('profile', 'create', instance, '--content', content,
               '--extflash-mib', recipe.get('extflash_mib', 64),
               '--littlefs-mib', recipe.get('littlefs_mib', 2),
               '--bootloader-version', recipe.get('bootloader_version', 'v1.0.8'))
    else:
        raise ValueError(f'Unknown GWemu preset: {preset}')
    provenance = json.loads((instance / 'provision.json').read_text())
    return instance, provenance, commands
