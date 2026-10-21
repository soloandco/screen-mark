export function normalizeRect(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function imagePoint(clientX, clientY, bounds, width, height) {
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  return { x: clamp((clientX - bounds.left) * width / bounds.width, width), y: clamp((clientY - bounds.top) * height / bounds.height, height) };
}

export function nextNumber(shapes, start = 1) {
  return Math.max(start - 1, ...shapes.filter(shape => shape.type === 'number').map(shape => shape.number)) + 1;
}

export function createHistory(initial) {
  let states = [structuredClone(initial)];
  let index = 0;
  return {
    get current() { return structuredClone(states[index]); },
    get canUndo() { return index > 0; },
    get canRedo() { return index < states.length - 1; },
    commit(state) {
      states = [...states.slice(0, index + 1), structuredClone(state)].slice(-80);
      index = states.length - 1;
      return this.current;
    },
    undo() { index = Math.max(0, index - 1); return this.current; },
    redo() { index = Math.min(states.length - 1, index + 1); return this.current; }
  };
}

export function shapeBounds(shape) {
  if (shape.type === 'number') return { x: shape.x - shape.radius, y: shape.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 };
  if (shape.type === 'arrow') return normalizeRect({ x: shape.x, y: shape.y }, { x: shape.endX, y: shape.endY });
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export function hitTest(shapes, point) {
  return [...shapes].reverse().find(shape => {
    if (shape.type === 'number') return Math.hypot(point.x - shape.x, point.y - shape.y) <= shape.radius + 5;
    const bounds = shapeBounds(shape);
    return point.x >= bounds.x - 6 && point.x <= bounds.x + bounds.width + 6 && point.y >= bounds.y - 6 && point.y <= bounds.y + bounds.height + 6;
  }) || null;
}

export function translateShape(shape, dx, dy) {
  return { ...shape, x: shape.x + dx, y: shape.y + dy, ...(shape.type === 'arrow' ? { endX: shape.endX + dx, endY: shape.endY + dy } : {}) };
}

export function cropDocument(document, rect, width, height) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return { ...document, crop: { x, y, width: Math.max(1, Math.min(width, rect.x + rect.width) - x), height: Math.max(1, Math.min(height, rect.y + rect.height) - y) } };
}

export function capturePlan(width, height, viewportHeight, scale = 1) {
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (![width, height, viewportHeight, scale].every(value => Number.isFinite(value) && value > 0)) throw new Error('페이지 크기를 확인할 수 없음.');
  if (pixelWidth > 32760 || pixelHeight > 32760 || pixelWidth * pixelHeight > 48_000_000) throw new Error('페이지가 너무 큼. 현재 화면 캡처를 이용해 주세요.');
  const positions = [];
  for (let y = 0; y < height; y += viewportHeight) {
    const position = Math.min(y, Math.max(0, height - viewportHeight));
    if (positions.at(-1) !== position) positions.push(position);
  }
  return { pixelWidth, pixelHeight, positions };
}
