import {test} from '@playwright/test';
import fs from 'node:fs/promises';
import {runSeed} from '../native-seed.mjs';

test('Native directory permissions persist across Chromium processes',async ({},testInfo)=>{
  test.setTimeout(process.env.GNW_TEST_HEADLESS==='0'?65*60_000:5*60_000);
  const report=process.env.GNW_TEST_REPORT_DIR;
  try {
    await runSeed((name,action)=>test.step(name,action));
  } finally {
    for(const file of await fs.readdir(report)) {
      if(file.endsWith('.png') || file==='directory-persistence.json' || file==='browser-console.log') {
        await testInfo.attach(file,{path:`${report}/${file}`,contentType:file.endsWith('.png')?'image/png':file.endsWith('.json')?'application/json':'text/plain'});
      }
    }
  }
});
