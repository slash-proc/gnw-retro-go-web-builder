import {test,expect} from '../fixtures.mjs';
import {captureQmpPng} from '../device.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspectNativeSources} from '../native-seed.mjs';
import {goToTab,goToOverviewPane,goToFirmwarePane,goToGuidedSetup} from '../workflows/navigation.mjs';
import {openDirectorySources,addRunLocalBackupSource} from '../workflows/sources.mjs';
import {waitForLibrarySettled,assertFullLibrary,findGameBoyTetris} from '../workflows/library.mjs';
import {chooseGuidedPath} from '../workflows/guided-setup.mjs';
import {backupLockedStock} from '../workflows/backup.mjs';
import {patchStockFirmware} from '../workflows/patch.mjs';
import {returnToStockAndAssertUnlocked} from '../workflows/status.mjs';
import {installPublishedRetroGo,syncLibraryItem,rebootToRetroGoAndSelectTetris} from '../workflows/retro-go.mjs';

const plan=JSON.parse(process.env.GNW_TEST_PLAN||'[]');
const fullBrowserInstrumentation=process.env.GNW_TEST_BROWSER_INSTRUMENTATION==='full';
test('run ordered feature building blocks in one native browser/device session',async({page,device},testInfo)=>{
  test.setTimeout(30*60_000);
  const report=process.env.GNW_TEST_REPORT_DIR;
  const history=[],browserLog=[],io={rendererMemory:[]};
  const screenshotEntries=[];
  let screenshotSequence=0;
  const captureName=(kind,name)=>`${String(++screenshotSequence).padStart(3,'0')}-${kind}-${name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')}`;
  const checkpoint=async(page,info,name)=>{
    const filename=captureName('browser',name);
    const image=await page.screenshot();
    if(report){const directory=path.join(report,'screenshots');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,`${filename}.png`),image);}
    await info.attach(filename,{body:image,contentType:'image/png'});
    screenshotEntries.push({sequence:screenshotSequence,kind:'browser',name,filename:`${filename}.png`,capturedAt:new Date().toISOString()});
  };
  const emulatorCheckpoint=async(device,info,name)=>{
    if(!device.qmp)return null;
    const filename=captureName('device',name);
    const directory=report?path.join(report,'screenshots'):info.outputDir;
    await fs.mkdir(directory,{recursive:true});
    const file=path.join(directory,`${filename}.png`);
    const ppm=path.join(directory,`${filename}.ppm`);
    await captureQmpPng(device.qmp,ppm,file);
    await info.attach(filename,{path:file,contentType:'image/png'});
    screenshotEntries.push({sequence:screenshotSequence,kind:'device',name,filename:`${filename}.png`,capturedAt:new Date().toISOString()});
    return file;
  };
  page.on('console',message=>{browserLog.push(message.text());if(browserLog.length>1000)browserLog.shift();});
  page.on('pageerror',error=>browserLog.push(error.stack));
  await page.exposeBinding('__nativeTestTelemetry',async(_,sample)=>{
    io.rendererMemory.push(sample);if(io.rendererMemory.length>90)io.rendererMemory.shift();
    if(fullBrowserInstrumentation)await fs.appendFile(path.join(report,'operation-telemetry.jsonl'),JSON.stringify(sample)+'\n');
  });
  await page.addInitScript(({fullBrowserInstrumentation,workflowProgressNeeded})=>{
    if(!fullBrowserInstrumentation&&!workflowProgressNeeded)return;
    let progress=null;
    import('/src/lib/installProgress.svelte.js').then(module=>progress=module.installProgress).catch(()=>{});
    setInterval(()=>{
      const dialog=document.querySelector('[role="dialog"]');
      const sample={at:Date.now(),modalText:dialog?.innerText||'',
        installProgress:progress?{modalPhase:progress.modalPhase,error:progress.error,phases:progress.phaseState}:null,
      };
      if(fullBrowserInstrumentation){
        const memory=performance.memory;
        const images=[...document.images];
        sample.heap={used:memory?.usedJSHeapSize??null,limit:memory?.jsHeapSizeLimit??null};
        sample.dom={nodes:document.getElementsByTagName('*').length,images:images.length,
          decodedImages:images.filter(image=>image.complete&&image.naturalWidth>0).length,
          canvasBytes:[...document.querySelectorAll('canvas')].reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0)};
        sample.libraryPhases=window.gnwLibraryPerformanceReport?.()||null;
        sample.gdb=window.__gnwGdbDebug?.snapshot?.()||null;
        sample.covers=window.__gnwCoverDebug?.snapshot?.()||null;
        sample.carousel=window.__gnwCarouselDebug?.snapshot?.()||null;
      }
      void window.__nativeTestTelemetry(sample).catch(()=>{});
    },1000);
  },{fullBrowserInstrumentation,workflowProgressNeeded:plan.some(name=>['firmware/dualboot-install','library/sync-tetris'].includes(name))});
  await page.goto('/#sources/local-directories');
  const flash=page.getByRole('button',{name:/Flash Memory.*internal flash chip/i});
  if(await flash.isVisible())await flash.click();
  const manage=page.getByRole('button',{name:/^Manage Device Backup/i});
  if(await manage.isVisible())await manage.click();
  await page.goto('/#sources/local-directories');
  const expected=JSON.parse(process.env.GNW_TEST_DIRECTORY_MAP||'[]');
  const milestones={stockReconnectSamples:[],milestones:[]};
  let returnedToStock=false;
  const args={page,device,testInfo,checkpoint,emulatorCheckpoint,io,browserLog,milestones};
  const status=async locked=>{
    if(!locked && plan.includes('firmware/device-patch-unlock') && !returnedToStock){
      await returnToStockAndAssertUnlocked(args);returnedToStock=true;return;
    }
    await goToOverviewPane(page,'Status');
    const row=page.locator('.rows .row').filter({hasText:/Read protection/i}).locator('dd');
    await expect(row).toHaveText(locked?/^Locked$/i:/^Unlocked$/i,{timeout:90_000});
  };
  const actions={
    'sources/directories-persist':async()=>{
      await openDirectorySources(page);
      const rows=await inspectNativeSources(page);
      expect(rows.map(row=>row.name).sort()).toEqual(expected.map(d=>d.name).sort());
      for(const row of rows){expect(row.native).toBe(true);expect(row.permission).toBe('granted');expect(row.readable).toBe(true);}
    },
    'sources/add-directories':async()=>{
      // A prepared seed already contains these sources. Verify the registration
      // rather than substituting or reopening its native picker in headless mode.
      await actions['sources/directories-persist']();
    },
    'sources/add-ofw-backup':async()=>{
      const source=expected.find(row=>row.group==='ofw_backups');
      if(!source)throw new Error('No isolated run-local backup directory was prepared');
      await addRunLocalBackupSource(page,source);
    },
    'library/settle':async()=>{
      await goToTab(page,'library');
      await waitForLibrarySettled(page,{fullCollection:true});
      const result=await assertFullLibrary(page);
      await fs.writeFile(path.join(report,'full-library.json'),JSON.stringify(result,null,2));
      await findGameBoyTetris(page);
      await page.getByRole('searchbox').fill('');
      await waitForLibrarySettled(page,{fullCollection:true});
    },
    'overview/navigation':async()=>{
      for(const name of ['Status','Details','Activity','Device log'])await goToOverviewPane(page,name);
      for(const name of ['firmware','sources','library','overview'])await goToTab(page,name);
    },
    'overview/status-page-retro-go':async()=>{
      await goToOverviewPane(page,'Status');
      await expect(page.locator('.rows .row').filter({hasText:/Read protection/i}).locator('dd')).toHaveText(/^Unlocked$/i,{timeout:90_000});
      await expect(page.locator('body')).toContainText(/Connected \(Retro-Go\)/i,{timeout:90_000});
      await emulatorCheckpoint(device,testInfo,'retro-go-ready');
    },
    'overview/status-page-locked':()=>status(true),
    'overview/status-page-unlocked':()=>status(false),
    'overview/status':()=>goToOverviewPane(page,'Status'),
    'firmware/guided-setup':()=>goToGuidedSetup(page),
    'firmware/device-backup':async()=>{await chooseGuidedPath(page,'dual');await backupLockedStock(args);},
    'firmware/device-patch-unlock':async()=>{await chooseGuidedPath(page,'dual');await patchStockFirmware(args);},
    'firmware/advanced-panes':async()=>{
      for(const pane of ['OFW Backup & Patch','Install','File Browser','Write image','Dump','Erase'])await goToFirmwarePane(page,pane);
    },
    'firmware/dualboot-install':async()=>{await chooseGuidedPath(page,'dual');await patchStockFirmware(args);await installPublishedRetroGo(args);},
    'library/sync-tetris':async()=>{
      await syncLibraryItem({...args,searchTerm:'Tetris (USA) (Rev-A)',rowText:'Tetris (USA) (Rev-A)',
                            romSummary:{system:'gb',filename:'Tetris (USA) (Rev-A).gb'},continueToLibrary:true});
      await rebootToRetroGoAndSelectTetris(args);
    },
  };
  try {
    for(const name of plan){
      if(!actions[name])throw new Error(`No native workflow for ${name}`);
      const started=Date.now();
      await test.step(name,async()=>{await actions[name]();await checkpoint(page,testInfo,name.replaceAll('/','-'));});
      history.push({name,status:'passed',elapsedMs:Date.now()-started});
    }
  }catch(error){
    history.push({name:plan[history.length],status:'failed',error:error.stack});
    await checkpoint(page,testInfo,'failure').catch(()=>{});throw error;
  }finally{
    const screenshotIndex=JSON.stringify(screenshotEntries,null,2)+'\n';
    await fs.mkdir(path.join(report,'screenshots'),{recursive:true});
    await fs.writeFile(path.join(report,'screenshot-index.json'),screenshotIndex);
    await fs.writeFile(path.join(report,'steps.json'),JSON.stringify(history,null,2));
    for(const name of ['steps.json','screenshot-index.json','operation-telemetry.jsonl','full-library.json']){
      const file=path.join(report,name);if(await fs.stat(file).catch(()=>null))await testInfo.attach(name,{path:file,contentType:name.endsWith('.json')?'application/json':'text/plain'});
    }
  }
});
