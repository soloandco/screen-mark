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
export const putCapture = capture => transaction('readwrite', store => store.put(capture));
export const deleteCapture = id => transaction('readwrite', store => store.delete(id));

export async function cleanOldCaptures() {
  const captures = await transaction('readonly', store => store.getAll());
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const capture of captures) if (capture.createdAt < cutoff) await deleteCapture(capture.id);
}
