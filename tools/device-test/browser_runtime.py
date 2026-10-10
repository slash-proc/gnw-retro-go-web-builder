"""Docker browser lifecycle shared by provisioning and composed feature runs."""
from datetime import datetime
import json
import html
import os
from pathlib import Path
import socket
import subprocess
import time
import uuid
from local_state import ROOT, reports_root
from source_mounts import mount_arguments

IMAGE = 'gnw-device-test-chromium'
APP_URL = 'https://localhost/'

def new_report(config, purpose):
    from engine import prune_reports
    prune_reports(reports_root(config), 10)
    report = reports_root(config) / (datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:12])
    report.mkdir(parents=True)
    (report/'.runner.pid').write_text(str(os.getpid()))
    (report/'run.json').write_text(json.dumps({'run':report.name,'purpose':purpose,'status':'running'},indent=2))
    return report

def finish_report(report, status, **metadata):
    from engine import embed_playwright_report_assets
    try:
        if (report/'html/index.html').is_file():
            embed_playwright_report_assets(report)
            standalone=report/'playwright-report.html'
            if standalone.is_file():
                links=' · '.join(f'<a href="{name}">{name}</a>' for name in
                    ('run.json','media-before.json','media-after.json','media-comparison.json',
                     'media-inventory-error.txt','runner.log')
                    if (report/name).is_file() or name=='run.json')
                banner=(f'<aside style="padding:12px;background:#eef2f6;color:#111;font:14px sans-serif">'
                        f'<strong>Complete harness run: {html.escape(status)}</strong> · {links}'
                        '<br>Browser assertions below are one part of the complete run.</aside>')
                content=standalone.read_text()
                content=content.replace('<body>', '<body>'+banner, 1)
                standalone.write_text(content)
        (report/'run.json').write_text(json.dumps({'status':status,**metadata},indent=2)+'\n')
    finally:
        (report/'.runner.pid').unlink(missing_ok=True)

def build_browser():
    subprocess.run(['docker','compose','up','-d','dev','proxy'],cwd=ROOT,check=True)
    subprocess.run(['docker','build','-f',str(ROOT/'tools/device-test/Dockerfile.chromium'),
                    '-t',IMAGE,str(ROOT/'tools/device-test')],check=True)

def run_browser(browser, report, directories, spec, *, headed=False, desktop=False,
                view=False, env=None, extra_mounts=None):
    browser.mkdir(parents=True,exist_ok=True)
    home=report/'container-home';home.mkdir(exist_ok=True)
    values={'HOME':'/home/user','GNW_TEST_APP_URL':APP_URL,
            'GNW_TEST_BROWSER_PROFILE_DIR':'/browser-profile','GNW_TEST_REPORT_DIR':'/reports',
            'GNW_TEST_DIRECTORY_MAP':json.dumps(directories),'GNW_TEST_SPEC':spec,
            'GNW_TEST_HEADLESS':str(int(not (headed or desktop))),
            'GNW_TEST_DESKTOP':str(int(desktop)), 'GNW_TEST_VIEW_DESKTOP':str(int(view)),
            'GNW_TEST_DESKTOP_SIZE':os.environ.get('GNW_TEST_DESKTOP_SIZE','1920x1080')}
    values.update(env or {})
    command=['docker','run','--rm','--init','--network','host','--user',f'{os.getuid()}:{os.getgid()}',
             '-v',f'{home}:/home/user','-v',f'{browser}:/browser-profile','-v',f'{report}:/reports']
    command+=mount_arguments(directories)
    command+=extra_mounts or []
    if headed and not desktop:
        runtime=os.environ.get('XDG_RUNTIME_DIR');display=os.environ.get('WAYLAND_DISPLAY')
        if not runtime or not display:raise ValueError('Headed mode requires a Wayland desktop; use --view-desktop instead')
        command+=['-v',f'{runtime}/{display}:{runtime}/{display}']
        values.update(XDG_RUNTIME_DIR=runtime,WAYLAND_DISPLAY=display,GNW_TEST_WAYLAND='1')
    for key,value in values.items():command+=['-e',f'{key}={value}']
    command+=(['--entrypoint','sh',IMAGE,'/runner/desktop.sh'] if desktop else
              ['--entrypoint','npx',IMAGE,'playwright','test',spec])
    if view:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',5901))==0:raise ValueError('VNC port 5901 is already in use')
    with (report/'runner.log').open('w') as log:
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        try:
            if view:
                deadline=time.monotonic()+60
                while process.poll() is None and time.monotonic()<deadline:
                    try:
                        with socket.create_connection(('127.0.0.1',5901),timeout=1):break
                    except OSError:time.sleep(.25)
                if process.poll() is None:
                    subprocess.Popen(['remmina','--connect','vnc://127.0.0.1:5901'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            for line in process.stdout:
                print(line,end='',flush=True);log.write(line);log.flush()
            if process.wait():raise RuntimeError(f'Browser test failed; report: {report}')
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=15)
                except subprocess.TimeoutExpired:process.kill();process.wait()
