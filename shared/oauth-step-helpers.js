(function attachHelpers(globalScope) {
  function queryFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function getCodeInput() {
    return queryFirst([
      'input[name="code"]',
      'input[name="otp"]',
      'input[autocomplete="one-time-code"]',
      'input[inputmode="numeric"]',
      'input[maxlength="6"]',
    ]);
  }

  function getEmailInput() {
    return queryFirst(['input[type="email"]', 'input[name="email"]']);
  }

  function getPasswordInput() {
    return queryFirst(['input[type="password"]', 'input[name="password"]']);
  }

  const api = {
    getCodeInput,
    getEmailInput,
    getPasswordInput,
    queryFirst,
  };

  globalScope.HotmailRegisterHelpers = {
    ...api,
    ...(globalScope.HotmailRegisterOAuthHelpers || {}),
  };
})(globalThis);
