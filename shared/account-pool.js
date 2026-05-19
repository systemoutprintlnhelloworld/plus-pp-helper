function normalizeField(value) {
  return String(value || '').trim();
}

function parseAccountLine(line, lineNumber) {
  const parts = String(line)
    .split('----')
    .map(normalizeField);

  if (parts.length !== 4 || parts.some((part) => !part)) {
    throw new Error(`第 ${lineNumber} 行格式错误，应为：邮箱----密码----clientid----refresh_token`);
  }

  return {
    address: parts[0].toLowerCase(),
    password: parts[1],
    clientId: parts[2],
    refreshToken: parts[3],
  };
}

export function parseAccountPool(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseAccountLine(line, index + 1));
}

export function createAccountPool(rawText) {
  const accounts = parseAccountPool(rawText);
  let currentIndex = 0;

  return {
    get size() {
      return accounts.length;
    },
    peek() {
      return accounts[currentIndex] || null;
    },
    next() {
      const account = accounts[currentIndex] || null;
      if (account) {
        currentIndex += 1;
      }
      return account;
    },
    reset() {
      currentIndex = 0;
    },
    list() {
      return [...accounts];
    },
  };
}
