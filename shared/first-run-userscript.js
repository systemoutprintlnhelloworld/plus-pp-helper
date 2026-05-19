export const FIRST_RUN_USERSCRIPT_URL = 'https://gist.github.com/systemoutprintlnhelloworld/bd72f38ddd35e32b10f5ce8efc328bcc/raw/c97bfb561894cbff77e993c032e54a5ff387310a/paypal-autofiller.user.js';
export const FIRST_RUN_USERSCRIPT_OPENED_KEY = 'paypalAutofillerUserscriptOpened';

export async function openFirstRunUserscriptOnce({
  storageArea,
  tabsApi,
  now = () => new Date().toISOString(),
  url = FIRST_RUN_USERSCRIPT_URL,
} = {}) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new Error('首次 userscript 打开缺少 storage API');
  }
  if (!tabsApi?.create) {
    throw new Error('首次 userscript 打开缺少 tabs API');
  }

  const stored = await storageArea.get(FIRST_RUN_USERSCRIPT_OPENED_KEY);
  if (stored?.[FIRST_RUN_USERSCRIPT_OPENED_KEY]) {
    return { opened: false, reason: 'already_opened' };
  }

  await tabsApi.create({
    url,
    active: true,
  });
  const openedAt = now();
  await storageArea.set({
    [FIRST_RUN_USERSCRIPT_OPENED_KEY]: openedAt,
  });
  return { opened: true, openedAt, url };
}
