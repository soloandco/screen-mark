// Serialized into the isolated world of the source tab. Keep this self-contained.
export async function regionCapture(action = 'start', options = {}) {
  const key = '__screenMarkRegion';
  const current = globalThis[key];
  const copy = (action === 'start' ? options.copy : current?.copy) || {};
  const text = (name, fallback) => copy[name] || fallback;
  if (action !== 'start') {
    if (!current) throw new Error(text('ended', '영역 선택이 종료됨. 메뉴에서 다시 선택해 주세요.'));
    if (action === 'take' && current.phase === 'selected') {
      current.phase = 'capturing';
      // Let the compositor remove the guide and dimming before taking the screenshot.
      await new Promise(resolve => {
        let frame;
        const done = () => { clearTimeout(deadline); cancelAnimationFrame(frame); resolve(); };
        const deadline = setTimeout(done, 120);
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
      });
    } else if (action !== 'verify' || current.phase !== 'capturing') {
      throw new Error(text('selectFirst', '먼저 캡처할 영역을 드래그해 주세요.'));
    }
    const rect = current.rect;
    if (globalThis[key] !== current || innerWidth !== rect.viewportWidth || innerHeight !== rect.viewportHeight || scrollX !== rect.scrollX || scrollY !== rect.scrollY || devicePixelRatio !== rect.scale) {
      throw new Error(text('changed', '화면 크기나 스크롤 위치가 바뀜. 영역을 다시 선택해 주세요.'));
    }
    return rect;
  }
  current?.close();
  const focused = document.activeElement;
  const host = document.createElement('screen-mark-region');
  host.setAttribute('data-screen-mark-region', '');
  host.setAttribute('popover', 'manual');
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', text('label', '캡처할 영역 선택'));
  host.tabIndex = -1;
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:transparent!important;outline:none!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;animation:none!important;transition:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host::backdrop{background:transparent!important;backdrop-filter:none!important;box-shadow:none!important;pointer-events:none!important}
    *{box-sizing:border-box}[hidden]{display:none!important}#surface{position:absolute;inset:0;cursor:crosshair;touch-action:none;user-select:none;background:#172c244d;font:14px 'Malgun Gothic','Segoe UI',sans-serif;color:#fff}
    #guide{position:absolute;top:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:20px;max-width:calc(100% - 32px);padding:12px 16px;border-radius:8px;background:#183c30;box-shadow:0 4px 20px #0003}
    #hint{margin:0}button{flex:none;font:inherit;color:white;border:1px solid #ffffff80;border-radius:5px;padding:7px 10px;background:transparent;cursor:pointer}button:focus-visible{outline:2px solid white;outline-offset:2px}
    #box{position:absolute;pointer-events:none;border:2px solid #e44d35;box-shadow:0 0 0 100vmax #172c2470}#box[hidden]{display:none}
  `;
  const surface = document.createElement('div'); surface.id = 'surface';
  const guide = document.createElement('div'); guide.id = 'guide';
  const hint = document.createElement('p'); hint.id = 'hint'; hint.setAttribute('role', 'status');
  hint.textContent = text('guide', '원하는 부분을 드래그하세요. 놓으면 바로 캡처됨.');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = text('cancel', '취소 Esc');
  const box = document.createElement('div'); box.id = 'box'; box.hidden = true;
  guide.append(hint, cancel); surface.append(box, guide); shadow.append(style, surface);
  const events = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
  let gesture = null, timer;
  const session = {
    phase: 'selecting', rect: null, copy, language: options.language || 'en',
    close() {
      if (events.signal.aborted) return;
      clearTimeout(timer);
      events.abort();
      host.remove();
      if (globalThis[key] === session) delete globalThis[key];
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    }
  };
  globalThis[key] = session;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => session.close(), 90000); };
  const reset = message => {
    gesture = null; session.phase = 'selecting'; session.rect = null;
    host.setAttribute('data-state', 'selecting'); surface.style.visibility = '';
    surface.style.background = ''; box.hidden = true; guide.hidden = false;
    hint.textContent = message; touch();
  };
  const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const selection = end => ({ x: Math.min(gesture.start.x, end.x), y: Math.min(gesture.start.y, end.y), width: Math.abs(gesture.start.x - end.x), height: Math.abs(gesture.start.y - end.y) });
  listen(cancel, 'pointerdown', event => event.stopPropagation());
  listen(cancel, 'click', event => { event.stopPropagation(); session.close(); });
  listen(surface, 'pointerdown', event => {
    event.preventDefault(); event.stopPropagation();
    if (session.phase !== 'selecting' || gesture || event.button !== 0 || !event.isPrimary) return;
    gesture = { start: point(event), id: event.pointerId };
    surface.setPointerCapture(event.pointerId); box.hidden = true; guide.hidden = true; touch();
  });
  listen(surface, 'pointermove', event => {
    event.stopPropagation();
    if (!gesture || gesture.id !== event.pointerId) return;
    const rect = selection(point(event)); box.hidden = false; surface.style.background = 'transparent';
    Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); touch();
  });
  listen(surface, 'pointerup', async event => {
    event.preventDefault(); event.stopPropagation();
    if (!gesture || gesture.id !== event.pointerId) return;
    const rect = selection(point(event)); gesture = null;
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (rect.width < 3 || rect.height < 3) { reset(text('tiny', '영역이 너무 작음. 원하는 부분을 다시 드래그하세요.')); return; }
    session.rect = { ...rect, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY, scale: devicePixelRatio };
    session.phase = 'selected'; host.setAttribute('data-state', 'capturing'); surface.style.visibility = 'hidden';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'capture-region', language: session.language });
      if (!result?.ok) throw new Error(result?.error || text('failed', '캡처하지 못함. 다시 드래그해 주세요.'));
      session.close();
    } catch (error) {
      if (globalThis[key] === session) reset(text('failure', '캡처 실패: {error}').replace('{error}', () => error.message));
    }
  });
  listen(surface, 'pointercancel', () => reset(text('redraw', '원하는 부분을 다시 드래그하세요.')));
  listen(surface, 'lostpointercapture', () => { if (gesture) reset(text('redraw', '원하는 부분을 다시 드래그하세요.')); });
  listen(host, 'contextmenu', event => { event.preventDefault(); event.stopPropagation(); });
  listen(window, 'wheel', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, passive: false });
  listen(window, 'touchmove', event => event.preventDefault(), { capture: true, passive: false });
  listen(window, 'keydown', event => {
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); session.close(); }
    else if (event.key !== 'Tab') event.preventDefault();
  }, { capture: true });
  listen(window, 'resize', () => session.close());
  listen(window, 'pagehide', () => session.close());
  try {
    document.documentElement.append(host); host.showPopover(); host.focus({ preventScroll: true });
    reset(hint.textContent); return true;
  } catch (error) { session.close(); throw error; }
}
