// Run the real vendored WebSTLink protocol against a WebUSB simulator. No hardware IO.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { gnwResolveFor } from "./gnwResolve.mjs";
const root = new URL("../../../", import.meta.url).pathname;
const baseline = process.env.STLINK_BASELINE === "1";
const source = (file) => baseline ? execFileSync("git", ["-c", `safe.directory=${process.env.STLINK_GIT_ROOT || root}`, "show", `main:${file}`], {cwd:process.env.STLINK_GIT_ROOT || root, encoding:"utf8"}) : readFileSync(join(root,file),"utf8");
const dir = await mkdtemp(join(tmpdir(), "gnw-stlink-"));
globalThis.navigator = {usb: {}};
const logs = [];
globalThis.__stlinkLogs = logs;
try {
  const outfile = join(dir,"transport.mjs");
  await build({entryPoints:[join(root,"apps/web/src/lib/engine/transport.ts")], outfile,
    bundle:true, platform:"node", format:"esm", plugins:[{
      name:"usb-fixture", setup(b) {
        b.onResolve({filter:/^@webstlink\//}, a=>({path:join(root,"frontend/vendor/webstlink/src",a.path.slice(11))}));
        b.onResolve({filter:/^dapjs$/}, ()=>({path:"dap",namespace:"fixture"}));
        b.onResolve({filter:/^\.\.\/debug\.js$/}, ()=>({path:"debug",namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path==="debug" ?
          "export const dbg = line => globalThis.__stlinkLogs.push(line);" :
          "export class CortexM {} export class WebUSB {}"}));
        if(baseline) b.onLoad({filter:/\/engine\/transport\.ts$/},()=>({contents:source("apps/web/src/lib/engine/transport.ts"),loader:"ts"}));
      }
    },gnwResolveFor(import.meta.url)]});
  const {connectProbe,chooseProbe,ProbePickerDismissed} = await import(pathToFileURL(outfile));
  function usbDevice({delay=0,openError,clockError=false}={}) {
    let command;
    const calls={open:0,reset:0,close:0,commands:[]};
    const dev={vendorId:0x0483,productId:0x3748,opened:false,
      configuration:{configurationValue:1,interfaces:[{claimed:false,alternate:{alternateSetting:0}}]},
      async open(){calls.open++;await new Promise(r=>setTimeout(r,delay));if(openError)throw openError;this.opened=true;},
      async reset(){calls.reset++;}, async close(){calls.close++;this.opened=false;},
      async selectConfiguration(){},async claimInterface(){this.configuration.interfaces[0].claimed=true;},
      async selectAlternateInterface(){},
      async transferOut(endpoint,data){assert.equal(endpoint,2);command=[...new Uint8Array(data)];calls.commands.push(command);return {status:"ok",bytesWritten:data.byteLength};},
      async transferIn(endpoint,size){
        assert.equal(endpoint,1);
        const bytes=new Uint8Array(size);const view=new DataView(bytes.buffer);
        if(command[0]===0xf1)view.setUint16(0,(2<<12)|(22<<6),false);
        else if(command[0]===0xf5)bytes[0]=1;
        else if(command[0]===0xf7){view.setUint32(0,100,true);view.setUint32(4,100,true);}
        else if(command[0]===0xf2 && command[1]===0x22)view.setUint32(0,0x2ba01477,true);
        else bytes[0]=clockError && calls.commands.filter(c=>c[0]===0xf2 && c[1]===0x43).length===2?0:0x80;
        return {status:"ok",data:view};
      }
    };return {dev,calls};
  }
  const tests={
    async slow(){
      const {dev,calls}=usbDevice({delay:1200});
      const handle=await connectProbe({device:dev});
      assert.equal(calls.open,1,"A slow ST-Link attachment must not open concurrent USB sessions");
      assert.equal(calls.reset,0,"Attachment must not reset the USB programmer on a JS timeout");
      assert.match(handle.probeName,/ST-Link\/V2/);
      assert.ok(!calls.commands.some(c=>c[0]===0xf2 && [0x02,0x03].includes(c[1])),"Attachment must not halt or resume the target");
      await handle.dispose();assert.equal(dev.opened,false);
    },
    async cancellation(){
      const gone=new DOMException("Device unavailable.","NotFoundError");
      globalThis.navigator={usb:{requestDevice:async()=>{throw gone;},getDevices:async()=>[]}};
      let cancelled;try{await chooseProbe();}catch(e){cancelled=e;}
      assert.ok(ProbePickerDismissed && cancelled instanceof ProbePickerDismissed,"Picker dismissal must be tagged at the requestDevice boundary");
      const {dev,calls}=usbDevice({openError:gone});
      await assert.rejects(connectProbe({device:dev}),e=>e===gone);
      assert.equal(calls.reset,0,"A disconnected adapter must not receive forced reset retries");
      const store=source("apps/web/src/lib/device.svelte.ts");
      const ast=ts.createSourceFile("device.ts",store,ts.ScriptTarget.Latest,true);
      const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="isPickerDismissal");
      const js=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
      const context={ProbePickerDismissed,DOMException};vm.createContext(context);vm.runInContext(js,context);
      assert.equal(context.isPickerDismissal(cancelled),true);
      assert.equal(context.isPickerDismissal(gone),false,"USB loss must not be silently treated as cancelling the chooser");
    },
    async clock(){
      const {dev,calls}=usbDevice({clockError:true});
      await assert.rejects(connectProbe({device:dev}),/Error switching SWD frequency/);
      assert.equal(dev.opened,false,"Clock setup failure must release the attached USB interface");
      assert.equal(calls.close,1);
      assert.ok(logs.some(line=>line.includes("SWD clock failed")),"Attachment failures must reach the app debug log");
    }
  };
  for(const [name,run] of Object.entries(tests)){
    if(process.env.STLINK_CASE && process.env.STLINK_CASE!==name)continue;
    await run();console.log(`OK ST-Link ${name}`);
  }
} finally {delete globalThis.__stlinkLogs;await rm(dir,{recursive:true,force:true});}
