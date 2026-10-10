import {test,expect} from '../fixtures.mjs';
import {inspectNativeSources} from '../native-seed.mjs';

test('derive a browser preset from a stopped native seed',async({page},testInfo)=>{
  const preset=process.env.GNW_TEST_PRESET;
  const expected=JSON.parse(process.env.GNW_TEST_DIRECTORY_MAP||'[]');
  await page.goto('/#sources/local-directories');
  await page.evaluate(async({preset,expected})=>{
    const {loadSel,saveSel}=await import('/src/lib/persist.js');
    if(preset==='clean') return; // The manager creates this preset from an empty browser directory.
    const keep=new Set(expected.map(d=>d.name));
    saveSel('localFolders.v1',loadSel('localFolders.v1',[]).filter(f=>keep.has(f.folderName||f.name)));
    // Derived presets must not reuse a library cache containing removed sources.
    const keys=Object.keys(localStorage).filter(k=>/library.*cache|library.*snapshot/i.test(k));
    for(const key of keys)localStorage.removeItem(key);
  },{preset,expected});
  await page.reload();
  const flash=page.getByRole('button',{name:/Flash Memory.*internal flash chip/i});
  if(await flash.isVisible())await flash.click();
  const manage=page.getByRole('button',{name:/^Manage Device Backup/i});
  if(await manage.isVisible())await manage.click();
  await page.goto('/#sources/local-directories');
  const sources=await inspectNativeSources(page);
  expect(sources.map(row=>row.name).sort()).toEqual(expected.map(row=>row.name).sort());
  for(const source of sources) {expect(source.native).toBe(true);expect(source.permission).toBe('granted');}
  await testInfo.attach('preset-sources.json',{body:Buffer.from(JSON.stringify(sources,null,2)),contentType:'application/json'});
});
