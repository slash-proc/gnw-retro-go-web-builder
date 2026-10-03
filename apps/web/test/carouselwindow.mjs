#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
import ts from "typescript";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mutation = process.env.GNW_CAROUSEL_MUTATION;
const bundle = await esbuild.build({ entryPoints:[resolve(web,"src/lib/carouselCoverWindow.ts")], bundle:true, format:"esm", write:false, plugins:[{
 name:"window-mutation",setup(b){b.onLoad({filter:/carouselCoverWindow\.ts$/},a=>({contents:readFileSync(a.path,"utf8").replace(mutation === "disable-bias" ? "Math.round(50 *" : "__no_mutation__", "Math.round(0 *"),loader:"ts"}));}
}] });
const policy = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { carouselCoverWindow, pruneCarouselCoverUrls, carouselCoverReadAllowed, CAROUSEL_COVER_CACHE_LIMIT } = policy;
let checks = 0;
const eq = (a,b,label) => { assert.deepEqual((a === undefined ? a : JSON.parse(JSON.stringify(a))),b,label); checks++; };
const stationary = carouselCoverWindow(1000,500,0,1);
eq([stationary.behind,stationary.ahead,stationary.retain.length,stationary.read.length],[60,60,121,121],"still: 60 original covers on either side");
eq(stationary.read.slice(0,5),[500,501,499,502,498],"still: nearest first, alternating sides");
eq(CAROUSEL_COVER_CACHE_LIMIT,128,"restore original cache capacity");
for (const direction of [1,-1]) {
 const moving = carouselCoverWindow(1000,500,300,direction);
 eq([moving.behind,moving.ahead,moving.retain.length],[10,110,121],"moving: shift 50 slots toward travel");
 eq(moving.read.length,111,"moving: queue center and leading side only");
 assert(moving.read.every(i=>(i-500)*direction>=0));checks++;
 const slowing = carouselCoverWindow(1000,500,15,direction);
 eq([slowing.behind,slowing.ahead],[35,85],"slowing: rebalance without expanding the window");
 const old = new Map(stationary.retain.map(i=>[String(i),"blob:"+i]));const revoked=[];
 eq(pruneCarouselCoverUrls(old,new Set(moving.retain.map(String)),url=>revoked.push(url)),50,"motion immediately drops 50 originals behind");
 eq(old.size,71,"keep center, ten trailing, and sixty already-loaded leading covers");
 assert(revoked.every(url=>(Number(url.slice(5))-500)*direction < -10));checks++;
}
for(const center of [0,999]) {
 const window=carouselCoverWindow(1000,center,0,1);
 assert(window.retain.every(i=>i>=0&&i<1000));checks++;
 eq(window.retain.length,61,"library edges clamp rather than queue missing cards");
}
eq(carouselCoverWindow(0,0,300,-1).read,[],"empty carousel queues nothing");
eq(carouselCoverReadAllowed("old",new Set(["new"]),""),false,"obsolete completion cannot publish");
eq(carouselCoverReadAllowed("detail",new Set(["new"]),"detail"),true,"an open details modal may load its own cover");

function functions(path,names) {
 const source=readFileSync(resolve(web,path),"utf8").match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join("\n");
 if(mutation==="allow-stale") code=code.replace("coverReadAllowed(job.gameKey) && !job.cache.has", "!job.cache.has");
 if(mutation==="suppress-originals" && path.includes("Carousel.svelte")) code=code.replace("const fullUrl =", "if (getAtlasCell(covers[index]?.id, currentVersion) && index !== visualCenter) return false;\nconst fullUrl =");
 return code;
}
// Drive the actual parent window eviction, queue pruning and async completion methods.
const parent = await esbuild.transform(functions("src/lib/views/RomManagementTab.svelte",["detailCoverKey","coverReadAllowed","pruneOriginalCovers","updateCoverWindow","pumpCoverReads","cacheCoverUrl"]),{loader:"ts"});
let resolveRead;
const state={...policy, Blob, coverReadsDisposed:false, optionsOpen:false, selectedCarouselId:"",basePath:k=>k.split("\0")[0],
 fullCoverRetainKeys:new Set(stationary.retain.map(String)),fullCoverReadKeys:new Set(stationary.read.map(String)),
 coverUrls:new Map(stationary.retain.map(i=>[String(i),"blob:"+i])),coverUrlPaths:new Map(),
 coverReadQueue:[],coverLoads:new Set(),activeCoverReads:0,COVER_READ_CONCURRENCY:4,
 coverReadsStarted:0,coverReadsDone:0,coverReadBytes:0,coverReadsFailed:0,
 selectedOriginalCovers:new Map(),coverPathKey:(source,path)=>source+path,
 scheduleCoverVersion:()=>{},measureLibraryPhaseAsync:(_n,_s,fn)=>fn(),
 romBytes:()=>new Promise(r=>resolveRead=r),isLazy:()=>true,
 URL:{revokeObjectURL:()=>{},createObjectURL:()=>"blob:completed"}};
