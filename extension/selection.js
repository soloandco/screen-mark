import { imagePoint, pixelSelection, capturePlan } from './model.js';
import { getCapture, finishSelection } from './storage.js';

const $ = selector => document.querySelector(selector);
const surface = $('#surface');
const image = $('#capture-image');
const captureId = new URLSearchParams(location.search).get('id');
let record = null, bitmap = null, objectUrl = null;
let selection = null, gesture = null, busy = false;

function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').className = error ? 'error' : '';
}

function draw() {
  const box = $('#selection');
  box.hidden = !selection;
  if (selection && bitmap) {
    const scale = image.getBoundingClientRect().width / bitmap.width;
    Object.assign(box.style, { left: `${selection.x * scale}px`, top: `${selection.y * scale}px`, width: `${selection.width * scale}px`, height: `${selection.height * scale}px` });
  }
  $('#confirm').disabled = busy || !!gesture || !selection;
  $('#cancel').disabled = busy;
  $('#dimensions').textContent = selection ? `${selection.width} × ${selection.height} px` : '';
}

function fit() {
  if (!bitmap) return;
  gesture = null;
  const stage = $('#stage');
  const scale = Math.min(1, Math.max(1, stage.clientWidth - 48) / bitmap.width, Math.max(1, stage.clientHeight - 48) / bitmap.height);
  image.style.width = `${bitmap.width * scale}px`;
  image.style.height = `${bitmap.height * scale}px`;
  draw();
}

function point(event) { return imagePoint(event.clientX, event.clientY, image.getBoundingClientRect(), bitmap.width, bitmap.height); }

surface.addEventListener('pointerdown', event => {
  if (!bitmap || busy || gesture || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault(); surface.focus({ preventScroll: true });
  gesture = { start: point(event), pointerId: event.pointerId };
  selection = null; surface.setPointerCapture(event.pointerId); draw();
});
surface.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  selection = pixelSelection(gesture.start, point(event), bitmap.width, bitmap.height); draw();
});
surface.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  selection = pixelSelection(gesture.start, point(event), bitmap.width, bitmap.height);
  gesture = null;
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  status(selection ? '선택 영역 사용을 누르면 표시·저장·복사할 수 있음.' : '영역이 너무 작음. 원하는 부분을 다시 드래그하세요.');
  draw();
});
surface.addEventListener('pointercancel', () => { gesture = null; selection = null; draw(); });
surface.addEventListener('contextmenu', event => event.preventDefault());

async function confirm() {
  if (busy || gesture || !bitmap || !selection) return;
  busy = true; draw(); status('선택 영역을 준비하는 중…');
  try {
    const { x, y, width, height } = selection;
    const output = new OffscreenCanvas(width, height);
    output.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    let blob;
    try { blob = await output.convertToBlob({ type: 'image/png' }); }
    finally { output.width = 0; output.height = 0; }
    await finishSelection(captureId, blob);
    location.replace(`editor.html?id=${encodeURIComponent(captureId)}`);
  } catch (error) {
    status(`선택 영역 저장 실패: ${error?.message || '다시 시도해 주세요.'}`, true);
    busy = false; draw();
  }
}

async function cancel() {
  if (busy) return;
  busy = true; draw();
  try {
    await finishSelection(captureId);
    if (record?.sourceTabId) {
      // The source may have been closed while this frozen screenshot was open.
      try { await chrome.tabs.update(record.sourceTabId, { active: true }); } catch {}
    }
    const tab = await chrome.tabs.getCurrent();
    if (tab) await chrome.tabs.remove(tab.id);
  } catch (error) {
    status(`취소하지 못함: ${error?.message || '다시 시도해 주세요.'}`, true);
    busy = false; draw();
  }
}

$('#confirm').addEventListener('click', confirm);
$('#cancel').addEventListener('click', cancel);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  if (event.key === 'Enter' && event.target === surface) { event.preventDefault(); confirm(); }
});
window.addEventListener('resize', fit);
window.addEventListener('pagehide', () => { bitmap?.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); });

try {
  record = await getCapture(captureId);
  if (!record?.selectionPending) throw new Error('이미 완료되었거나 취소된 캡처임. 메뉴에서 다시 캡처해 주세요.');
  bitmap = await createImageBitmap(record.blob);
  capturePlan(bitmap.width, bitmap.height, bitmap.height);
  objectUrl = URL.createObjectURL(record.blob); image.src = objectUrl;
  await image.decode();
  surface.hidden = false; fit(); surface.focus({ preventScroll: true });
  status('캡처 시점의 화면임. 원하는 부분을 드래그하세요.');
} catch (error) { status(error?.message || '화면을 불러오지 못함. 다시 캡처해 주세요.', true); }
