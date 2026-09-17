#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const out = '/tmp/gnw-sd-update-test.mjs';
const esbuild = await import('esbuild');
await esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/lib/firmwareDist/sdUpdatePackage.ts', import.meta.url))], outfile: out, bundle: true, format: 'esm', platform: 'node' });
const p = await import(`file://${out}?${Date.now()}`);
const updater = new Uint8Array(32); updater[0]=0x42;
const image = new Uint8Array([1,2,3]);
const archive = p.buildRetroGoUpdate(updater, [{name:'update_bank2.bin',data:image,type:0x30},{name:'lang/en.bin',data:new Uint8Array([9]),type:0x30}]);
const parsed = p.parseRetroGoUpdate(archive);
if (parsed.updater.length !== updater.length || parsed.members.length !== 2) throw Error('archive parse mismatch');
const patched = p.replaceTarMember(archive, 'update_bank2.bin', new Uint8Array([7,8]));
const again = p.parseRetroGoUpdate(patched);
if (again.members.find(x=>x.name==='update_bank2.bin').data[0] !== 7) throw Error('nested image replacement failed');
console.log('sd-update-package: 3 checks passed');
