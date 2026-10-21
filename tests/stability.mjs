import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/stability');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-stability-'));
const extension = path.join(temporary, 'extension');
await cp(path.join(root, 'extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
const result = { date: '2026-10-21', version: manifest.version, selection: process.env.STABILITY_ONLY || 'all', environment: { browser: 'Installed Google Chrome', headless: true, viewport: { width: 1280, height: 900 }, isolatedProfile: true }, scenarios: [], pageErrors: [], operations: { captures: 0, copies: 0, rapidEdits: 0 } };
const colors = { a: '#c8e8d0', b: '#e8d0c8' };
const server = http.createServer((request, response) => {
  const key = request.url === '/b' ? 'b' : 'a';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Stability ${key}</title><style>html,body{margin:0;background:${colors[key]};font:20px sans-serif}body{height:2700px;display:flow-root}header{position:fixed;top:0;left:0;right:0;height:60px;background:#245b46;color:white}aside{position:sticky;top:0;margin-top:1500px;height:60px;background:#cc00cc}</style><header>Source ${key}</header><aside>Sticky ${key}</aside>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context; let worker; let cdp; let popup; let id; let browserPid;
const sources = []; const ids = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function scenario(name, test) {
  if (process.env.STABILITY_ONLY === 'storage' && !name.startsWith('duplicate editor') && !name.startsWith('recent edits') && !name.startsWith('atomic document') && !name.startsWith('temporary cleanup') && !name.startsWith('image replacement freezes')) return;
  const start = performance.now();
  try { const details = await test(); result.scenarios.push({ name, ok: true, ms: performance.now() - start, details }); console.log(`PASS: ${name}`); }
  catch (error) { result.scenarios.push({ name, ok: false, ms: performance.now() - start, error: error.stack }); console.error(`FAIL: ${name}: ${error.message}`); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
async function getRecord(key) { return popup.evaluate(async key => (await import('./storage.js')).getCapture(key), key); }
async function openRecord(key) {
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/editor.html?id=${key}`);
  await page.locator('#canvas-frame').waitFor({ state: 'visible' }); return page;
}
async function saveDone(page) { await page.locator('#status').filter({ hasText: /저장됨|자동 저장 실패/ }).waitFor(); }
async function addNumbers(page, count) {
  await page.locator('[data-tool="number"]').click();
  await page.evaluate(count => {
    const canvas = document.querySelector('#canvas'); const box = canvas.getBoundingClientRect();
    for (let i = 0; i < count; i++) canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.x + box.width * (.15 + (i % 6) * .1), clientY: box.y + box.height * .3, button: 0, bubbles: true }));
  }, count);
  result.operations.rapidEdits += count;
  await saveDone(page);
}
async function copy(page) {
  await page.bringToFront(); await page.locator('#copy').click();
  await page.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor(); result.operations.copies++;
}
async function request(source, mode) {
  return popup.evaluate(async ({ tabId, mode }) => chrome.runtime.sendMessage({ type: 'capture', tabId, mode }), { tabId: source.tabId, mode });
}
async function activate(source) {
  await source.page.bringToFront(); await cdp.send('Extensions.triggerAction', { id, targetId: source.targetId }); await source.page.bringToFront();
}
async function capturedEditor(key) {
  for (let i = 0; i < 100; i++) {
    const page = context.pages().find(page => page.url().endsWith(`editor.html?id=${key}`));
    if (page) { await page.locator('#canvas-frame').waitFor({ state: 'visible' }); return page; }
    await delay(50);
  }
  throw new Error('Capture editor did not appear');
}
async function png(page) {
  const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
  const file = path.join(output, `output-${Date.now()}.png`); await download.saveAs(file);
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
try {
  console.log('CHECK: launch isolated Chrome');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: process.env.STABILITY_CHANNEL || 'chrome', headless: true, viewport: result.environment.viewport, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  console.log('CHECK: Chrome launched');
  context.on('weberror', event => result.pageErrors.push(event.error().message));
  cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser')?.id;
  result.environment.chrome = await cdp.send('Browser.getVersion');
  ({ id } = await cdp.send('Extensions.loadUnpacked', { path: extension }));
  console.log('CHECK: extension installed');
  worker = context.serviceWorkers().find(item => item.url().includes(id)) || await context.waitForEvent('serviceworker');
  popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  console.log('CHECK: control page loaded');
  if (process.env.STABILITY_ONLY === 'storage') {
    ids.push(...await popup.evaluate(async () => {
      const { putCapture } = await import('./storage.js'); const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      canvas.getContext('2d').fillRect(0, 0, 800, 600); const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const keys = [];
      for (let i = 0; i < 6; i++) { const id = crypto.randomUUID(); await putCapture({ id, blob, title: `Storage fixture ${i}`, createdAt: Date.now(), document: { shapes: [], crop: null, nextNumber: 1 } }); keys.push(id); }
      return keys;
    }));
  }
  for (const key of process.env.STABILITY_ONLY === 'storage' ? [] : ['a', 'b']) {
    console.log(`CHECK: open source ${key}`);
    const page = await context.newPage(); await page.goto(`${base}/${key}`); await page.bringToFront();
    const tabId = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    sources.push({ key, page, tabId, targetId: targetInfos.find(target => target.url === `${base}/${key}`).targetId });
  }
  await scenario('12 alternating visible/full captures keep source pixels and restore the page', async () => {
    for (let i = 0; i < 12; i++) {
      console.log(`CHECK: capture ${i + 1}/12`);
      const source = sources[i % 2]; const mode = i % 3 === 0 ? 'full' : 'visible';
      await activate(source); await source.page.evaluate(() => scrollTo({ top: 180, behavior: 'instant' }));
      const reply = await request(source, mode); assert.equal(reply.ok, true, reply.error);
      ids.push(reply.id); result.operations.captures++;
      const page = await capturedEditor(reply.id); const decoded = await png(page);
      assert.equal(decoded.info.width, 1280); assert.equal(decoded.info.height, mode === 'full' ? 2700 : 900);
      const point = (300 * decoded.info.width + 1100) * 4;
      assert.deepEqual([...decoded.data.subarray(point, point + 4)], source.key === 'a' ? [200, 232, 208, 255] : [232, 208, 200, 255]);
      assert.equal(await source.page.evaluate(() => scrollY), 180);
      assert.equal(await source.page.locator('header').evaluate(node => node.style.visibility), '');
      assert.equal(await source.page.locator('aside').evaluate(node => getComputedStyle(node).position), 'sticky');
      await page.close();
    }
    assert.equal(new Set(ids).size, 12); return { captures: 12, full: 4, visible: 8 };
  });
  await scenario('three independent editor tabs survive rapid saves, repeated copy and reload', async () => {
    assert.ok(ids.length >= 3);
    const pages = await Promise.all(ids.slice(0, 3).map(openRecord));
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < pages.length; i++) {
        await pages[i].bringToFront(); await addNumbers(pages[i], 12 + i);
        const expected = (round + 1) * (12 + i);
        assert.equal((await getRecord(ids[i])).document.shapes.length, expected);
        await copy(pages[i]); await copy(pages[i]);
        await pages[i].reload(); await pages[i].locator('#canvas-frame').waitFor({ state: 'visible' });
        assert.equal(await pages[i].locator('#shape-count').textContent(), `표시 ${expected}개`);
        assert.equal(await pages[i].locator('#number-start').inputValue(), String(expected + 1));
      }
    }
    for (const page of pages) await page.close(); return { editorTabs: 3, rounds: 4, edits: 156, clipboardWrites: 24, reloads: 12 };
  });
  await scenario('replacing long and small images repeatedly clears the previous image and labels', async () => {
    const fixtures = [
      { file: path.join(temporary, 'small.png'), width: 900, height: 600, color: '#e8d0c8', pixel: [232, 208, 200, 255] },
      { file: path.join(temporary, 'long.png'), width: 1600, height: 10000, color: '#c8e8d0', pixel: [200, 232, 208, 255] }
    ];
    for (const fixture of fixtures) await sharp({ create: { width: fixture.width, height: fixture.height, channels: 4, background: fixture.color } }).png().toFile(fixture.file);
    const page = await context.newPage(); await page.goto(`chrome-extension://${id}/editor.html`);
    for (let i = 0; i < 4; i++) {
      const fixture = fixtures[i % 2];
      await page.locator('#file-input').setInputFiles(fixture.file);
      await page.waitForFunction(dimensions => document.querySelector('#dimensions').textContent === dimensions, `${fixture.width} × ${fixture.height} px`);
      assert.equal(await page.locator('#shape-count').textContent(), '표시 0개');
      await addNumbers(page, 2); await copy(page); await copy(page);
      const decoded = await png(page); assert.equal(decoded.info.width, fixture.width); assert.equal(decoded.info.height, fixture.height);
      const offset = (100 * decoded.info.width + 800) * 4;
      assert.deepEqual([...decoded.data.subarray(offset, offset + 4)], fixture.pixel);
    }
    await page.close(); return { imageReplacements: 4, longImages: 2, longDimensions: '1600x10000', clipboardWrites: 8 };
  });
  await scenario('duplicate editor cannot silently overwrite a newer save from another tab', async () => {
    const first = await openRecord(ids[3]); await first.bringToFront(); await addNumbers(first, 1);
    const duplicate = await openRecord(ids[3]);
    await first.bringToFront(); await addNumbers(first, 1); const latest = await getRecord(ids[3]);
    await duplicate.bringToFront(); await addNumbers(duplicate, 1);
    const stored = await getRecord(ids[3]);
    assert.deepEqual(stored.document, latest.document, 'a stale editor replaced the newer document');
    assert.match(await duplicate.locator('#status').textContent(), /別|다른 탭|충돌/);
    await addNumbers(duplicate, 8);
    assert.deepEqual((await getRecord(ids[3])).document, latest.document, 'queued edits after a conflict must not overwrite the other tab');
    const replacement = path.join(temporary, 'replacement.png');
    await sharp({ create: { width: 800, height: 600, channels: 4, background: '#fff' } }).png().toFile(replacement);
    const originalUrl = duplicate.url(); let asked = false;
    const cancelReplacement = dialog => { asked = true; return dialog.dismiss(); };
    duplicate.once('dialog', cancelReplacement);
    await duplicate.locator('#file-input').setInputFiles(replacement);
    await duplicate.waitForFunction(() => document.querySelector('#file-input').value === '');
    duplicate.off('dialog', cancelReplacement);
    assert.equal(asked, true, 'replacing unsaved conflict work must ask before discarding it');
    assert.equal(duplicate.url(), originalUrl);
    assert.equal(await duplicate.locator('#shape-count').textContent(), '표시 10개');
    await copy(duplicate); // Local work must still be exportable after a conflict.
    duplicate.once('dialog', dialog => dialog.accept());
    await duplicate.reload(); await duplicate.locator('#canvas-frame').waitFor({ state: 'visible' });
    await addNumbers(duplicate, 1);
    assert.equal((await getRecord(ids[3])).document.shapes.length, 3);
    await first.bringToFront(); await addNumbers(first, 1);
    assert.match(await first.locator('#status').textContent(), /충돌|다른 탭/);
    let accepted = false;
    first.once('dialog', dialog => { accepted = true; return dialog.accept(); });
    await first.locator('#file-input').setInputFiles(replacement);
    await first.waitForFunction(() => document.querySelector('#dimensions').textContent === '800 × 600 px' && document.querySelector('#shape-count').textContent === '표시 0개' && document.querySelector('#file-input').value === '');
    assert.equal(accepted, true); assert.equal(await first.locator('#shape-count').textContent(), '표시 0개');
    assert.equal((await getRecord(ids[3])).document.shapes.length, 3);
    await duplicate.close(); await first.close(); return { preservedNewerSave: true, laterQueuedEditsBlocked: 8, cancelledReplacementPreserved: true, explicitDiscardReplacement: true, localConflictCopy: true, saveAfterReload: true };
  });
  await scenario('recent edits keep an older capture alive during temporary cleanup', async () => {
    const key = ids[4];
    await popup.evaluate(async key => {
      const db = await new Promise(resolve => { const request = indexedDB.open('screen-mark', 1); request.onsuccess = () => resolve(request.result); });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('captures', 'readwrite'); const store = tx.objectStore('captures'); const get = store.get(key);
        get.onsuccess = () => { const record = get.result; record.createdAt = Date.now() - 25 * 60 * 60 * 1000; record.updatedAt = record.createdAt; store.put(record); };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, key);
    const page = await openRecord(key); await page.bringToFront(); await addNumbers(page, 1);
    await popup.evaluate(async () => (await import('./storage.js')).cleanOldCaptures());
    const record = await getRecord(key); assert.ok(record, 'cleanup deleted a recently edited capture');
    await page.reload(); await page.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shape-count').textContent(), '표시 1개');
    await page.close(); return { simulatedAgeHours: 25, real24HourSoak: false };
  });
  await scenario('atomic document revisions reject simultaneous stale writers and missing records', async () => {
    const key = ids[5]; const first = await openRecord(key); const second = await openRecord(key);
    const record = await getRecord(key); const revision = record.revision || 0;
    const writes = await Promise.all([first, second].map((page, i) => page.evaluate(async ({ key, revision, marker }) => {
      try {
        const next = await (await import('./storage.js')).updateDocument(key, { shapes: [], crop: null, nextNumber: marker }, revision);
        return { ok: true, revision: next, marker };
      } catch (error) { return { ok: false, name: error.name }; }
    }, { key, revision, marker: 7 + i })));
    assert.equal(writes.filter(write => write.ok).length, 1);
    assert.equal(writes.find(write => !write.ok).name, 'SaveConflictError');
    const saved = await getRecord(key); assert.equal(saved.revision, revision + 1);
    assert.equal(saved.document.nextNumber, writes.find(write => write.ok).marker);
    const missing = await popup.evaluate(async () => {
      const { updateDocument, getCapture } = await import('./storage.js'); const id = crypto.randomUUID();
      try { await updateDocument(id, { shapes: [], crop: null }, 0); return { ok: true }; }
      catch (error) { return { ok: false, name: error.name, absent: !await getCapture(id) }; }
    });
    assert.deepEqual(missing, { ok: false, name: 'SaveConflictError', absent: true });
    await first.close(); await second.close(); return { competingWriters: 2, accepted: 1, missingRecordNotRecreated: true };
  });
  await scenario('temporary cleanup supports legacy timestamps and removes only inactive records', async () => {
    const state = await popup.evaluate(async key => {
      const { getCapture, cleanOldCaptures } = await import('./storage.js'); const source = await getCapture(key); const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
      const db = await new Promise(resolve => { const request = indexedDB.open('screen-mark', 1); request.onsuccess = () => resolve(request.result); });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('captures', 'readwrite'); const store = tx.objectStore('captures'); const now = Date.now(); const old = now - 25 * 60 * 60 * 1000;
        for (let i = 0; i < ids.length; i++) {
          const record = { ...source, id: ids[i], createdAt: i === 3 ? now : old };
          delete record.updatedAt;
          if (i === 1) record.updatedAt = now;
          if (i === 2) record.updatedAt = old;
          store.put(record);
        }
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close(); await cleanOldCaptures();
      return Promise.all(ids.map(async id => !!await getCapture(id)));
    }, ids[0]);
    assert.deepEqual(state, [false, true, false, true]); return { legacyAndUpdatedRecords: 4, deletedInactive: 2, preservedRecent: 2 };
  });
  await scenario('image replacement freezes edits until the old save queue and decode finish', async () => {
    const key = ids[2]; const previous = (await getRecord(key)).document.shapes.length;
    const page = await openRecord(key); await page.bringToFront(); await addNumbers(page, 2);
    await page.evaluate(() => {
      const decode = createImageBitmap;
      window.openBarrier = { reached: false, release: null };
      window.createImageBitmap = async (...args) => {
        if (args[0] instanceof File && !window.openBarrier.reached) {
          window.openBarrier.reached = true;
          await new Promise(resolve => { window.openBarrier.release = resolve; });
        }
        return decode(...args);
      };
    });
    const file = path.join(temporary, 'replacement-loading.png');
    await sharp({ create: { width: 900, height: 600, channels: 4, background: '#fff' } }).png().toFile(file);
    await page.locator('#file-input').setInputFiles(file);
    await page.waitForFunction(() => window.openBarrier.reached);
    await page.locator('#undo').click();
    await page.locator('[data-tool="number"]').click();
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas'); const box = canvas.getBoundingClientRect();
      for (let i = 0; i < 4; i++) canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.x + box.width * .2, clientY: box.y + box.height * .2, button: 0, bubbles: true }));
    });
    assert.equal(await page.locator('#shape-count').textContent(), `표시 ${previous + 2}개`);
    assert.equal((await getRecord(key)).document.shapes.length, previous + 2);
    await page.evaluate(() => window.openBarrier.release());
    await page.waitForFunction(() => document.querySelector('#file-input').value === '' && document.querySelector('#shape-count').textContent === '표시 0개');
    assert.equal((await getRecord(key)).document.shapes.length, previous + 2);
    await page.close(); return { pausedDuringDecode: true, blockedEditingInputs: 5, previousSavePreserved: true };
  });
  await scenario('overlapping capture is rejected and switching source tabs restores and unlocks capture', async () => {
    // A long edit-only phase may have let MV3 stop its idle worker. Wake it before instrumentation.
    await popup.evaluate(async () => { try { await chrome.runtime.sendMessage({ type: 'stability-wake' }); } catch {} });
    worker = context.serviceWorkers().find(item => item.url().endsWith(`/${manifest.background.service_worker}`)) || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.stabilityBarrier = { reached: false, release: null, scrolls: 0 };
      const execute = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = async options => {
        const value = await execute(options);
        if (options.args?.[0] === 'scroll' && ++globalThis.stabilityBarrier.scrolls === 2) {
          globalThis.stabilityBarrier.reached = true;
          await new Promise(resolve => { globalThis.stabilityBarrier.release = resolve; });
        }
        return value;
      };
    });
    const source = sources[0]; await activate(source); await source.page.evaluate(() => scrollTo({ top: 180, behavior: 'instant' }));
    const pending = request(source, 'full');
    for (let i = 0; i < 100 && !await worker.evaluate(() => globalThis.stabilityBarrier.reached); i++) await delay(50);
    assert.equal(await worker.evaluate(() => globalThis.stabilityBarrier.reached), true);
    const overlap = await request(source, 'visible'); assert.equal(overlap.ok, false); assert.match(overlap.error, /다른 캡처/);
    await sources[1].page.bringToFront(); await worker.evaluate(() => globalThis.stabilityBarrier.release());
    const cancelled = await pending; assert.equal(cancelled.ok, false); assert.match(cancelled.error, /탭이 바뀌어/);
    assert.equal(await source.page.evaluate(() => scrollY), 180);
    assert.equal(await source.page.locator('header').evaluate(node => node.style.visibility), '');
    assert.equal(await source.page.locator('aside').evaluate(node => getComputedStyle(node).position), 'sticky');
    await activate(sources[1]); const retry = await request(sources[1], 'visible'); assert.equal(retry.ok, true, retry.error);
    result.operations.captures++; await (await capturedEditor(retry.id)).close(); return { overlapRejected: true, cancellationRestored: true, retrySucceeded: true };
  });
  await scenario('idle extension worker restart preserves edits and permits another capture', async () => {
    const { targetInfos } = await cdp.send('Target.getTargets'); const target = targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url()); assert.ok(target);
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await activate(sources[0]); const reply = await request(sources[0], 'visible'); assert.equal(reply.ok, true, reply.error);
    result.operations.captures++; await (await capturedEditor(reply.id)).close();
    const record = await getRecord(ids[0]); assert.equal(record.document.shapes.length, 48);
    const page = await openRecord(ids[0]); assert.equal(await page.locator('#shape-count').textContent(), '표시 48개'); await page.close();
    return { restartedAfterIdle: true, persistedShapes: 48 };
  });
  assert.deepEqual(result.pageErrors, []);
  assert.ok(result.scenarios.every(scenario => scenario.ok), 'stability scenarios failed; inspect test-results/stability/result.json');
} catch (error) {
  console.error(error); result.error = error.message; throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (context) {
    const closing = context.close(); let timer;
    const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
    clearTimeout(timer);
    if (!closed && process.platform === 'win32' && Number.isInteger(browserPid)) {
      await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(browserPid), '/T', '/F'], { timeout: 10000, windowsHide: true }, error => {
        if (!error || !context.browser().isConnected()) resolve(); else reject(error);
      }));
    }
    await Promise.race([closing, delay(5000)]);
  }
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-stability-')) await rm(temporary, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  else throw new Error('Refusing to delete outside the stability test temporary directory');
}
