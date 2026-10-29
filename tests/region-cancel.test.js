import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { capturePlan, captureSlice, pixelSelection } from '../extension/model.js';
import { pageCapture } from '../extension/page-capture.js';
import { regionCapture } from '../extension/region-capture.js';

async function captureFixture(cleanup = async () => {}) {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const rect = { x: 100, y: 100, width: 300, height: 200, viewportWidth: 1200, viewportHeight: 900 };
  const tab = { id: 17, windowId: 3, title: 'Source page' };
  const writes = [], opened = [];
  let listener, active = true, releaseEncoding, startEncoding, rejectVerification;
  let cleanupCalls = 0;
  const verificationRejected = new Promise(resolve => { rejectVerification = resolve; });
  const encodingStarted = new Promise(resolve => { startEncoding = resolve; });
  const encoding = new Promise(resolve => { releaseEncoding = resolve; });
  const bitmap = { width: 1200, height: 900, close() {} };
  const canvases = [];
  const chrome = {
    runtime: { id: 'screen-mark-test', getURL: file => `chrome-extension://screen-mark-test/${file}`, onMessage: { addListener: handler => { listener = handler; } } },
    tabs: { get: async () => tab, query: async () => [tab], captureVisibleTab: async () => 'captured-image', create: async request => opened.push(request) },
    scripting: { executeScript: async ({ target, func, args }) => {
      assert.equal(target.tabId, tab.id); assert.equal(func, regionCapture);
      assert.ok(['take', 'verify'].includes(args[0]));
      if (!active) { rejectVerification(); throw new Error('영역 선택이 종료됨.'); }
      return [{ result: rect }];
    } }
  };
  const context = vm.createContext({
    chrome, capturePlan, captureSlice, pixelSelection, pageCapture, regionCapture,
    putCapture: async record => writes.push(record), cleanOldCaptures: async () => { cleanupCalls++; return cleanup(); },
    createImageBitmap: async () => bitmap, fetch: async () => ({ blob: async () => new Blob(['image']) }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { startEncoding(); await encoding; return new Blob(['cropped image']); }
    },
    crypto: { randomUUID: () => 'cropped-id' }, setTimeout, clearTimeout
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ''), context);
  return {
    writes, opened, canvases, encodingStarted, verificationRejected, releaseEncoding,
    cancel: () => { active = false; },
    get cleanupCalls() { return cleanupCalls; },
    start: () => new Promise(resolve => {
      assert.equal(listener({ type: 'capture-region' }, { id: chrome.runtime.id, tab, frameId: 0 }, resolve), true);
    })
  };
}

test('cancelling during region encoding prevents storage and opening the editor', async () => {
  const fixture = await captureFixture();
  const completion = fixture.start();
  await fixture.encodingStarted;
  fixture.cancel(); fixture.releaseEncoding();
  const result = await completion;
  assert.equal(result.ok, false, 'a cancelled selection must fail even if encoding succeeds');
  assert.match(result.error, /영역 선택이 종료/);
  assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.opened, []);
  assert.equal(fixture.canvases[0].width, 0); assert.equal(fixture.canvases[0].height, 0);
});

test('expiry cleanup starts while region encoding is pending', async () => {
  let releaseCleanup;
  const pendingCleanup = new Promise(resolve => { releaseCleanup = resolve; });
  const fixture = await captureFixture(() => pendingCleanup);
  const completion = fixture.start();
  await fixture.encodingStarted;
  try {
    assert.equal(fixture.cleanupCalls, 1, 'cleanup must overlap the image work');
    assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.opened, []);
  } finally { releaseCleanup(); fixture.releaseEncoding(); await completion; }
  assert.equal(fixture.writes.length, 1); assert.equal(fixture.opened.length, 1);
});

test('cleanup failure keeps the capture busy until encoding finishes and never saves', async () => {
  const fixture = await captureFixture(async () => { throw new Error('Cleanup failure'); });
  const completion = fixture.start();
  await fixture.encodingStarted;
  try {
    assert.match((await fixture.start()).error, /다른 캡처가 진행 중/);
  } finally { fixture.releaseEncoding(); }
  const result = await completion;
  assert.equal(result.ok, false); assert.equal(result.error, 'Cleanup failure');
  assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.opened, []);
  assert.equal((await fixture.start()).error, 'Cleanup failure', 'busy must be released after both operations finish');
});

test('cancelled image work stays busy until cleanup finishes and then releases the lock', async () => {
  let releaseCleanup;
  const pendingCleanup = new Promise(resolve => { releaseCleanup = resolve; });
  const fixture = await captureFixture(() => pendingCleanup);
  const completion = fixture.start();
  await fixture.encodingStarted;
  fixture.cancel(); fixture.releaseEncoding();
  await fixture.verificationRejected;
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.match((await fixture.start()).error, /다른 캡처가 진행 중/);
  } finally { releaseCleanup(); await completion; }
  assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.opened, []);
  assert.match((await fixture.start()).error, /영역 선택이 종료/);
});
