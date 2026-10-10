"""One run, ordered UI building blocks, independent browser/device working copies."""
import json
import hashlib
import os
import shutil
import subprocess
import sys
import tomllib
from contextlib import contextmanager
from pathlib import Path
from browser_runtime import build_browser, new_report, finish_report, run_browser
from local_state import ROOT, local_root, profile_path, copy_state, name as valid_name
from profile_manager import read_browser, fingerprint
from source_mounts import directory_mounts

@contextmanager
def target_session(config,name,run_dir,report,media=None):
    from engine import free_ports,wait_tcp
    seed=profile_path(config,'gwemu',name)
    manifest=json.loads((seed/'profile.json').read_text())
    if media is None:
        media=run_dir/'gwemu';copy_state(seed,media)
    gdb,qmp,adapter=free_ports(3)
    container='gnw-target-'+run_dir.name
    bridge=None
    log=(report/'gdb-bridge.log').open('w')
    image=os.environ.get('GNW_TEST_GWEMU_IMAGE','slashproc/gwemu-headless:latest')
    files=manifest.get('media',{'bank1':'qemu_bank1.bin','bank2':'qemu_bank2.bin','extflash':'extflash.bin'})
    for key in ('bank1','bank2','extflash'):
        filename=files[key]
        if Path(filename).name!=filename or not (media/filename).is_file():
            raise ValueError(f'Invalid or missing GWemu seed media: {filename}')
    rdp=manifest.get('rdpFile','rdp-state.bin')
    if Path(rdp).name!=rdp or not (media/rdp).is_file():
        raise ValueError('GWemu seed must include protection state')
    args=['-M','gnw-h7b0','-display','none',
          '-global',f'gnw-h7b0-soc.bank1-image=/images/{files["bank1"]}',
          '-global',f'gnw-h7b0-soc.bank2-image=/images/{files["bank2"]}',
          '-global',f'gnw-h7b0-soc.extflash-image=/images/{files["extflash"]}',
          '-global',f'gnw-h7b0-soc.rdp-locked={"on" if manifest["locked"] else "off"}',
          '-global',f'gnw-h7b0-soc.rdp-image=/images/{rdp}',
          '-qmp','tcp:0.0.0.0:4444,server=on,wait=off',
          '-gdb','tcp:0.0.0.0:1234,server=on,wait=off',
          '-audiodev','none,id=snd0','-global','gnw-h7b0-sai1.audiodev=snd0']
    profile_data=tomllib.loads((media/'profile.toml').read_text())
    sd=profile_data.get('sd',{})
    if sd.get('mode','none')=='bundled':
        sd_path=(media/sd['image']).resolve()
        if not sd_path.is_relative_to(media.resolve()) or not sd_path.is_file():
            raise ValueError('Bundled SD image must exist inside the device profile')
        args+=['-drive',f'if=sd,format=raw,file=/images/{sd_path.relative_to(media.resolve()).as_posix()}']
    elif sd.get('mode','none')!='none':
        raise ValueError('Test profiles must bundle their SD image for isolated ownership')
    try:
        subprocess.run(['docker','run','-d','--name',container,'--user',f'{os.getuid()}:{os.getgid()}',
                        '-p',f'127.0.0.1:{gdb}:1234','-p',f'127.0.0.1:{qmp}:4444',
                        '-v',f'{media}:/images','-v',f'{report}:/reports',
                        '--entrypoint','/usr/local/bin/qemu-system-arm',image,*args],check=True)
        wait_tcp(gdb,timeout=45);wait_tcp(qmp,timeout=45)
        bridge=subprocess.Popen([sys.executable,str(ROOT/'tools/remote-gdb/gnw_remote.py'),
                                 '--bind','127.0.0.1','--port',str(adapter),
                                 '--gdb-host','127.0.0.1','--gdb-port',str(gdb),
                                 '--emulate-interrupt','--trace-rsp'],stdout=log,stderr=subprocess.STDOUT)
        wait_tcp(adapter,bridge)
        yield {'GNW_TEST_ADAPTER_ENABLED':'1','GNW_TEST_ADAPTER_PORT':str(adapter),
               'GNW_TEST_QMP_PORT':str(qmp),'GNW_TEST_QMP_SCREENSHOT':'/reports/device.ppm'}
    finally:
        if bridge:
            bridge.terminate()
            try:bridge.wait(timeout=10)
            except subprocess.TimeoutExpired:bridge.kill();bridge.wait()
        log.close()
        subprocess.run(['docker','stop','-t','10',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        with (report/'gwemu.log').open('w') as output:
            subprocess.run(['docker','logs',container],stdout=output,stderr=subprocess.STDOUT)
        subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def run_session(config,profile,plan,*,gwemu=None,headed=False,desktop=False,view=False,
                device_state=None,reset_state=False,record_media=None,expect_media=None,compare_mode="contents",
                browser_instrumentation="off"):
    from media_state import device_workspace, inventory, compare, expectation
    from contextlib import nullcontext
    if device_state:device_state=valid_name(device_state)
    if (device_state or reset_state or record_media or expect_media) and not gwemu:
        raise ValueError('Media state/verification options require --gwemu-profile')
    baseline=expectation(config,record_media) if record_media else None
    if baseline and baseline.exists():raise ValueError(f'Expectation already exists: {baseline}; choose another name')
    if expect_media and not Path(expect_media).is_file():raise ValueError(f'Missing expected media inventory: {expect_media}')
    seed,manifest=read_browser(config,profile)
    before=fingerprint(seed)
    report=new_report(config,'native-composed-session')
    workspace=local_root(config)/'runs'/report.name;workspace.mkdir(parents=True)
    status='failed'
    device_before=None
    if gwemu:
        device_seed=profile_path(config,'gwemu',gwemu)
        device_before=fingerprint(device_seed)
        shutil.copy2(device_seed/'profile.json',report/'device-profile.json')
        device_manifest=json.loads((device_seed/'profile.json').read_text())
        provision_log=device_manifest.get('provisionLog')
        if provision_log and Path(provision_log).is_file():
            shutil.copy2(provision_log,report/'device-provision.log')
    try:
        copy_state(seed,workspace/'browser-profile')
        run_directories=list(manifest['directories'])
        run_env={'GNW_TEST_PLAN':json.dumps(plan),
                 'GNW_TEST_BROWSER_INSTRUMENTATION':browser_instrumentation}
        if 'firmware/device-backup' in plan:
            if any(source['group']=='ofw_backups' for source in run_directories):
                raise ValueError('Fresh backup tests require a browser seed without an OFW backup source')
            configured=next((d for d in directory_mounts(config) if d['group']=='ofw_backups'),None)
            if not configured:raise ValueError('device-test.yaml must configure an OFW backup directory')
            output=workspace/'fresh-ofw-backup';output.mkdir()
            run_directories.append({**configured,'hostPath':str(output)})
            run_env['GNW_TEST_BACKUP_DIR']=configured['path']
        build_browser()
        storage=device_workspace(config,device_seed,workspace,device_state,reset_state) if gwemu else nullcontext(None)
        with storage as media:
            if media:inventory(config,media,report/'media-before.json')
            device=target_session(config,gwemu,workspace,report,media) if gwemu else nullcontext({})
            browser_failed=True
            try:
                with device as device_env:
                    run_browser(workspace/'browser-profile/browser',report,run_directories,
                                'tests/native-session.spec.mjs',headed=headed,desktop=desktop,view=view,
                                env={**device_env,**run_env})
                browser_failed=False
            finally:
                if media:
                    try:inventory(config,media,report/'media-after.json')
                    except Exception as error:
                        (report/'media-inventory-error.txt').write_text(str(error)+'\n')
                        if not browser_failed:raise
            if 'firmware/return-to-stock' in plan:
                after=json.loads((report/'media-after.json').read_text())
                bank2=after.get('images',{}).get('bank2',{})
                erased_hash=hashlib.sha256(b'\xff'*(256*1024)).hexdigest()
                check={'bank2Sha256':bank2.get('sha256'),'expectedErasedSha256':erased_hash,
                       'passed':bank2.get('sha256')==erased_hash}
                (report/'return-to-stock-bank2-check.json').write_text(json.dumps(check,indent=2)+'\n')
                if not check['passed']:
                    raise RuntimeError('Return to Stock did not erase Retro-Go from bank 2; see return-to-stock-bank2-check.json')
            if expect_media:compare(config,expect_media,report/'media-after.json',report/'media-comparison.json',compare_mode)
        backup_output=workspace/'fresh-ofw-backup'
        if backup_output.is_dir():
            backup_inventory=[]
            for file in sorted(backup_output.rglob('*')):
                if file.is_file():
                    digest=hashlib.sha256(file.read_bytes()).hexdigest()
                    backup_inventory.append({'name':str(file.relative_to(backup_output)),
                                      'bytes':file.stat().st_size,'sha256':digest})
            (report/'fresh-backup-output.json').write_text(json.dumps(backup_inventory,indent=2)+'\n')
        if fingerprint(seed)!=before:raise RuntimeError('Reusable browser seed changed during a run')
        if gwemu and fingerprint(profile_path(config,'gwemu',gwemu))!=device_before:
            raise RuntimeError('Reusable GWemu seed changed during a run')
        if baseline:
            baseline.parent.mkdir(parents=True,exist_ok=True)
            with baseline.open('x') as output:output.write((report/'media-after.json').read_text())
            metadata={'path':str(baseline),'report':str(report),'tests':plan,'sourceSeed':gwemu,
                      'sourceProvenance':device_manifest.get('provenance')}
            baseline.with_suffix('.meta.json').write_text(json.dumps(metadata,indent=2)+'\n')
            (report/'expectation.json').write_text(json.dumps(metadata,indent=2)+'\n')
        status='passed'
    finally:
        if device_state and (local_root(config)/'device-states'/device_state).exists():
            record={'run':report.name,'status':status,'tests':plan,'sourceSeed':gwemu,
                    'report':str(report),'inventory':None}
            if (report/'media-after.json').exists():record['inventory']=json.loads((report/'media-after.json').read_text())
            with (local_root(config)/'device-states'/device_state/'history.jsonl').open('a') as ledger:
                ledger.write(json.dumps(record,sort_keys=True)+'\n')
        finish_report(report,status,tests=plan,browserProfile=profile,gwemuProfile=gwemu,deviceState=device_state,recordedMedia=str(baseline) if baseline else None,
                      browserInstrumentation=browser_instrumentation,
                      seedSha256Before=before,seedSha256After=fingerprint(seed),
                      deviceSeedSha256Before=device_before,
                      deviceSeedSha256After=fingerprint(profile_path(config,'gwemu',gwemu)) if gwemu else None)
        shutil.rmtree(workspace,ignore_errors=True)
    print(f'Native session passed: {report}/playwright-report.html')
    return report
