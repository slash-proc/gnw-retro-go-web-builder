"""Profile recipes, validation and atomic publication of machine-local seeds."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import uuid
from browser_runtime import APP_URL, build_browser, new_report, finish_report, run_browser
from local_state import ROOT, profile_path, copy_state, ensure_stopped
from source_mounts import directory_mounts

BROWSER_PRESETS=('directories','clean','roms-only','roms-bios','no-backups','full-library','full-library-atlas')
GWEMU_PRESETS=('stock-locked','stock-unlocked','retro-go')

def publish(path, manifest):
    temporary=path/('.manifest-'+uuid.uuid4().hex)
    temporary.write_text(json.dumps(manifest,indent=2)+'\n')
    temporary.replace(path/'profile.json')

def fingerprint(path):
    digest=hashlib.sha256()
    for file in sorted(path.rglob('*')):
        if file.is_file() and file.name!='.provision.lock':
            digest.update(str(file.relative_to(path)).encode())
            with file.open('rb') as stream:
                for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def read_browser(config,name):
    path=profile_path(config,'browser',name)
    if not (path/'profile.json').is_file():raise ValueError(f'Browser seed is not published: {name}; provision it first')
    manifest=json.loads((path/'profile.json').read_text())
    if not manifest.get('nativeDirectories') or manifest.get('appUrl')!=APP_URL:
        raise ValueError(f'{name} is not a verified native HTTPS seed')
    available=directory_mounts(config)
    for directory in manifest['directories']:
        if directory not in available:raise ValueError(f'Source configuration differs from seed {name}: {directory["hostPath"]}')
    return path,manifest

def prepare_browser(config,name,preset='directories',source=None,*,headed=False,desktop=False,view=False):
    target=profile_path(config,'browser',name);target.mkdir(parents=True,exist_ok=True)
    with (target/'.provision.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if (target/'profile.json').exists():
            _,manifest=read_browser(config,name)
            if manifest['preset']!=preset:raise ValueError(f'{name} already has preset {manifest["preset"]}; choose another name')
            return target
        directories=directory_mounts(config)
        if preset=='clean':directories=[]
        elif preset=='roms-only':directories=[d for d in directories if d['group']=='roms']
        elif preset in ('roms-bios','no-backups'):directories=[d for d in directories if d['group']!='ofw_backups']
        staging=target/('.seed-'+uuid.uuid4().hex)
        report=new_report(config,'prepare-browser-profile')
        status='failed'
        try:
            if source and preset!='clean':
                original,seed=read_browser(config,source)
                copy_state(original,staging)
                if directories and any(d not in seed['directories'] for d in directories):
                    raise ValueError('The parent seed does not contain the requested preset directories')
            else:
                staging.mkdir()
                existing=target/'browser'
                if preset!='clean' and existing.is_dir() and any(existing.iterdir()):
                    # Adopt the stopped, manually verified profile on a copy; publication
                    # still requires the headless check below.
                    ensure_stopped(target)
                    shutil.copytree(existing,staging/'browser',symlinks=True,
                                    ignore=shutil.ignore_patterns('SingletonLock','SingletonSocket','SingletonCookie'))
            build_browser()
            if preset=='full-library-atlas':
                if not source and not (staging/'browser').exists():
                    raise ValueError('full-library-atlas requires --from-browser-profile with a verified native directory seed')
                atlas_spec='tests/full-library-atlas-seed.spec.mjs'
                run_browser(staging/'browser',report,directories,atlas_spec,
                            env={'GNW_TEST_ATLAS_CACHE_EXPECTED':'0','GNW_TEST_ATLAS_PHASE':'warm'})
                # A separate Chromium process proves both OPFS persistence and that the app
                # accepts the saved atlas against the freshly scanned source signature.
                run_browser(staging/'browser',report,directories,atlas_spec,
                            env={'GNW_TEST_ATLAS_CACHE_EXPECTED':'1','GNW_TEST_ATLAS_PHASE':'restart'})
            elif source or preset=='clean':
                run_browser(staging/'browser',report,directories,'tests/profile-prepare.spec.mjs',
                            headed=headed,desktop=desktop,view=view,
                            env={'GNW_TEST_PRESET':preset})
            elif not (staging/'browser').exists():
                if not (desktop or headed):
                    raise ValueError('Native source provisioning requires --view-desktop, --virtual-desktop or --headed')
                run_browser(staging/'browser',report,directories,'tests/native-directory-seed.spec.mjs',
                            headed=headed,desktop=desktop,view=view)
            if preset!='full-library-atlas':
                run_browser(staging/'browser',report,directories,'tests/native-directory-seed.spec.mjs')
            # Successful headless check is the publication gate. Never publish partial data.
            existing=target/'browser'
            if existing.exists():shutil.rmtree(existing)
            (staging/'browser').rename(existing)
            manifest={'schemaVersion':2,'nativeDirectories':True,'preset':preset,
                            'appUrl':APP_URL,'directories':directories,'evidence':str(report),
                            'parent':source,'validation':'headless-native-handles'}
            if preset=='full-library-atlas':
                cache_report=json.loads((report/'atlas-profile-cache-restart.json').read_text())
                manifest['atlasCache']=cache_report['cache']
                manifest['validation']='headless-native-handles-and-persistent-atlas'
            publish(target,manifest)
            status='passed'
            print(f'Published browser seed: {name}\nReport: {report}')
        finally:
            shutil.rmtree(staging,ignore_errors=True)
            finish_report(report,status,profile=name,preset=preset)
    return target

def prepare_gwemu(config,name,preset):
    if preset not in GWEMU_PRESETS:raise ValueError(f'Unknown GWemu preset: {preset}')
    from provisioning import provision_device
    target=profile_path(config,'gwemu',name)
    target.parent.mkdir(parents=True,exist_ok=True)
    # A sibling lock serializes publication without creating the target directory.
    with (target.parent/('.'+target.name+'.provision.lock')).open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if target.exists():
            manifest=json.loads((target/'profile.json').read_text())
            if manifest.get('preset')!=preset:raise ValueError(f'{name} already uses a different GWemu preset')
            return target
        staging=target.parent/('.seed-'+uuid.uuid4().hex);staging.mkdir()
        log=target.parent/(name+'-provision.log')
        try:
            instance,provenance,commands=provision_device(config,preset,staging,log)
            retro=preset=='retro-go'
            publish(instance,{'schemaVersion':2,'name':name,'preset':preset,
                              'state':'retro-go' if retro else 'stock',
                              'locked':False if retro else provenance['locked'],
                              'model':provenance.get('model','mario'),
                              'firmware':'retro-go' if retro else 'stock',
                              'rdpFile':'rdp-state.bin',
                              'media':{'bank1':'bank1.bin','bank2':'bank2.bin','extflash':'extflash.bin'},
                              'provisioner':'gwprov','provenance':provenance,
                              'commands':commands,'provisionLog':str(log)})
            instance.rename(target)
            print(f'Published GWemu seed: {name} ({preset})\nProvisioning log: {log}')
        finally:shutil.rmtree(staging,ignore_errors=True)
    return target
