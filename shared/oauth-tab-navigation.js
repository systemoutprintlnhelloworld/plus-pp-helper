export function decideOauthTabNavigation({ currentTab, targetUrl } = {}) {
  if (!targetUrl) {
    throw new Error('缺少 OAuth URL');
  }

  if (!currentTab?.id) {
    return {
      action: 'create',
      tabId: null,
      url: targetUrl,
    };
  }

  if ((currentTab.url || '') === targetUrl) {
    return {
      action: 'reload',
      tabId: currentTab.id,
      url: targetUrl,
    };
  }

  return {
    action: 'update',
    tabId: currentTab.id,
    url: targetUrl,
  };
}

