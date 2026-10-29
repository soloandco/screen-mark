import { messages } from './translations.js';

export const LANGUAGES = Object.freeze([
  { code: 'en', name: 'English' }, { code: 'ko', name: '한국어' },
  { code: 'ja', name: '日本語' }, { code: 'es', name: 'Español' }
]);
const key = 'screen-mark.language';
export const normalizeLanguage = value => LANGUAGES.some(item => item.code === value) ? value : 'en';
let language = 'en';
try { language = normalizeLanguage(globalThis.localStorage?.getItem(key)); }
catch (error) { console.warn('Could not read language preference.', error); }
let refresh = () => {};
export const getLanguage = () => language;

export function t(message, params = {}, selected = language) {
  const code = normalizeLanguage(selected);
  const index = { en: 0, ja: 1, es: 2 }[code];
  const template = code === 'ko' || !Object.hasOwn(messages, message) ? message : messages[message][index];
  return template.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
}

export function setLanguage(value) {
  const next = normalizeLanguage(value);
  globalThis.localStorage?.setItem(key, next);
  language = next; refresh();
}

export function initI18n(onChange = () => {}) {
  const selectors = [...document.querySelectorAll('[data-language-picker]')];
  for (const select of selectors) {
    select.replaceChildren(...LANGUAGES.map(item => {
      const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; return option;
    }));
    select.addEventListener('change', () => {
      try { setLanguage(select.value); }
      catch (error) {
        select.value = language;
        const feedback = document.querySelector('[data-language-error]');
        if (feedback) { feedback.textContent = t('언어 설정을 저장하지 못함. 다시 시도해 주세요.'); feedback.hidden = false; }
        console.warn('Could not save language preference.', error);
      }
    });
  }
  refresh = () => {
    document.documentElement.lang = language;
    for (const [attribute, target] of [['data-i18n', null], ['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label'], ['data-i18n-alt', 'alt']]) {
      for (const node of document.querySelectorAll(`[${attribute}]`)) {
        const text = t(node.getAttribute(attribute));
        if (target) node.setAttribute(target, text); else node.textContent = text;
      }
    }
    for (const select of selectors) select.value = language;
    const feedback = document.querySelector('[data-language-error]'); if (feedback) feedback.hidden = true;
    onChange();
  };
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { language = normalizeLanguage(event.newValue); refresh(); } });
  refresh();
}

export function regionCopy(selected = language) {
  const sources = {
    ended: '영역 선택이 종료됨. 메뉴에서 다시 선택해 주세요.', selectFirst: '먼저 캡처할 영역을 드래그해 주세요.',
    changed: '화면 크기나 스크롤 위치가 바뀜. 영역을 다시 선택해 주세요.', label: '캡처할 영역 선택',
    guide: '원하는 부분을 드래그하세요. 놓으면 바로 캡처됨.', cancel: '취소 Esc',
    tiny: '영역이 너무 작음. 원하는 부분을 다시 드래그하세요.', failed: '캡처하지 못함. 다시 드래그해 주세요.',
    failure: '캡처 실패: {error}', redraw: '원하는 부분을 다시 드래그하세요.'
  };
  return { language: normalizeLanguage(selected), copy: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, t(text, {}, selected)])) };
}
