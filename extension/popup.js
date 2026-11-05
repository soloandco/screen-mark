import { t, getLanguage, initI18n } from './i18n.js';
import { autoCopyEnabled, setAutoCopy } from './storage.js';

const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
const idleMessage = () => autoCopyEnabled() ? '캡처와 표시는 클립보드에 자동 복사됨. AI 입력창에 Ctrl+V로 붙여 넣으세요.' : '표시한 화면은 클립보드로 복사해 AI에 붙여 넣으세요.';
let currentStatus = { message: idleMessage(), error: false };
function showStatus(message, error = false) {
  currentStatus = { message, error }; status.className = error ? 'error' : ''; status.textContent = t(message);
}
initI18n(() => showStatus(currentStatus.message, currentStatus.error));
const autoCopy = document.querySelector('#auto-copy');
autoCopy.checked = autoCopyEnabled();
autoCopy.addEventListener('change', () => {
  try { setAutoCopy(autoCopy.checked); showStatus(idleMessage()); }
  catch (error) { autoCopy.checked = !autoCopy.checked; showStatus('자동 복사 설정을 저장하지 못함. 다시 시도해 주세요.', true); console.warn(error); }
});
document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
  buttons.forEach(item => { item.disabled = true; });
  showStatus({ full: '캡처 중… 완료될 때까지 이 탭을 유지해 주세요.', region: '현재 페이지에서 영역 선택을 시작하는 중…', visible: '화면을 캡처하는 중…' }[button.dataset.mode]);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('캡처할 탭을 찾지 못함.');
    const result = await chrome.runtime.sendMessage({ type: 'capture', mode: button.dataset.mode, tabId: tab.id, language: getLanguage() });
    if (!result?.ok) throw new Error(result?.errorKey || result?.error || '캡처하지 못함.');
    window.close();
  } catch (error) {
    showStatus(error.message, true);
    buttons.forEach(item => { item.disabled = false; });
  }
}));
document.querySelector('#open-editor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  window.close();
});
