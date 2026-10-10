import { expect } from "../fixtures.mjs";
import { goToTab } from "./navigation.mjs";
import {selectDirectoryInDesktop} from '../desktop-picker.mjs';

export async function openDirectorySources(page) {
  await goToTab(page, "sources");
  const directories = page.getByRole("button", { name: /directories/i });
  if (await directories.isVisible()) await directories.click();
  await expect(page.getByRole("navigation", { name: /sources/i })).toBeVisible();
  await expect(page.locator("h2").filter({ hasText: /directories/i })).toBeVisible();
}

/** Add one directory through the same picker and role controls a user uses. */
export async function addDirectorySource(page, source, association = null) {
  const previousRows = await page.locator(".card").filter({ hasText: source.name }).count();
  await page.getByRole("button", { name: /add source/i }).last().click();
  const form = page.locator(".form");
  await expect(form).toBeVisible();
  await page.getByRole("button", { name: /choose/i }).click();
  await expect(page.locator(".fvalue")).toContainText(source.name);
  if (association) {
    await page.locator(".usedby .field").click();
    await page.locator(".usedby .opt").filter({ hasText: association }).click();
  }
  await page.getByRole("button", { name: /add source/i }).last().click();
  const cards = page.locator(".card").filter({ hasText: source.name });
  await expect(cards).toHaveCount(previousRows + 1);
  const card = cards.last();
  await expect(card).toBeVisible();
  return card;
}

export async function addDirectorySources(page, sources, association = null) {
  for (const source of sources) await addDirectorySource(page, source, association);
}

/** Add the isolated, run-local output directory used by a pristine device backup. */
export async function addRunLocalBackupSource(page,source) {
  await openDirectorySources(page);
  const previous=await page.locator('.card').filter({hasText:source.name}).count();
  await page.getByRole('button',{name:/add source/i}).last().click();
  await page.getByRole('button',{name:/choose/i}).click();
  await selectDirectoryInDesktop(source.path,'backup-source-picker');
  await expect(page.locator('.fvalue')).toContainText(source.name);
  await page.locator('.usedby .field').click();
  await page.locator('.usedby .opt').filter({hasText:/OFW backup/i}).click();
  await page.getByRole('button',{name:/add source/i}).last().click();
  const card=page.locator('.card').filter({hasText:source.name});
  await expect(card).toHaveCount(previous+1);
  const rows=await page.evaluate(async()=>{
    const {loadSel,loadDir}=await import('/src/lib/persist.js');
    return Promise.all(loadSel('localFolders.v1',[]).map(async folder=>{
      const handle=await loadDir(`localFolder:${folder.id}`);
      return {name:folder.folderName||folder.name,usedBy:[...folder.usedBy],
        permission:await handle.queryPermission({mode:'readwrite'}),native:handle instanceof FileSystemDirectoryHandle};
    }));
  });
  const added=rows.find(row=>row.name===source.name);
  expect(added?.native).toBe(true);
  expect(added?.permission).toBe('granted');
  expect(added?.usedBy).toContain('__ofw_backup__');
  return card.last();
}
