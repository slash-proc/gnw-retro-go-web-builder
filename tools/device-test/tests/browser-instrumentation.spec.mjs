import { test, expect } from '../fixtures.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Exercise a log burst larger than the app's debug ring: report capture must
// preserve the earlier entries without periodic traversal of that ring.
test('profiling is opt-in while debug evidence survives a bounded audit buffer', async ({ page }, testInfo) => {
  const enabled = process.env.GNW_TEST_BROWSER_INSTRUMENTATION === 'full';
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push({ level: message.type(), text: message.text() }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { auditLog, MAX_DEBUG_ENTRIES } = await import('/src/lib/auditLog.svelte.js');
    const { literal } = await import('/src/lib/logEntry.js');
    const { measureLibraryPhase } = await import('/src/lib/libraryPerformance.js');
    await window.__gnwTestFlushAuditLog();
    measureLibraryPhase('instrumentation-probe', 1, () => 42);
    const count = MAX_DEBUG_ENTRIES + 25;
    for (let index = 0; index < count; index++) auditLog.add('debug', 'device', literal(`audit-probe:${index}`));
    console.debug('console-debug-probe');
    for (let index = 0; index < 1025; index++) console.debug(`console-burst:${index}`);
    await window.__gnwTestFlushAuditLog();
    return { count, retained: auditLog.entries.filter(entry => entry.message.text?.startsWith('audit-probe:')).length,
      enabled: window.__GNW_BROWSER_INSTRUMENTATION__, phases: window.gnwLibraryPerformanceReport?.() ?? null };
  });
  expect(result.enabled).toBe(enabled);
  expect(result.retained).toBeLessThan(result.count);
  if (enabled) expect(result.phases).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'instrumentation-probe', calls: 1 })]));
  else expect(result.phases).toBeNull();
  const report = process.env.GNW_TEST_REPORT_DIR || testInfo.outputDir;
  const records = (await readFile(path.join(report, 'app-debug.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const captured = records.filter(record => record.text.includes('audit-probe:'));
  expect(captured).toHaveLength(result.count);
  expect(captured[0].text).toContain('audit-probe:0');
  expect(captured.at(-1).text).toContain(`audit-probe:${result.count - 1}`);
  expect(consoleMessages).toContainEqual({ level: 'debug', text: 'console-debug-probe' });
  await expect.poll(async () => (await readFile(path.join(report, 'browser-console.log'), 'utf8').catch(() => '')).includes('console-burst:1024')).toBe(true);
  const consoleLog = await readFile(path.join(report, 'browser-console.log'), 'utf8');
  expect(consoleLog.split('\n').filter(line => line.includes('console-burst:'))).toHaveLength(1025);
  expect(consoleLog).toContain('console-burst:0');
});
