import { normalizeRect, imagePoint, createHistory, hitTest, translateShape, cropDocument, capturePlan, nextNumber, numberLabelAtCorner } from './model.js';
import { renderScene, exportPng, createFrameDraw, createPngCache } from './render.js';
import { getCapture, putCapture, updateDocument } from './storage.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas');
const frame = $('#canvas-frame');
const scroll = $('#canvas-scroll');
const params = new URLSearchParams(location.search);
let image = null;
let capture = null;
let history = createHistory({ shapes: [], crop: null, nextNumber: 1 });
let tool = 'rectangle';
let zoom = 1;
let selectedId = null;
let gesture = null;
let preview = null;
let saveQueue = Promise.resolve();
let pendingSaves = 0;
let saveFailed = false;
let saveSession = null;
let loading = false;
let pendingTextPoint = null;
let copyPromise = null;
const redraw = createFrameDraw(draw);
const png = createPngCache(() => exportPng(image, history.current));

function status(message, error = false) {
  const conflict = saveSession?.conflict;
  $('#status').textContent = conflict && !error ? `${message} · 다른 탭과 저장 충돌. 파일 저장·복사 후 새로고침하세요.` : message;
  $('#status').className = error || conflict ? 'error' : '';
}

function currentCrop() { return history.current.crop || { x: 0, y: 0, width: image.width, height: image.height }; }

function point(event) {
  const crop = currentCrop();
  const position = imagePoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), crop.width, crop.height);
  return { x: position.x + crop.x, y: position.y + crop.y };
}

function draw() {
  redraw.cancel();
  if (!image) return;
  let state = history.current;
  if (gesture?.moving) state = { ...state, shapes: state.shapes.map(shape => shape.id === gesture.moving.id ? translateShape(gesture.moving, gesture.dx || 0, gesture.dy || 0) : shape) };
  renderScene(canvas, image, state, { preview, selectedId });
  canvas.style.width = `${canvas.width * zoom}px`;
  canvas.style.height = `${canvas.height * zoom}px`;
  frame.style.width = canvas.style.width;
  frame.style.height = canvas.style.height;
  $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  $('#shape-count').textContent = `표시 ${state.shapes.length}개`;
  $('#dimensions').textContent = `${canvas.width} × ${canvas.height} px`;
  $('#undo').disabled = !history.canUndo;
  $('#redo').disabled = !history.canRedo;
  $('#delete').disabled = !selectedId;
  $('#download').disabled = false;
  $('#copy').disabled = !!copyPromise;
}

function fit() {
  if (!image) return;
  const crop = currentCrop();
  zoom = Math.min(1, Math.max(.05, (scroll.clientWidth - 80) / crop.width), Math.max(.05, (scroll.clientHeight - 76) / crop.height));
  draw();
}

function save() {
  const session = saveSession;
  const document = history.current;
  pendingSaves++;
  status('저장 중…');
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    if (session.conflict) throw session.conflict;
    // Read the expected revision when this queued save runs, after the preceding save has finished.
    session.revision = await updateDocument(session.id, document, session.revision);
    if (session === saveSession) saveFailed = false;
  }).catch(error => {
    if (error.name === 'SaveConflictError') session.conflict = error;
    if (session === saveSession) {
      saveFailed = true;
      status(`자동 저장 실패: ${error.message}${session.conflict ? '' : '. 파일 저장·복사를 이용해 주세요.'}`, true);
    }
  }).finally(() => {
    pendingSaves--;
    if (!pendingSaves && !saveFailed && session === saveSession) status('이 브라우저에 저장됨');
  });
}

function commit(state) {
  if (loading) return;
  png.invalidate();
  history.commit(state);
  capture.document = history.current;
  $('#number-start').value = state.nextNumber || 1;
  draw(); save();
}

function undoRedo(action) {
  if (!image || loading) return;
  png.invalidate();
  history[action](); selectedId = null; preview = null; gesture = null;
  $('#number-start').value = history.current.nextNumber || 1;
  fit(); save();
}