runInNewContext(parent.code,state);
const job=key=>({gameKey:key,cache:state.coverUrls,entry:{release:()=>{state.releases=(state.releases??0)+1;}},loadKey:"full:"+key,cacheLimit:128});
state.coverUrls.delete("470");state.coverReadQueue.push(job("470"));state.coverLoads.add("full:470");state.pumpCoverReads();
const moving=carouselCoverWindow(1000,500,300,1);
state.coverReadQueue.push(job("480"),job("580"),job("502"),job("999"));
state.updateCoverWindow(moving.retain.map(String),moving.read.map(String));
eq(state.coverReadQueue.map(j=>j.gameKey),["502","580"],"real parent drops obsolete reads and prioritizes nearest leading covers");
eq(state.coverUrls.has("480"),false,"real parent revokes trailing cached originals");
state.coverReadQueue.length=0;
resolveRead(new Uint8Array([1,2,3]));await new Promise(r=>setImmediate(r));
eq(state.coverUrls.has("470"),false,"real async completion does not restore an evicted original");
eq(state.releases,1,"obsolete read releases its LazyRom bytes");
eq(state.activeCoverReads,0,"obsolete completion frees concurrency slot");
state.optionsOpen=true;state.selectedCarouselId="900";state.coverUrls.set("900","blob:detail");
state.updateCoverWindow(moving.retain.map(String),moving.read.map(String));
eq(state.coverReadAllowed("900"),true,"real parent permits the open details cover");
eq(state.coverUrls.has("900"),true,"real parent pins an open details cover outside the carousel window");
state.optionsOpen=false;state.pruneOriginalCovers();
eq(state.coverUrls.has("900"),false,"closing details releases the extra pinned cover");
state.coverReadsDisposed=true;state.optionsOpen=true;
eq(state.coverReadAllowed("900"),false,"leaving Library rejects late details completions too");

// Exercise the real carousel preload loop with an atlas present for every card.
const carousel=await esbuild.transform(functions("src/lib/ui/Carousel.svelte",["preloadCoverAt","preloadFullCoverAt","refreshPreloads","cancelPreloadsExcept"]),{loader:"ts"});
const requested=[];
const view={covers:Array.from({length:1000},(_,i)=>({id:String(i)})),version:1,visualCenter:500,
 fullCoverWindow:moving,debugRendered:0,lodRetryCenter:500,lodRetryCount:0,lodRetryTick:0,PRELOAD_RADIUS:120,
 getAtlasCell:()=>({url:"atlas"}),getCachedUrl:()=>"",getLodUrl:()=>"",
 getUrl:id=>{requested.push(Number(id));return "blob:"+id;},preloadUrl:()=>{},
 measureLibraryPhase:(_n,_s,fn)=>fn(),fullPreloadUrls:new Set(),decodedUrls:new Set(),
 preloadQueue:[],queuedPreloads:new Set(),pendingImages:new Map(),pendingDecodes:new Map(),pendingLodUrls:new Set()};
