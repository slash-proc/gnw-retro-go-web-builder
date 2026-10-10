"""Small public CLI; execution and state management live in separate modules."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime
import uuid
import shutil
import fcntl
import socket
import time
from source_mounts import directory_mounts, mount_arguments
from catalog import TESTS, SUITES, expand_ordered, LOCKED_FLOW
from local_state import ROOT, migrate, profile_path, copy_state, reports_root

def main():
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'recommend':
        from recommend import main as recommend_main
        return recommend_main(sys.argv[2:])
    from profile_manager import BROWSER_PRESETS, GWEMU_PRESETS, prepare_browser, prepare_gwemu
    from session_runner import run_session
    # Legacy owns its whole argument list; the new parser must not consume its flags.
    if "--legacy" in sys.argv:
        from engine import main as legacy_main
        sys.argv.remove("--legacy")
        return legacy_main()
    parser = argparse.ArgumentParser(description='Run named browser/device tests using local profiles. Use `recommend --base REF` to suggest tests for changes.')
    parser.add_argument('--config', type=Path, default=ROOT / 'device-test.yaml')
    parser.add_argument('--browser-profile')
    parser.add_argument('--gwemu-profile')
    parser.add_argument('--device-state', help='Reuse one durable local device workspace instead of an ephemeral copy')
    parser.add_argument('--reset-device-state', action='store_true', help='Reset selected device state from its seed before this run')
    parser.add_argument('--record-media', metavar='NAME', help='Save a filesystem/hash expectation after a passing run')
    parser.add_argument('--expect-media', type=Path, help='Compare final filesystem tables and hashes with this JSON inventory')
    parser.add_argument('--compare-media', choices=('contents','image'), default='contents')
    parser.add_argument('--from-browser-profile', help='Copy a stopped profile into --browser-profile')
    class PlanAction(argparse.Action):
        def __call__(self, parser, namespace, value, option_string=None):
            items = list(getattr(namespace, 'plan_items', []))
            items.append(('suite' if option_string == '--suite' else 'test', value))
            setattr(namespace, 'plan_items', items)

    parser.add_argument('--test', action=PlanAction, choices=TESTS)
    parser.add_argument('--suite', action=PlanAction, choices=SUITES)
    parser.add_argument('--headed', action='store_true')
    parser.add_argument('--browser-instrumentation', choices=('off','full'), default='off',
                        help='collect invasive browser profiling only when requested (default: off)')
    parser.add_argument('--view-desktop', action='store_true', help='Show the Xvfb test through a local VNC viewer')
    parser.add_argument('--virtual-desktop', action='store_true', help='Provision native directory permissions offscreen with Xvfb')
    parser.add_argument('--list-tests', action='store_true')
    parser.add_argument('--list-suites', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--legacy', action='store_true', help='Use the previous runner interface (remaining arguments)')
    parser.add_argument('--prepare-browser-profile', choices=BROWSER_PRESETS, help='Generate and verify a browser seed recipe')
    parser.add_argument('--prepare-gwemu-profile', choices=GWEMU_PRESETS, help='Generate stock or Retro-Go seed media through gwprov')
    parser.add_argument('--browser-preset', choices=BROWSER_PRESETS, default='directories', help='Recipe when a selected browser seed does not exist')
    parser.add_argument('--gwemu-preset', choices=GWEMU_PRESETS, default='stock-unlocked', help='Recipe when a selected device seed does not exist')
    args, remaining = parser.parse_known_args()
    if args.legacy:
        import sys
        from engine import main as legacy_main
        sys.argv = [sys.argv[0], *remaining]
        return legacy_main()
    if remaining:
        parser.error('Unknown arguments: ' + ' '.join(remaining))
    if args.list_tests or args.list_suites:
        print('\n'.join(TESTS if args.list_tests else SUITES))
        return
    from engine import load_config, run_directory_source_check
    config = load_config(args.config)
    try:
        if args.reset_device_state and not args.device_state:raise ValueError('--reset-device-state requires --device-state NAME')
        plan = expand_ordered(getattr(args, 'plan_items', []))
        if not plan and not (args.prepare_browser_profile or args.prepare_gwemu_profile):
            parser.error('Select --test, --suite or a --prepare-*-profile recipe')
        if args.dry_run:
            print(json.dumps(dict(tests=plan, browserProfile=args.browser_profile, gwemuProfile=args.gwemu_profile,
                                  prepareBrowser=args.prepare_browser_profile, prepareGwemu=args.prepare_gwemu_profile,
                                  deviceState=args.device_state,resetDeviceState=args.reset_device_state,
                                  recordMedia=args.record_media,expectMedia=str(args.expect_media) if args.expect_media else None,
                                  compareMedia=args.compare_media,browserInstrumentation=args.browser_instrumentation),indent=2))
            return
        migrate(config)
        if args.prepare_browser_profile:
            if not args.browser_profile:raise ValueError('--prepare-browser-profile requires --browser-profile NAME')
            prepare_browser(config,args.browser_profile,args.prepare_browser_profile,args.from_browser_profile,
                            headed=args.headed,desktop=args.virtual_desktop or args.view_desktop,view=args.view_desktop)
        elif args.from_browser_profile:
            if not args.browser_profile:raise ValueError('--from-browser-profile requires --browser-profile')
            copy_state(profile_path(config,'browser',args.from_browser_profile),profile_path(config,'browser',args.browser_profile))
        if args.prepare_gwemu_profile:
            if not args.gwemu_profile:raise ValueError('--prepare-gwemu-profile requires --gwemu-profile NAME')
            prepare_gwemu(config,args.gwemu_profile,args.prepare_gwemu_profile)
        if not plan:return
        profile=args.browser_profile
        if profile:
            if not (profile_path(config,'browser',profile)/'profile.json').exists():
                prepare_browser(config,profile,args.browser_preset,
                                headed=args.headed,desktop=args.virtual_desktop or args.view_desktop,view=args.view_desktop)
            if args.gwemu_profile and not (profile_path(config,'gwemu',args.gwemu_profile)/'profile.json').exists():
                prepare_gwemu(config,args.gwemu_profile,args.gwemu_preset)
            if any(TESTS[t].get('device') for t in plan) and not args.gwemu_profile:
                raise ValueError('This plan requires --gwemu-profile NAME')
            return run_session(config,profile,plan,gwemu=args.gwemu_profile,headed=args.headed,
                               desktop=args.virtual_desktop or args.view_desktop,view=args.view_desktop,
                               device_state=args.device_state,reset_state=args.reset_device_state,
                               record_media=args.record_media,expect_media=args.expect_media,compare_mode=args.compare_media,
                               browser_instrumentation=args.browser_instrumentation)
        if plan==LOCKED_FLOW:
            return run_directory_source_check(args.config,False,install_e2e=True,pristine_backup=True,
                backup_unlock_only=True,test_spec='tests/pristine-backup-unlock.spec.mjs',headed=args.headed)
        raise ValueError('Select --browser-profile NAME for reusable composed tests; use --legacy for older scenarios')
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
