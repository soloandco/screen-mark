async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('screen-mark', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('captures', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('captures', mode);
      const result = operation(tx.objectStore('captures'));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('저장 작업이 취소됨.'));
    });
  } finally { db.close(); }
}

export const getCapture = id => transaction('readonly', store => store.get(id));
export const putCapture = capture => transaction('readwrite', store => store.put({ ...capture, updatedAt: Date.now() }));

export async function updateDocument(id, document, revision) {
  const result = await transaction('readwrite', store => {
    const output = { result: null };
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || (current.revision || 0) !== revision) {
        output.result = { conflict: true };
        return;
      }
      const next = revision + 1;
      store.put({ ...current, document, revision: next, updatedAt: Date.now() });
      output.result = { revision: next };
    };
    return output;
  });
  if (result.conflict) {
    const error = new Error('다른 탭에서 이 캡처가 변경되었거나 삭제됨. 파일 저장·복사 후 새로고침해 주세요.');
    error.name = 'SaveConflictError';
    throw error;
  }
  return result.revision;
}

export function cleanOldCaptures() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  // Scan and delete under the same write lock, so a newer save cannot be deleted from an old snapshot.
  return transaction('readwrite', store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if ((cursor.value.updatedAt ?? cursor.value.createdAt) < cutoff) cursor.delete();
      cursor.continue();
    };
    return request;
  });
}
