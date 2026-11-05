import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCopyEnabled, setAutoCopy } from '../extension/storage.js';

function withStorage(storage, run) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try { run(); } finally { globalThis.localStorage = previous; }
}

test('auto-copy is on until the user turns it off', () => {
  const values = new Map();
  withStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, () => {
    assert.equal(autoCopyEnabled(), true);
    setAutoCopy(false); assert.equal(autoCopyEnabled(), false);
    setAutoCopy(true); assert.equal(autoCopyEnabled(), true);
  });
});

test('auto-copy stays on when the setting cannot be read', () => {
  withStorage({ getItem: () => { throw new Error('Storage blocked'); } }, () => assert.equal(autoCopyEnabled(), true));
});
