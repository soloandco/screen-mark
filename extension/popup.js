const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
  buttons.forEach(item => { item.disabled = true; });
  status.className = '';
  status.textContent = button.dataset.mode === 'full' ? '캡처 중… 완료될 때까지 이 탭을 유지해 주세요.' : '화면을 캡처하는 중…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('캡처할 탭을 찾지 못함.');
    const result = await chrome.runtime.sendMessage({ type: 'capture', mode: button.dataset.mode, tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || '캡처하지 못함.');
    window.close();
  } catch (error) {
    status.className = 'error'; status.textContent = error.message;
    buttons.forEach(item => { item.disabled = false; });
  }
}));
document.querySelector('#open-editor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  window.close();
});
