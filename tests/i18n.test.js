import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, normalizeLanguage, t, setLanguage, getLanguage, regionCopy } from '../extension/i18n.js';
import { messages } from '../extension/translations.js';

test('language choices have the requested order and English is the fallback', () => {
  assert.deepEqual(LANGUAGES.map(item => item.code), ['en', 'ko', 'ja', 'es']);
  assert.deepEqual(LANGUAGES.map(item => item.name), ['English', '한국어', '日本語', 'Español']);
  for (const value of [null, undefined, 'fr', '__proto__', {}, 'en-US']) assert.equal(normalizeLanguage(value), 'en');
  for (const { code } of LANGUAGES) assert.equal(normalizeLanguage(code), code);
});

test('every message has all translations with the same interpolation fields', () => {
  const fields = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, values] of Object.entries(messages)) {
    assert.equal(values.length, 3, key);
    for (const value of values) {
      assert.ok(typeof value === 'string' && value.trim(), key);
      assert.deepEqual(fields(value), fields(key), key);
    }
  }
});

test('translations preserve interpolation data and unknown browser errors as text', () => {
  assert.equal(t('표시 {count}개', { count: 2 }, 'en'), 'Marks: 2');
  assert.equal(t('표시 {count}개', { count: 2 }, 'ko'), '표시 2개');
  assert.equal(t('언어', {}, 'ja'), '言語');
  assert.equal(t('언어', {}, 'es'), 'Idioma');
  assert.equal(t('Capture failure: <img src=x>'), 'Capture failure: <img src=x>');
});

test('language persistence completes before the active language changes', () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  try {
    setLanguage('es'); assert.equal(getLanguage(), 'es'); assert.equal(values.get('screen-mark.language'), 'es');
    globalThis.localStorage.setItem = () => { throw new Error('Storage blocked'); };
    assert.throws(() => setLanguage('ja'), /Storage blocked/);
    assert.equal(getLanguage(), 'es');
  } finally {
    globalThis.localStorage = previous; setLanguage('en');
  }
});

test('the source-page overlay receives only its localized copy', () => {
  const en = regionCopy('en'), ja = regionCopy('ja');
  assert.equal(en.language, 'en'); assert.equal(ja.language, 'ja');
  assert.equal(ja.copy.cancel, 'キャンセル Esc');
  assert.ok(en.copy.guide.includes('Drag')); assert.ok(Object.keys(en.copy).length < 20);
});

test('all native extension locales provide a valid name and description', async () => {
  for (const { code } of LANGUAGES) {
    const metadata = JSON.parse(await readFile(new URL(`../extension/_locales/${code}/messages.json`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(metadata).sort(), ['appDescription', 'appName']);
    assert.ok(metadata.appName.message.startsWith('Screen Mark'));
    assert.ok(metadata.appDescription.message.length <= 132 && metadata.appDescription.message.length > 0);
  }
});
