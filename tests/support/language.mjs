// Suites that check the manual copy button keep background copies out of their clipboard assertions.
export async function useManualCopy(context) {
  await context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') localStorage.setItem('screen-mark.auto-copy', 'false');
  });
}

// Keep historical Korean UI assertions explicit; languages.mjs covers the English default and switching.
export async function useKorean(context) {
  await context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') localStorage.setItem('screen-mark.language', 'ko');
  });
}
