// Real WebSocket exchanges through the browser transport, with mocked device bytes.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { WebSocket, WebSocketServer } from "ws";
import { gnwResolveFor } from "./gnwResolve.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "gnw-remote-"));
globalThis.WebSocket = WebSocket;
const packet = (body) => `$${body}#${([...Buffer.from(body)].reduce((a,b)=>a+b,0)&255).toString(16).padStart(2,"0")}`;
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`  OK ${name}`); }
try {
 const outfile = join(dir, "remote.mjs");
 await build({ entryPoints: [new URL("../src/lib/engine/remoteGdb.ts", import.meta.url).pathname], outfile, bundle:true, platform:"node", format:"esm", plugins:[gnwResolveFor(import.meta.url)] });
 const { GdbRemoteClient, RemoteGdbTransport, remoteGdbUrl, DEFAULT_REMOTE_PORT } = await import(pathToFileURL(outfile));
 await check("WebSocket defaults and host validation", async()=>{
  assert.equal(remoteGdbUrl("localhost", DEFAULT_REMOTE_PORT),"ws://localhost:8765/gdb");
  assert.equal(remoteGdbUrl("wss://pi.local",8765),"wss://pi.local:8765/gdb");
  assert.throws(()=>remoteGdbUrl("pi",0)); assert.throws(()=>remoteGdbUrl("pi/path",8765));
 });
 await check("physical control commits backend register cache and preserves watchdog freezing", async()=>{
  const words=new Map([[0xe000edf0,1<<17]]), events=[];
  let stagedPc=0, livePc=0;
  const client={isManaged:true, usesGdbControl:false,
   async readMemory(addr){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,words.get(addr)??0,true);return b;},
   async writeMemory(addr,data){words.set(addr,new DataView(data.buffer,data.byteOffset,4).getUint32(0,true));events.push(["word",addr]);},
   async writeRegister(name,value){if(name==="pc")stagedPc=value;},
   async readRegister(){return stagedPc;},
   async halt(){events.push(["halt"]);},
   async reset(){events.push(["reset"]);},
   async resume(){
    assert.ok(words.get(0x5c001034)&(1<<6),"WWDG must stay frozen until backend resume");
    assert.ok(words.get(0x5c001054)&(1<<18),"IWDG must stay frozen until backend resume");
    livePc=stagedPc;events.push(["resume"]);
   }
  };
  const t=new RemoteGdbTransport(client);
  await t.reset();
  assert.ok(events.some(e=>e[0]==="reset"),"reset must synchronize the backend's target state");
  await t.writeRegister("pc",0x240f0679);
  await t.resume();
  assert.equal(livePc,0x240f0679,"backend resume must commit the staged RAM stub PC");
  assert.equal(words.get(0x5c001034)&(1<<6),0);
  assert.equal(words.get(0x5c001054)&(1<<18),0);
  await t.halt();
  assert.ok(events.some(e=>e[0]==="halt"),"halt must synchronize the backend's target state");
 });
 const server = new WebSocketServer({ port:0 });
 await new Promise(r=>server.once("listening",r));
 const url=`ws://127.0.0.1:${server.address().port}/gdb`;
 let missing=false, closed=0, calls=[];
 server.on("connection", ws=>{
  ws.send(JSON.stringify({type:"hello",version:1,backend:"gnwmanager"}));
  ws.on("close",()=>closed++);
  ws.on("message",(raw,binary)=>{
   if(binary){ const command=raw.toString(); if(command==="+")return;
    assert.equal(command,packet("qSupported")); ws.send(Buffer.from("+"+packet("PacketSize=10000")));return;
   }
   const req=JSON.parse(raw);calls.push(req);
   if(req.method==="attach" && missing){ws.send(JSON.stringify({id:req.id,error:"No device detected"}));return;}
   const result=req.method==="read_memory"?"00".repeat(req.args[1]):req.method==="read_register"?0x12345678:true;
   ws.send(JSON.stringify({id:req.id,result}));
  });
 });
 await check("managed attach and live memory reads never halt or resume",async()=>{
  const client=new GdbRemoteClient(url);await client.connect();
  const t=new RemoteGdbTransport(client);
  assert.equal(await t.readWord(0xe000ed00),0);
  assert.equal((await t.readMemory(0x24000000,10000)).length,10000);
  await t.writeWord(0x24000000,0x12345678);
  assert.equal(await t.readRegister("pc"),0x12345678);
  await t.writeRegister("msp",0x20020000);
  assert.ok(!calls.some(r=>["halt","resume","reset_and_halt"].includes(r.method)));
  const previousAttachCount=calls.filter(r=>r.method==="attach").length;
  await client.reattach();
  assert.equal(calls.filter(r=>r.method==="attach").length,previousAttachCount+1);
  assert.equal(server.clients.size,1,"Backend reattachment must keep the original WebSocket");
  client.close();
 });
 await check("reachable helper and absent target are distinct; target can return",async()=>{
  missing=true;const absent=new GdbRemoteClient(url);
  await assert.rejects(absent.connect(),/No device detected/);assert.equal(absent.available,true);absent.close();
  missing=false;const returned=new GdbRemoteClient(url);await returned.connect();assert.equal(returned.available,true);returned.close();
 });
 await check("socket loss rejects pending work and fires loss once",async()=>{
  const client=new GdbRemoteClient(url);await client.connect();let lost=0;client.onLost(()=>lost++);
  server.clients.forEach(ws=>ws.terminate());
  await new Promise(r=>setTimeout(r,30));assert.equal(client.available,false);assert.equal(lost,1);
  await assert.rejects(client.readMemory(0,4));client.close();
 });
 await new Promise(r=>server.close(r));
 const rawServer=new WebSocketServer({port:0});await new Promise(r=>rawServer.once("listening",r));
 let rawCalls=[];
 rawServer.on("connection",ws=>ws.on("message",data=>{
  const command=data.toString();rawCalls.push(command);
  if(command==="+")return;
  if(command==="\x03"){ws.send(Buffer.from(packet("S05")));return;}
  if(command===packet("c")){ws.send(Buffer.from("+"));return;}
  const body=command.slice(1,command.lastIndexOf("#"));
  const reply=body === "m0,8" ? "0*," : body.startsWith("m")?"12345678":body.startsWith("p")?"78563412":body==="qSupported"?"PacketSize=10000":"OK";
  // Packet fragments arrive independently, as they can through a TCP relay.
  const out="+"+packet(reply);ws.send(Buffer.from(out.slice(0,3)));ws.send(Buffer.from(out.slice(3)));
 }));
 await check("raw gwmeu GDB framing, register access and explicit control",async()=>{
  const client=new GdbRemoteClient(`ws://127.0.0.1:${rawServer.address().port}/gdb`);await client.connect();
  assert.deepEqual([...await client.readMemory(0,4)],[0x12,0x34,0x56,0x78]);
  assert.equal(await client.readRegister("pc"),0x12345678);
  assert.deepEqual([...await client.readMemory(0,8)],Array(8).fill(0));
  await client.writeRegister("msp",0x20020000);
  assert.ok(rawCalls.includes(packet("Pd=00000220")));
  assert.ok(!rawCalls.includes("\x03")&&!rawCalls.includes(packet("c")),"attach and register reads must not auto halt/resume");
  await client.halt();await client.resume();client.close();
 });
 await new Promise(r=>rawServer.close(r));
 console.log(`remoteadapter: ${checks} checks passed`);
} finally { await rm(dir,{recursive:true,force:true}); }