function setTool(value, render = true) {
  tool = value; gesture = null; preview = null; selectedId = null;
  document.querySelectorAll('[data-tool]').forEach(button => {
    const active = button.dataset.tool === value;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', active);
  });
  canvas.style.cursor = value === 'select' ? 'default' : 'crosshair';
  const hints = { rectangle: $('#auto-number').checked ? '드래그해 사각형과 번호 라벨 함께 추가' : '드래그해 사각형 표시 추가', number: '클릭해 원형 번호 라벨 추가', select: '표시를 클릭해 선택하고 드래그해 이동', arrow: '드래그해 화살표 추가', text: '텍스트를 넣을 위치 클릭', mosaic: '가릴 영역을 드래그. 민감 정보는 저장 전 결과를 확인하세요.', crop: '남길 영역을 드래그. 실행 취소로 복구할 수 있음' };
  status(hints[value]); if (render) draw();
}

function style() { return { color: $('#color').value, stroke: Number($('#stroke').value) }; }

function numberStyle() {
  return { number: Math.max(1, Math.min(999, Math.round(Number($('#number-start').value) || 1))), radius: Number($('#label-size').value) };
}

function addShape(shape) {
  const state = history.current;
  const annotation = { id: crypto.randomUUID(), ...style(), ...shape };
  const labelStyle = numberStyle();
  const label = shape.type === 'rectangle' && $('#auto-number').checked
    ? { id: crypto.randomUUID(), ...style(), type: 'number', ...labelStyle, ...numberLabelAtCorner(shape, labelStyle.radius, currentCrop()) }
    : null;
  const additions = label ? [annotation, label] : [annotation];
  const number = additions.find(item => item.type === 'number')?.number;
  commit({ ...state, shapes: [...state.shapes, ...additions], nextNumber: number === undefined ? state.nextNumber || 1 : Math.min(999, number + 1) });
}

canvas.addEventListener('pointerdown', event => {
  if (!image || loading || event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  const start = point(event);
  const selecting = tool === 'select' || event.ctrlKey || event.metaKey;
  if (!selecting) selectedId = null;
  if (!selecting && tool === 'number') {
    addShape({ type: 'number', ...start, ...numberStyle() }); return;
  }
  if (!selecting && tool === 'text') {
    pendingTextPoint = start; $('#text-input').value = ''; $('#text-dialog').showModal(); $('#text-input').focus(); return;
  }
  if (selecting) {
    const selected = hitTest(history.current.shapes, start);
    selectedId = selected?.id || null;
    gesture = selected ? { start, moving: selected } : null;
    if (selected) { $('#color').value = selected.color; $('#stroke').value = selected.stroke || 4; $('#stroke-value').value = `${selected.stroke || 4} px`; }
    draw();
  } else gesture = { start };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!gesture) return;
  const end = point(event);
  if (gesture.moving) { gesture.dx = end.x - gesture.start.x; gesture.dy = end.y - gesture.start.y; }
  else preview = tool === 'arrow' ? { type: tool, x: gesture.start.x, y: gesture.start.y, endX: end.x, endY: end.y, ...style() } : { type: tool, ...normalizeRect(gesture.start, end), ...style() };
  redraw.request();
});

canvas.addEventListener('pointerup', event => {
  if (!gesture) return;
  const active = gesture;
  const end = point(event);
  gesture = null; preview = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (active.moving) {
    const dx = end.x - active.start.x; const dy = end.y - active.start.y;
    if (Math.hypot(dx, dy) > 1) commit({ ...history.current, shapes: history.current.shapes.map(shape => shape.id === selectedId ? translateShape(shape, dx, dy) : shape) });
  } else {
    const box = normalizeRect(active.start, end);
    if (box.width < 3 && box.height < 3) { draw(); return; }
    if (tool === 'crop') {
      if (box.width >= 3 && box.height >= 3) { commit(cropDocument(history.current, box, image.width, image.height)); fit(); setTool('rectangle'); }
    } else if (tool === 'arrow') addShape({ type: tool, x: active.start.x, y: active.start.y, endX: end.x, endY: end.y });
    else if (box.width >= 3 && box.height >= 3) addShape({ type: tool, ...box });
  }
  draw();
});
canvas.addEventListener('pointercancel', () => { gesture = null; preview = null; draw(); });

