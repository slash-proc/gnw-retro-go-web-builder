import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
const desktop = process.env.GNW_TEST_DESKTOP === '1';
const desktopCommand = (...args) => execFileSync('xdotool', args.map(String));
const profile = process.env.GNW_TEST_BROWSER_PROFILE_DIR;
const report = process.env.GNW_TEST_REPORT_DIR;
const expected = JSON.parse(process.env.GNW_TEST_DIRECTORY_MAP || '[]');
const headed = process.env.GNW_TEST_HEADLESS === '0';
const keepDesktop = process.env.GNW_TEST_KEEP_DESKTOP === '1';
const appUrl = process.env.GNW_TEST_APP_URL || 'http://127.0.0.1:3000/';
const evidence = [];
const browserLog=[];
async function open(headless) {
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.GNW_TEST_CHROMIUM_EXECUTABLE ? {executablePath:process.env.GNW_TEST_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
    headless, viewport: headless ? {width:1920,height:1080} : null,
    ignoreHTTPSErrors: appUrl.startsWith('https://'),
    args: headless ? [] : [desktop ? '--ozone-platform=x11' : '--ozone-platform=wayland','--start-maximized','--lang=en-US'],
  });
  await context.addInitScript(()=>{const pick=window.showDirectoryPicker; window.showDirectoryPicker=async function(...args){console.info('[native-picker] requested',JSON.stringify(args));try{const handle=await pick.apply(this,args);console.info('[native-picker] selected',handle.name);return handle;}catch(error){console.error('[native-picker]',error.name,error.message);throw error;}};});
  const page = context.pages()[0] || await context.newPage();
  page.on('console',message=>{browserLog.push(`${new Date().toISOString()} ${message.type()} ${message.text()}`);if(browserLog.length>1000)browserLog.shift();});
  page.on('pageerror',error=>browserLog.push(`${new Date().toISOString()} ERROR ${error.stack}`));
  await page.goto(new URL('#sources/local-directories',appUrl).href);
  await page.waitForTimeout(1000);
  const flash = page.getByRole('button', {name:/Flash Memory.*internal flash chip/i});
  if (await flash.isVisible()) await flash.click();
  const manage = page.getByRole('button', {name:/^Manage Device Backup/i});
  if (await manage.isVisible()) await manage.click();
  await page.goto(new URL('#sources/local-directories',appUrl).href);
  await expect(page.getByRole('button',{name:/add source/i}).last()).toBeVisible();
  return {context,page};
}
export async function inspectNativeSources(page) {
  return page.evaluate(async () => {
    const {loadSel,loadDir} = await import('/src/lib/persist.js');
    const folders=loadSel('localFolders.v1',[]);
    return Promise.all(folders.map(async folder => {
      const handle = await loadDir(`localFolder:${folder.id}`);
      const result = {name:folder.folderName || folder.name, usedBy:[...folder.usedBy], native:handle instanceof FileSystemDirectoryHandle};
      try {
        result.permission = await handle.queryPermission({mode:'readwrite'});
        if (result.permission === 'granted') {
          await handle.entries().next();
          result.readable = true;
        }
      } catch(error) { result.error = error.message; }
      return result;
    }));
  });
}
const inspect = inspectNativeSources;
function registered(rows) {
  return expected.every(source => rows.some(row => row.name === source.name && row.native &&
    (source.group === 'ofw_backups' ? row.usedBy.includes('__ofw_backup__') :
     source.group === 'firmware_bios' ? row.usedBy.includes('bios') : row.usedBy.length === 0)));
}
function complete(rows) {
  return registered(rows) && expected.every(source => rows.some(row => row.name === source.name && row.native && row.readable &&
    (source.group === 'ofw_backups' ? row.usedBy.includes('__ofw_backup__') :
     source.group === 'firmware_bios' ? row.usedBy.includes('bios') : row.usedBy.length === 0)));
}
async function stage(label, interactive) {
  const {context,page} = await open(!interactive);
  try {
    if (interactive) console.log(`${label}: add configured directory sources through the app. After restart, allow access permanently when Chromium prompts. Close no windows; the harness continues when all sources are readable.`);
    const deadline = Date.now() + (interactive ? 30*60_000 : 30_000);
    let rows;
    do {
      rows = await inspect(page);
      if (complete(rows)) break;
      await page.waitForTimeout(1000);
    } while(Date.now() < deadline);
    await page.screenshot({path:`${report}/${label}.png`,fullPage:true});
    evidence.push({stage:label,passed:complete(rows),folders:rows});
    await fs.writeFile(`${report}/directory-persistence.json`, JSON.stringify(evidence,null,2));
    if (!complete(rows)) throw new Error(`${label}: native directory access unavailable. Open the seed headed and choose persistent access for each source.`);
  } finally { await context.close(); }
}
async function desktopCapture(label) {
  execFileSync('import', ['-window','root',`${report}/${label}.png`]);
  const tsv=execFileSync('tesseract',[`${report}/${label}.png`,'stdout','--psm','11','tsv'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  await fs.writeFile(`${report}/${label}.tsv`,tsv);
  return tsv;
}
async function clickPermission(label, persistent, pattern = /^(allow|edit|share)$/i) {
  const deadline = Date.now()+20_000;
  while(Date.now()<deadline) {
    const tsv = await desktopCapture(label);
    const words = tsv.split('\n').slice(1).map(line=>line.split('\t')).filter(row=>row.length>=12 && row[11].trim()).map(row=>{row[11]=row[11].replace(/^[^A-Za-z]+|[^A-Za-z]+$/g,'');return row;});
    if (!persistent && pattern.source !== '^open$') {
      const openButton=words.find(word=>/^open$/i.test(word[11].trim()));
      if(openButton) desktopCommand('mousemove',Number(openButton[6])+Number(openButton[8])/2,Number(openButton[7])+Number(openButton[9])/2,'click',1);
    }
    if (!persistent && pattern.source !== '^open$' && words.some(word=>/^allow$/i.test(word[11]) && Number(word[7])<150) && words.some(word=>/^edit$/i.test(word[11]))) {
      desktopCommand('key','Tab');
      await new Promise(resolve=>setTimeout(resolve,150));
      desktopCommand('key','Return');
      return;
    }
    const permanent = words.find(word=>/^allow$/i.test(word[11]) &&
      ['on','every','visit'].every(token=>words.some(other=>other[11].toLowerCase()===token && Math.abs(Number(other[7])-Number(word[7]))<12)));
    const allow = persistent ? permanent : words.toSorted((a,b)=>Number(b[6])-Number(a[6])).find(word=>pattern.test(word[11].trim()));
    if (allow) {
      desktopCommand('mousemove',Number(allow[6])+Number(allow[8])/2,Number(allow[7])+Number(allow[9])/2,'click',1);
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`No ${persistent?'Allow on every visit / Always allow':'Allow'} browser permission control found; desktop screenshot saved`);
}
async function automaticSetup() {
  let {context,page} = await open(false);
  try {
    for (const [index,source] of expected.entries()) {
      const rows = await inspect(page);
      if (rows.some(row=>row.name===source.name && row.native)) {console.log(`Source already registered: ${source.path}`);continue;}
      console.log(`Adding native directory: ${source.path}`);
      await page.getByRole('button',{name:/add source/i}).last().click();
      await page.getByRole('button',{name:/choose/i}).click();
      // The native GTK folder picker receives the path through its location field.
      const pickerDeadline=Date.now()+10_000;
      let picker;
      while(Date.now()<pickerDeadline) {
        try {picker=desktopCommand('search','--onlyvisible','--name','^Select where this site can save changes$').toString().trim();}catch {}
        if(picker)break;
        await page.waitForTimeout(200);
      }
      if(!picker)throw new Error('Native folder picker did not open');
      await desktopCapture(`picker-before-${index}`);
      desktopCommand('key','ctrl+l');
      desktopCommand('type','--clearmodifiers','--',source.path);
      await page.waitForTimeout(700);
      await desktopCapture(`picker-typed-${index}`);
      const [screenWidth] = desktopCommand('getdisplaygeometry').toString().trim().split(/\s+/).map(Number);
      desktopCommand('mousemove',Math.floor(screenWidth/2),86,'click',1);
      await page.waitForTimeout(200);
      await clickPermission(`picker-open-${index}`,false,/^open$/i);
      await desktopCapture(`before-permission-${index}`);
      await clickPermission(`picker-permission-${index}`,false);
      await desktopCapture(`after-permission-${index}`);
      await expect(page.locator('.fvalue')).toContainText(source.name);
      const association = source.group==='ofw_backups'?'OFW backup':source.group==='firmware_bios'?'BIOS':null;
      if (association) {
        await page.locator('.usedby .field').click();
        await page.locator('.usedby .opt').filter({hasText:association}).click();
      }
      await page.getByRole('button',{name:/add source/i}).last().click();
      await expect(page.locator('.card').filter({hasText:source.name}).last()).toBeVisible();
    }
    const rows=await inspect(page);
    evidence.push({stage:'01-native-sources-saved',passed:registered(rows),folders:rows});
    if(!registered(rows))throw new Error('Not all directory sources were saved with the correct associations');
    await page.screenshot({path:`${report}/01-native-sources-saved.png`});
    console.log('All native sources saved; closing Chromium before requesting permanent access.');
  } catch(error) {
    await desktopCapture('desktop-failure');
    if (keepDesktop) {
      await fs.writeFile(`${report}/browser-console.log`,browserLog.join('\n'));
      console.error(error.stack);
      console.log('Source addition failed; browser left open for inspection.');
      await new Promise(resolve=>setInterval(()=>{},60_000));
    }
    throw error;
  } finally {await context.close();}
  console.log('Chromium closed. Restarting the same profile to grant permanent access.');
  ({context,page} = await open(false));
  if (process.env.GNW_TEST_STOP_AFTER_SOURCE_RESTART === '1') {
    await desktopCapture('02-restarted-directory-sources');
    await fs.writeFile(`${report}/directory-persistence.json`,JSON.stringify(evidence,null,2));
    await fs.writeFile(`${report}/browser-console.log`,browserLog.join('\n'));
    console.log('Stopped at Directory Sources after restart. No Configure or permission controls clicked.');
    await new Promise(()=>setInterval(()=>{},60_000));
  }
  try {
    for(const [index,source] of expected.entries()) {
      const rows = await inspect(page);
      if(rows.some(row=>row.name===source.name && row.readable)) continue;
      const card = page.locator('.card').filter({hasText:source.name}).last();
      await card.getByRole('button',{name:/configure/i}).click();
      await clickPermission(`persistent-permission-${index}`,true);
      await page.reload();
      await page.goto(new URL('#sources/local-directories',appUrl).href);
      await expect(page.getByRole('button',{name:/add source/i}).last()).toBeVisible();
    }
    const rows=await inspect(page);
    evidence.push({stage:'virtual-desktop-provision',passed:complete(rows),folders:rows});
    await fs.writeFile(`${report}/directory-persistence.json`,JSON.stringify(evidence,null,2));
    if(!complete(rows)) throw new Error('Desktop provision did not yield readable native handles');
    if (keepDesktop) {
      await context.close();
      ({context,page} = await open(false));
      await expect.poll(async()=>complete(await inspect(page)),{timeout:30_000}).toBe(true);
      evidence.push({stage:'headed-restart-persistence',passed:true,folders:await inspect(page)});
      await desktopCapture('03-permissions-survived-restart');
      await fs.writeFile(`${report}/directory-persistence.json`,JSON.stringify(evidence,null,2));
    }
  } catch(error) {await desktopCapture('desktop-failure'); throw error;} finally {if(!keepDesktop) await context.close();}
}
export async function runSeed(step = async (_name,action)=>action()) {
  try {
    if (desktop) await step('Provision native sources and permanent access on virtual desktop',automaticSetup);
    else if (headed) {
      await step('Add native directory sources',()=>stage('01-add-native-sources',true));
      await step('Restart Chromium and grant permanent access',()=>stage('02-restart-and-allow',true));
    }
    if (keepDesktop) {
      console.log('Stages 1 and 2 passed; browser remains open for manual inspection. Headless verification has not run.');
      return;
    }
    await step('Verify native handles and permissions after true headless restart',()=>stage('03-headless-restart',false));
    console.log('PASS: native handles and permissions survived browser restart without re-registering sources.');
  } catch(error) {
    evidence.push({stage:'failure',passed:false,error:error.stack});
    throw error;
  } finally {
    await fs.writeFile(`${report}/browser-console.log`,browserLog.join('\n'));
    await fs.writeFile(`${report}/directory-persistence.json`,JSON.stringify(evidence,null,2));
  }
}
