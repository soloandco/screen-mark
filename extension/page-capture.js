// This function is serialized by scripting.executeScript; keep it self-contained.
export async function pageCapture(action, y = 0) {
  const key = '__screenMarkSession';
  if (action === 'init') {
    if (globalThis[key]) throw new Error('이미 캡처 중인 페이지임.');
    const root = document.documentElement;
    const session = { x: scrollX, y: scrollY, nodes: [], styles: [], timer: null };
    globalThis[key] = session;
    session.restore = () => {
      clearTimeout(session.timer);
      for (const [node, property, value, priority] of session.styles) {
        if (value) node.style.setProperty(property, value, priority);
        else node.style.removeProperty(property);
      }
      window.scrollTo({ left: session.x, top: session.y, behavior: 'instant' });
      delete globalThis[key];
    };
    // A backup restores the page even if the extension worker is interrupted.
    session.timer = setTimeout(session.restore, 90000);
    for (const node of [root, document.body]) {
      for (const [property, value] of [['scroll-behavior', 'auto'], ['scroll-snap-type', 'none']]) {
        session.styles.push([node, property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
        node.style.setProperty(property, value, 'important');
      }
    }
    for (const node of document.querySelectorAll('body *')) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed') session.nodes.push(node);
      if (position === 'sticky') {
        // Keep below-fold sticky content in its normal flow, rather than hiding it before it was captured.
        for (const [property, value] of [['position', 'relative'], ['top', 'auto'], ['bottom', 'auto'], ['left', 'auto'], ['right', 'auto']]) {
          session.styles.push([node, property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
          node.style.setProperty(property, value, 'important');
        }
      }
    }
    return { width: innerWidth, height: Math.max(root.scrollHeight, document.body.scrollHeight, innerHeight), viewportHeight: innerHeight, scrollWidth: root.scrollWidth, scale: devicePixelRatio };
  }
  const session = globalThis[key];
  if (!session) throw new Error('캡처 세션이 종료됨. 다시 시도해 주세요.');
  if (action === 'restore') { session.restore(); return true; }
  if (action === 'scroll') {
    if (y > 0 && !session.hidden) {
      session.hidden = true;
      for (const node of session.nodes) {
        session.styles.push([node, 'visibility', node.style.getPropertyValue('visibility'), node.style.getPropertyPriority('visibility')]);
        node.style.setProperty('visibility', 'hidden', 'important');
      }
    }
    scrollTo(0, y);
    await new Promise(resolve => setTimeout(resolve, 180));
    return { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };
  }
  throw new Error('지원하지 않는 캡처 작업임.');
}