$('#text-dialog').addEventListener('close', () => {
  if ($('#text-dialog').returnValue !== 'add' || !pendingTextPoint) return;
  const text = $('#text-input').value.trim().slice(0, 500);
  if (!text) return;
  const fontSize = 18 + Number($('#stroke').value) * 2;
  const context = canvas.getContext('2d'); context.font = `600 ${fontSize}px "Malgun Gothic", sans-serif`;
  const width = Math.max(...text.split('\n').map(line => context.measureText(line).width), 1);
  addShape({ type: 'text', ...pendingTextPoint, text, fontSize, width, height: text.split('\n').length * fontSize * 1.35 });
  pendingTextPoint = null;
});

function deleteSelected() {
  if (!selectedId) return;
  const shapes = history.current.shapes.filter(shape => shape.id !== selectedId);
  selectedId = null; commit({ ...history.current, shapes });
}

function applyStyle() {
  $('#stroke-value').value = `${$('#stroke').value} px`;
  document.querySelectorAll('[data-color]').forEach(button => button.classList.toggle('selected', button.dataset.color === $('#color').value));
  if (selectedId) commit({ ...history.current, shapes: history.current.shapes.map(shape => shape.id === selectedId ? { ...shape, ...style() } : shape) });
}

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('#auto-number').addEventListener('change', () => { if (tool === 'rectangle') setTool('rectangle'); });
document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => { $('#color').value = button.dataset.color; applyStyle(); }));
$('#color').addEventListener('change', applyStyle);
$('#stroke').addEventListener('input', () => { $('#stroke-value').value = `${$('#stroke').value} px`; });
$('#stroke').addEventListener('change', applyStyle);
$('#delete').addEventListener('click', deleteSelected);
$('#undo').addEventListener('click', () => undoRedo('undo'));
$('#redo').addEventListener('click', () => undoRedo('redo'));
$('#fit').addEventListener('click', fit);
$('#zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom * 1.2); draw(); });
$('#zoom-out').addEventListener('click', () => { zoom = Math.max(.05, zoom / 1.2); draw(); });

document.addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || $('#text-dialog').open) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'c' && image && !window.getSelection()?.toString()) { event.preventDefault(); copyImage(); return; }
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); undoRedo(event.shiftKey ? 'redo' : 'undo'); return; }
  if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); undoRedo('redo'); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return; }
  if (event.key === 'Escape') { gesture = null; preview = null; selectedId = null; draw(); return; }
  if (modifier || event.altKey) return;
  const shortcuts = { v: 'select', r: 'rectangle', n: 'number', a: 'arrow', t: 'text', m: 'mosaic', c: 'crop' };
  if (shortcuts[event.key.toLowerCase()]) { event.preventDefault(); setTool(shortcuts[event.key.toLowerCase()]); }
});

async function displayCapture(record) {
  const bitmap = await createImageBitmap(record.blob);
  try { capturePlan(bitmap.width, bitmap.height, bitmap.height); }
  catch (error) { bitmap.close(); throw error; }
  png.invalidate();
  image?.close(); image = bitmap;
  capture = record;
  saveSession = { id: record.id, revision: record.revision || 0, conflict: null };
  saveFailed = false;
  history = createHistory({ ...record.document, nextNumber: record.document?.nextNumber || nextNumber(record.document.shapes) });
  selectedId = null; gesture = null; preview = null;
  $('#file-title').textContent = record.title;
  $('#number-start').value = history.current.nextNumber;
  $('#empty').hidden = true; frame.hidden = false;
  document.title = `${record.title} · Screen Mark`;
  fit(); setTool('rectangle', false);
  status('이 브라우저에 저장됨');
}

