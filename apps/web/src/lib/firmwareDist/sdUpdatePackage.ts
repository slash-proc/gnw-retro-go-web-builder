/** Reader/writer for Retro-Go's complete SD updater archive. */
const APP_SIZE = 1024 * 1024;
const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let o=0; for(const p of parts){out.set(p,o);o+=p.length;} return out; }
function oct(dst: Uint8Array, off:number, len:number, value:number){ dst.set(enc.encode(Math.floor(value).toString(8).padStart(len-1,'0')+'\0'),off); }
function header(name:string,size:number,type=0x30){ const h=new Uint8Array(BLOCK); const n=enc.encode(name); if(n.length>100) throw Error(`tar path too long: ${name}`); h.set(n); oct(h,100,8,0o644); oct(h,124,12,size); h[156]=type; h.set(enc.encode('ustar\0'),257); h.set(enc.encode('00'),263); h.fill(0x20,148,156); let sum=0; for(const b of h)sum+=b; oct(h,148,8,sum); return h; }
export interface TarMember { name:string; data:Uint8Array; type:number; }
function parseOct(bytes:Uint8Array):number { const s=dec.decode(bytes).replace(/\0.*$/,'').trim(); return s ? parseInt(s,8) : 0; }
export function parseUstar(tar:Uint8Array):TarMember[]{ const out:TarMember[]=[]; for(let o=0;o+BLOCK<=tar.length;){ const h=tar.subarray(o,o+BLOCK); if(h.every(b=>b===0)) break; const name=dec.decode(h.subarray(0,100)).replace(/\0.*$/,''); const size=parseOct(h.subarray(124,136)); const type=h[156]||0; const start=o+BLOCK; if(start+size>tar.length) throw Error(`truncated tar member ${name}`); out.push({name,data:tar.slice(start,start+size),type}); o=start+Math.ceil(size/BLOCK)*BLOCK; } return out; }
export function buildUstar(files:Iterable<TarMember|readonly [string,Uint8Array]>):Uint8Array { const parts:Uint8Array[]=[]; for(const f of files){const m=Array.isArray(f)?{name:f[0],data:f[1],type:0x30}:f; parts.push(header(m.name,m.data.length,m.type),m.data); const pad=(BLOCK-m.data.length%BLOCK)%BLOCK;if(pad)parts.push(new Uint8Array(pad));} parts.push(new Uint8Array(BLOCK*2)); return concat(parts); }
export interface RetroGoUpdate { updater:Uint8Array; tar:Uint8Array; members:TarMember[]; }
export function parseRetroGoUpdate(bytes:Uint8Array):RetroGoUpdate { if(bytes.length<APP_SIZE+4) throw Error('Retro-Go update is truncated'); const n=new DataView(bytes.buffer,bytes.byteOffset+APP_SIZE,4).getUint32(0,true); if(!n||n>APP_SIZE) throw Error('Invalid updater payload size'); const tar=bytes.slice(APP_SIZE+4); const members=parseUstar(tar); return {updater:bytes.slice(0,n),tar,members}; }
export function buildRetroGoUpdate(updater:Uint8Array,members:Iterable<TarMember|readonly [string,Uint8Array]>):Uint8Array { if(updater.length>APP_SIZE) throw Error('firmware_update.bin exceeds 1 MiB'); const p=new Uint8Array(APP_SIZE);p.set(updater); const n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,updater.length,true);return concat([p,n,buildUstar(members)]); }
export function replaceTarMember(archive:Uint8Array,name:string,data:Uint8Array):Uint8Array { const parsed=parseRetroGoUpdate(archive); let found=false; const members=parsed.members.map(m=>m.name===name?(found=true,{...m,data}):m); if(!found) throw Error(`Updater archive does not contain ${name}`); return buildRetroGoUpdate(parsed.updater,members); }
