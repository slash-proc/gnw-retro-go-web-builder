// Render both modes of the real adapter modal; initializer rewrites are guarded.
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";
const web = new URL("..", import.meta.url).pathname;
const src = join(web,"src/lib/ui/DeviceControls.svelte");
const source = readFileSync(process.env.REMOTE_MODAL_SOURCE || src,"utf8");
const init = "let configureOpen = $state(false);";
assert.equal(source.split(init).length,2);
const dir = mkdtempSync(join(web,"node_modules/.remote-ui-"));
try {
 const bodies=[];
 for(const mode of ["usb","remote"]){
  const armed=source.replace(init,"let configureOpen = $state(true);").replace('let adapterType = $state<AdapterType>("usb");',`let adapterType = $state<AdapterType>("${mode}");`);
  const outfile=join(dir,`${mode}.mjs`);
  await build({entryPoints:[src],outfile,bundle:true,platform:"node",format:"esm",external:["svelte","svelte/*"],loader:{".svg":"dataurl"},plugins:[{name:"modal",setup(b){
   const stubs={"device.svelte.js":"export const device={adapterFrequencyHz:1000000};export class StubLoadCancelled extends Error {}", "installProgress.svelte.js":"export const deviceSafety={writeInProgress:false}","auditLog.svelte.js":"export const auditLog={}","remoteAdapter.js":"export const DEFAULT_REMOTE_PORT=8765", "transport.js":"export const getKnownProbes=async()=>[]"};
   b.onResolve({filter:/\/(device\.svelte|installProgress\.svelte|auditLog\.svelte|remoteAdapter|transport)\.js$/},a=>({path:a.path.split("/").at(-1),namespace:"stub"}));
   b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"js"}));
   b.onLoad({filter:/\.svelte$/},a=>({contents:compile(a.path===src?armed:readFileSync(a.path,"utf8"),{generate:"server",filename:a.path,runes:true}).js.code,loader:"js"}));
   b.onLoad({filter:/\.svelte\.ts$/},async a=>({contents:compileModule((await transform(readFileSync(a.path,"utf8"),{loader:"ts"})).code,{generate:"server",filename:a.path}).js.code,loader:"js"}));
  }}]});
  bodies.push(render((await import(pathToFileURL(outfile))).default).body);
 }
 assert.notEqual(bodies[0],bodies[1]);
 for(const body of bodies){assert.match(body,/USB Programmer/);assert.match(body,/Remote gnwmanager/);}
 assert.match(bodies[0],/adapter-frequency/); assert.doesNotMatch(bodies[0],/id="remote-host"/);
 assert.match(bodies[1],/id="remote-host"/);assert.match(bodies[1],/8765/);assert.doesNotMatch(bodies[1],/id="adapter-frequency"/);
 // Exercise the actual modal click handler and retry-success effect, alongside rendering.
 const script=source.slice(source.indexOf(">")+1,source.indexOf("</script>"));
 const ast=ts.createSourceFile("controls.ts",script,ts.ScriptTarget.Latest,true);
 const fn=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
 const retryEffect=ast.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&
   n.expression.expression.getText(ast)==="$effect"&&n.getText(ast).includes("!connectRequested"));
 assert.ok(retryEffect,"The adapter modal must observe the success of its pending Connect request");
 const effect=retryEffect.expression.arguments[0].getText(ast);
 const modalCode=ts.transpileModule(`
   let adapterType="remote", remoteHost="localhost", remotePort=8765;
   let configureOpen=true, configuring=false, configureError=null, connectRequested=false;
   let customFrequencyMode=false;
   ${fn("confirmAdapterConfig")}
   ${fn("dismissAdapterConfig")}
   const retryEffect=${effect};
   globalThis.modal={confirm:confirmAdapterConfig,dismiss:dismissAdapterConfig,retryEffect,
     state:()=>({open:configureOpen,error:configureError,pending:connectRequested})};
 `,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let resolved=0;
 const device={adapterType:"remote",remoteHost:"localhost",remotePort:8765,isConnected:false,
   connect:async()=>{throw new Error("Remote adapter connection closed");},
   resolveAdapterConfiguration:()=>resolved++};
 const context={device,locale:{t:{shared:{connectGateModal:{connectionFailed:"Connection failed"}}}}};
 vm.createContext(context);vm.runInContext(modalCode,context);
 await context.modal.confirm();
 assert.equal(context.modal.state().open,true);
 assert.match(context.modal.state().error,/connection closed/);
 device.isConnected=true;context.modal.retryEffect();
 assert.equal(context.modal.state().open,false,"A successful automatic retry must close the modal");
 assert.equal(context.modal.state().error,null,"A successful retry must clear the stale error");
 assert.equal(resolved,1);
 const cancelled={device,locale:context.locale};vm.createContext(cancelled);
 vm.runInContext(modalCode,cancelled);cancelled.modal.dismiss();
 cancelled.modal.retryEffect();assert.equal(resolved,1,"Cancelling the modal must abandon its pending request");
 console.log("remoteadapter-ui: both modes rendered; Connect retry and Cancel behavior passed");
} finally {rmSync(dir,{recursive:true,force:true});}
