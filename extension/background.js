import { putCapture, cleanOldCaptures } from './storage.js';
import { capturePlan, captureSlice } from './model.js';
import { pageCapture } from './page-capture.js';

let busy = false;
let lastCapture = 0;

async function assertActive(tab) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) throw new Error('탭이 바뀌어 캡처를 중단함. 원래 탭에서 다시 시도해 주세요.');
}

async function screenshot(tab) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 560 - (Date.now() - lastCapture))));
  await assertActive(tab);
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  lastCapture = Date.now();
  await assertActive(tab);
  return (await fetch(data)).blob();
}

async function execute(tab, action, y) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageCapture, args: [action, y ?? 0] });
  return result;
}

async function fullPage(tab) {
  let initialized = false;
  try {
    const dimensions = await execute(tab, 'init');
    initialized = true;
    if (dimensions.scrollWidth > dimensions.width + 2) throw new Error('가로로 긴 페이지임. 현재 화면 캡처를 이용해 주세요.');
    const plan = capturePlan(dimensions.width, dimensions.height, dimensions.viewportHeight, dimensions.scale);
    const canvas = new OffscreenCanvas(plan.pixelWidth, plan.pixelHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let coveredHeight = 0;
    for (const position of plan.positions) {
      await assertActive(tab);
      const actual = await execute(tab, 'scroll', position);
      if (actual.width !== dimensions.width || actual.height !== dimensions.viewportHeight || Math.abs(actual.y - position) > 2) throw new Error('페이지 크기나 스크롤 위치가 바뀜. 로딩이 끝난 뒤 다시 시도해 주세요.');
      const bitmap = await createImageBitmap(await screenshot(tab));
      const scale = bitmap.width / dimensions.width;
      if (Math.abs(scale - dimensions.scale) > 0.02) { bitmap.close(); throw new Error('화면 배율이 바뀜. 다시 캡처해 주세요.'); }
      const slice = captureSlice(Math.round(actual.y * scale), bitmap.height, coveredHeight, canvas.height);
      if (slice.height > 0) {
        ctx.drawImage(bitmap, 0, slice.sourceY, bitmap.width, slice.height, 0, slice.destinationY, bitmap.width, slice.height);
        coveredHeight = slice.destinationY + slice.height;
      }
      bitmap.close();
    }
    return canvas.convertToBlob({ type: 'image/png' });
  } finally {
    if (initialized) {
      try { await execute(tab, 'restore'); }
      catch (error) { console.warn('페이지 복원 실패. 페이지의 자동 복원 타이머가 남아 있음.', error); }
    }
  }
}

async function capture(message) {
  if (busy) throw new Error('다른 캡처가 진행 중임. 잠시 뒤 다시 시도해 주세요.');
  if (!['visible', 'full'].includes(message.mode) || !Number.isInteger(message.tabId)) throw new Error('올바르지 않은 캡처 요청임.');
  busy = true;
  try {
    const tab = await chrome.tabs.get(message.tabId);
    await assertActive(tab);
    let blob;
    if (message.mode === 'full') blob = await fullPage(tab);
    else {
      blob = await screenshot(tab);
      const bitmap = await createImageBitmap(blob);
      try { capturePlan(bitmap.width, bitmap.height, bitmap.height); }
      finally { bitmap.close(); }
    }
    await cleanOldCaptures();
    const id = crypto.randomUUID();
    await putCapture({ id, blob, title: tab.title || '화면 캡처', createdAt: Date.now(), document: { shapes: [], crop: null } });
    const url = chrome.runtime.getURL(`editor.html?id=${id}`);
    await chrome.tabs.create({ url });
    return { ok: true, id };
  } finally { busy = false; }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const allowed = new Set([chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('editor.html')]);
  if (sender.id !== chrome.runtime.id || !sender.url || !allowed.has(sender.url.split('?')[0]) || message?.type !== 'capture') return false;
  capture(message).then(reply).catch(error => reply({ ok: false, error: error.message?.includes('Cannot access') || error.message?.includes('cannot be scripted') ? '이 페이지에서는 전체 페이지 캡처가 제한됨. 현재 화면 캡처를 사용해 주세요.' : error.message || '캡처하지 못함. 다시 시도해 주세요.' }));
  return true;
});
