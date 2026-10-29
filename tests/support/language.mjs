// Keep historical Korean UI assertions explicit; languages.mjs covers the English default and switching.
export async function useKorean(context) {
  await context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') localStorage.setItem('screen-mark.language', 'ko');
  });
}
