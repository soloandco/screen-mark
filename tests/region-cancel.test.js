import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { capturePlan, captureSlice, pixelSelection } from '../extension/model.js';
import { pageCapture } from '../extension/page-capture.js';
import { regionCapture } from '../extension/region-capture.js';

test('cancelling during region encoding prevents storage and opening the editor', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const rect = { x: 100, y: 100, width: 300, height: 200, viewportWidth: 1200, viewportHeight: 900 };
  const tab = { id: 17, windowId: 3, title: 'Source page' };
  const writes = [], opened = [];
  let listener, active = true, releaseEncoding, startEncoding;
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
      if (!active) throw new Error('영역 선택이 종료됨.');
      return [{ result: rect }];
    } }
  };
  const context = vm.createContext({
    chrome, capturePlan, captureSlice, pixelSelection, pageCapture, regionCapture,
    putCapture: async record => writes.push(record), cleanOldCaptures: async () => {},
    createImageBitmap: async () => bitmap, fetch: async () => ({ blob: async () => new Blob(['image']) }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { startEncoding(); await encoding; return new Blob(['cropped image']); }
    },
    crypto: { randomUUID: () => 'cropped-id' }, setTimeout, clearTimeout
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ''), context);
  const completion = new Promise(resolve => {
    assert.equal(listener({ type: 'capture-region' }, { id: chrome.runtime.id, tab, frameId: 0 }, resolve), true);
  });
  await encodingStarted;
  active = false; releaseEncoding();
  const result = await completion;
  assert.equal(result.ok, false, 'a cancelled selection must fail even if encoding succeeds');
  assert.match(result.error, /영역 선택이 종료/);
  assert.deepEqual(writes, []); assert.deepEqual(opened, []);
  assert.equal(canvases[0].width, 0); assert.equal(canvases[0].height, 0);
});
