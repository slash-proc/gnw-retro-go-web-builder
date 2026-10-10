"""Small verification records and one opt-in durable device workspace."""
from contextlib import contextmanager
import fcntl
import json
from pathlib import Path
import shutil
import subprocess
from local_state import local_root, name, copy_state
from provisioning import gwprov_command


@contextmanager
def device_workspace(config, seed, run_dir, state=None, reset=False):
    if state is None:
        media=run_dir/'gwemu'
        copy_state(seed,media)
        yield media
        return
    root=local_root(config)/'device-states';root.mkdir(parents=True,exist_ok=True)
    media=root/name(state)
    with (root/('.'+state+'.lock')).open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError(f'Device state {state} is already in use')
        if reset and media.exists():shutil.rmtree(media)
        if not media.exists():
            copy_state(seed,media)
            (media/'state.json').write_text(json.dumps({'sourceSeed':seed.name},indent=2)+'\n')
        elif json.loads((media/'state.json').read_text())['sourceSeed']!=seed.name:
            raise ValueError('Device state belongs to a different seed; choose another state name or reset it')
        yield media


def inventory(config, media, output):
    command=[*gwprov_command(config),'media','inventory','--profile',str(media),'--output',str(output)]
    with output.with_suffix('.log').open('w') as log:
        log.write('+ '+json.dumps(command)+'\n');log.flush()
        subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
    return json.loads(output.read_text())


def compare(config, expected, actual, output, mode='contents'):
    command=[*gwprov_command(config),'media','compare',str(expected),str(actual),'--mode',mode]
    with output.open('w') as log:
        result=subprocess.run(command,stdout=log,stderr=subprocess.PIPE,text=True)
    if result.returncode:
        raise RuntimeError(f'Media comparison failed: {output}; {result.stderr.strip()}')


def expectation(config, label):
    return local_root(config)/'expectations'/(name(label)+'.json')