async function loadImage(operation) {
  if (loading) return;
  loading = true;
  const controls = ['#open-file', '#empty-open', '#file-input'].map($);
  controls.forEach(control => { control.disabled = true; });
  gesture = null; preview = null; draw();
  try { await operation(); }
  finally {
    loading = false;
    controls.forEach(control => { control.disabled = false; });
    $('#file-input').value = '';
  }
}

async function openFile(file) {
  if (!file) return;
  try {
    await loadImage(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPG, WebP 파일을 선택해 주세요.');
      if (file.size > 40 * 1024 * 1024) throw new Error('40MB 이하 이미지를 선택해 주세요.');
      await saveQueue;
      if (saveFailed && !window.confirm('자동 저장되지 않은 표시를 버리고 새 이미지를 열까요? 보관하려면 취소하고 파일 저장·복사를 이용하세요.')) return;
      const bitmap = await createImageBitmap(file);
      try { capturePlan(bitmap.width, bitmap.height, bitmap.height); } finally { bitmap.close(); }
      const record = { id: crypto.randomUUID(), blob: file, title: file.name, createdAt: Date.now(), document: { shapes: [], crop: null, nextNumber: 1 } };
      await putCapture(record);
      window.history.replaceState(null, '', `editor.html?id=${record.id}`);
      await displayCapture(record);
    });
  } catch (error) { status(`이미지를 열지 못함: ${error.message}`, true); }
}

for (const id of ['#open-file', '#empty-open']) $(id).addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => openFile(event.target.files[0]));
document.addEventListener('paste', event => {
  if ($('#text-dialog').open || event.target.isContentEditable || event.target.closest?.('input, textarea, select')) return;
  const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  openFile(file);
});
scroll.addEventListener('dragover', event => { event.preventDefault(); scroll.classList.add('dragging'); });
scroll.addEventListener('dragleave', () => scroll.classList.remove('dragging'));
scroll.addEventListener('drop', event => { event.preventDefault(); scroll.classList.remove('dragging'); openFile(event.dataTransfer.files[0]); });

$('#download').addEventListener('click', async () => {
  if (!image) return;
  try {
    const blob = await png.get();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${capture.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.(png|jpe?g|webp)$/i, '').slice(0, 100) || 'capture'}-marked.png`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    status('PNG 다운로드 시작됨');
  } catch (error) { status(`파일 저장 실패: ${error.message}`, true); }
});

function copyImage() {
  if (!image) return;
  if (copyPromise) return copyPromise;
  $('#copy').disabled = true;
  status('클립보드에 복사 중…');
  try {
    // Start the write synchronously in the click/shortcut handler to preserve user activation.
    copyPromise = navigator.clipboard.write([new ClipboardItem({ 'image/png': png.get() })]).then(() => {
      status('이미지가 클립보드에 복사됨. AI 입력창에 Ctrl+V로 붙여 넣으세요.');
    }).catch(error => {
      status(`복사하지 못함. 파일 저장을 이용해 주세요. (${error.message})`, true);
    }).finally(() => { copyPromise = null; $('#copy').disabled = false; });
    return copyPromise;
  } catch (error) {
    $('#copy').disabled = false;
    status(`복사하지 못함. 파일 저장을 이용해 주세요. (${error.message})`, true);
  }
}
$('#copy').addEventListener('click', copyImage);

window.addEventListener('beforeunload', event => {
  if (pendingSaves || saveFailed) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('resize', fit);
applyStyle();
if (params.get('id')) {
  try {
    await loadImage(async () => {
      const record = await getCapture(params.get('id'));
      if (!record) throw new Error('임시 이미지가 삭제됨. 다시 캡처하거나 파일을 열어 주세요.');
      if (record.selectionPending) throw new Error('선택 화면에서 영역을 먼저 확정해 주세요.');
      await displayCapture(record);
    });
  } catch (error) { status(error.message, true); }
}