runInNewContext(carousel.code,view);view.refreshPreloads();
eq(requested,moving.read,"real carousel preloads originals ahead even with atlas previews available");
requested.length=0;view.fullCoverWindow=stationary;view.refreshPreloads();
eq(requested,stationary.read,"real carousel restores all 121 originals on stopping");
view.fullPreloadUrls.add("old");view.decodedUrls.add("old");view.pendingImages.set("old",{src:"old"});view.pendingDecodes.set("old",Promise.resolve());view.debugDecodeCanceled=0;
const pendingImage=view.pendingImages.get("old");view.cancelPreloadsExcept(new Set());
eq([view.decodedUrls.has("old"),view.pendingImages.has("old"),pendingImage.src],[false,false,""],"real decoder removes trailing cache markers and cancels obsolete images");

// Compile and render the actual component, rather than only checking source spellings.
const component=await esbuild.build({entryPoints:[resolve(web,"src/lib/ui/Carousel.svelte")],bundle:true,write:false,format:"esm",platform:"node",conditions:["svelte"],packages:"external",plugins:[{
 name:"carousel-ssr",setup(b){
 b.onResolve({filter:/locale\.svelte\.js$/},()=>({path:"locale",namespace:"locale"}));
 b.onLoad({filter:/.*/,namespace:"locale"},()=>({contents:'export const locale={t:{roms:{carousel:{noGames:"No games"}}}}',loader:"js"}));
 b.onLoad({filter:/\.svelte$/},async a=>({contents:compile(readFileSync(a.path,"utf8"),{generate:"server",filename:a.path,runes:true}).js.code,loader:"js"}));
 b.onLoad({filter:/\.svelte\.ts$/},async a=>({contents:compileModule((await esbuild.transform(readFileSync(a.path,"utf8"),{loader:"ts"})).code,{generate:"server",filename:a.path}).js.code,loader:"js"}));
 }}]});
// Import through a short-lived file so Svelte's package resolves in this workspace.
const {writeFileSync,unlinkSync}=await import("node:fs");
const path=resolve(web,`test/.carouselwindow-render-${process.pid}.mjs`);writeFileSync(path,component.outputFiles[0].text);
try {
 const {default:Carousel}=await import("file://"+path+"?"+Date.now());
 const html=render(Carousel,{props:{covers:[],selectedId:""}}).body;
 assert(html.includes("coverflow-empty")&&html.includes("No games"));checks++;
 const covers=Array.from({length:1000},(_,i)=>({id:String(i),name:"Cover "+i}));
 const originals=render(Carousel,{props:{covers,selectedId:"0",getUrl:id=>"blob:original-"+id}}).body;
 eq((originals.match(/class="coverflow-item__main/g)??[]).length,6,"actual markup draws the visible original covers, not the entire buffer");
 assert(originals.includes('src="blob:original-0"'));checks++;
 const atlas=render(Carousel,{props:{covers:covers.slice(0,3),selectedId:"0",getCachedUrl:id=>"blob:original-"+id,getAtlasCell:()=>({url:"blob:atlas",x:0,y:0,width:100,height:100,pageWidth:200,pageHeight:200})}}).body;
 eq((atlas.match(/class="coverflow-item__atlas(?:\s|")/g)??[]).length,3,"actual markup keeps atlas previews as the loading fallback");
 eq((atlas.match(/class="coverflow-item__main/g)??[]).length,3,"atlas preview markup still includes all resident original images");
} finally { unlinkSync(path); }
if (!mutation) {
 const {spawnSync}=await import("node:child_process");
 for(const broken of ["disable-bias","allow-stale","suppress-originals"]) {
  const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,GNW_CAROUSEL_MUTATION:broken},encoding:"utf8"});
  assert.notEqual(result.status,0,`mutation ${broken} must fail`);
  const expected={"disable-bias":"moving: shift 50 slots toward travel","allow-stale":"real async completion does not restore an evicted original","suppress-originals":"real carousel preloads originals ahead even with atlas previews available"}[broken];
  assert(result.stderr.includes(expected),`mutation ${broken} must fail the behavioral assertion: ${result.stderr}`);
  console.log(`mutation ${broken} caught: ${expected}`);checks++;
 }
}
console.log(`carousel cover window: ${checks} checks passed`);
