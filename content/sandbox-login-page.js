const utils = globalThis.HotmailRegisterUtils;
const helpers = globalThis.HotmailRegisterHelpers || {};

function isVisibleElement(element) {
  return utils.isVisible(element);
}

function getActionText(element) {
  return [
    element?.textContent,
    element?.value,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('placeholder'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryVisible(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && isVisibleElement(element)) {
      return element;
    }
  }
  return null;
}

function findControlByLabel(pattern) {
  const labels = Array.from(document.querySelectorAll('label')).filter(isVisibleElement);
  for (const label of labels) {
    if (!pattern.test(getActionText(label))) continue;
    const nested = label.querySelector('input, textarea, select');
    if (nested && isVisibleElement(nested)) return nested;
    const forId = label.getAttribute('for');
    if (forId) {
      const target = document.getElementById(forId);
      if (target && isVisibleElement(target)) return target;
    }
  }

  const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter(isVisibleElement);
  return fields.find((field) => {
    const wrapper = field.closest('label, [role="group"], [data-rac], div');
    return wrapper && pattern.test(getActionText(wrapper));
  }) || null;
}

function getEmailInput() {
  return helpers.getEmailInput?.() || queryVisible([
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="邮箱"]',
  ]);
}

function getCodeInput() {
  return helpers.getCodeInput?.() || queryVisible([
    'input[autocomplete="one-time-code"]',
    'input[name="code"]',
    'input[name*="otp" i]',
    'input[inputmode="numeric"]',
    'input[maxlength="6"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="验证码"]',
  ]);
}

function getNameInput() {
  return queryVisible([
    'input[name="name"]',
    'input[name="fullName"]',
    'input[name="full_name"]',
    'input[autocomplete="name"]',
    'input[placeholder*="Full name" i]',
    'input[placeholder*="全名"]',
  ]) || findControlByLabel(/full\s*name|姓名|全名/i);
}

function getAgeInput() {
  return queryVisible([
    'input[name="age"]',
    'input[type="number"]',
    'input[inputmode="numeric"]',
    'input[placeholder*="Age" i]',
    'input[placeholder*="年龄"]',
  ]) || findControlByLabel(/age|年龄/i);
}

function findActionButton(pattern) {
  const candidates = document.querySelectorAll(
    'button, [role="button"], input[type="submit"], input[type="button"], a'
  );
  return Array.from(candidates).find((element) => (
    isVisibleElement(element)
    && element.getAttribute('aria-disabled') !== 'true'
    && !element.disabled
    && pattern.test(getActionText(element))
  )) || null;
}

function isEnabledActionElement(element) {
  return Boolean(element)
    && isVisibleElement(element)
    && element.getAttribute('aria-disabled') !== 'true'
    && !element.disabled;
}

function isThirdPartyAuthActionText(text) {
  return /continue\s+with|sign\s+in\s+with|log\s+in\s+with|google|apple|phone|microsoft|github|sso|使用.*继续|通过.*继续|手机号|手机/i
    .test(String(text || ''));
}

function isEmailSubmitAction(element) {
  const text = getActionText(element);
  const tagName = String(element?.tagName || '').toUpperCase();
  const type = String(element?.getAttribute?.('type') || element?.type || '').toLowerCase();

  if (isThirdPartyAuthActionText(text)) {
    return false;
  }

  if (tagName === 'INPUT' && ['submit', 'button'].includes(type)) {
    return /continue|next|submit|log\s*in|sign\s*up|登录|注册|继续|下一步/i.test(text || type);
  }

  return /^(continue|next|submit|log\s*in|sign\s*up|登录|注册|继续|下一步)$/i.test(text);
}

function getElementRect(element) {
  try {
    return element?.getBoundingClientRect?.() || null;
  } catch {
    return null;
  }
}

function getHorizontalOverlap(leftRect, rightRect) {
  if (!leftRect || !rightRect) return 0;
  return Math.max(0, Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left));
}

function scoreEmailSubmitButton(input, button) {
  const inputRect = getElementRect(input);
  const buttonRect = getElementRect(button);
  const inputForm = input?.form || input?.closest?.('form') || null;
  const buttonForm = button?.form || button?.closest?.('form') || null;
  const tagName = String(button?.tagName || '').toUpperCase();
  const type = String(button?.getAttribute?.('type') || button?.type || '').toLowerCase();
  let score = 0;

  if (inputForm && buttonForm && inputForm === buttonForm) {
    score += 100;
  }
  if (tagName === 'BUTTON' && (!type || type === 'submit')) {
    score += 30;
  }
  if (tagName === 'INPUT' && type === 'submit') {
    score += 30;
  }
  if (inputRect && buttonRect) {
    const topDelta = buttonRect.top - inputRect.bottom;
    if (topDelta >= -8) {
      score += 40;
      score += Math.max(0, 30 - Math.min(30, topDelta / 8));
    } else {
      score -= 50;
    }
    if (getHorizontalOverlap(inputRect, buttonRect) > Math.min(inputRect.width, buttonRect.width) * 0.5) {
      score += 20;
    }
  }

  return score;
}

function findEmailSubmitButton(input) {
  const selector = 'button, [role="button"], input[type="submit"], input[type="button"]';
  const candidates = Array.from(document.querySelectorAll(selector))
    .filter((element) => isEnabledActionElement(element) && isEmailSubmitAction(element))
    .map((element) => ({
      element,
      score: scoreEmailSubmitButton(input, element),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.element || null;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function isForbiddenHost(hostname) {
  const normalized = normalizeHost(hostname);
  return normalized === 'chatgpt.com'
    || normalized === 'openai.com'
    || normalized.endsWith('.chatgpt.com')
    || normalized.endsWith('.openai.com');
}

function isLoopbackHost(hostname) {
  const normalized = normalizeHost(hostname);
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

function validateSessionEndpoint(endpoint, allowedBaseUrls = [], {
  enforceAllowlist = true,
} = {}) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || '').trim(), location.href);
  } catch {
    throw new Error('Session JSON URL 无效');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Session JSON URL 仅支持 http/https');
  }
  if (isForbiddenHost(parsed.hostname)) {
    throw new Error('拒绝读取真实 ChatGPT/OpenAI session endpoint；请配置比赛 sandbox/mock 地址');
  }

  const allowedHosts = new Set(
    allowedBaseUrls
      .map((value) => {
        try {
          return normalizeHost(new URL(value).hostname);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );
  allowedHosts.add(normalizeHost(location.hostname));

  const endpointHost = normalizeHost(parsed.hostname);
  if (enforceAllowlist && !isLoopbackHost(endpointHost) && allowedHosts.size > 0 && !allowedHosts.has(endpointHost)) {
    throw new Error(`Session JSON URL 不在当前 sandbox allowlist 中：${endpointHost}`);
  }

  return parsed.toString();
}

function hasVisibleForm() {
  return Array.from(document.querySelectorAll('form')).some(isVisibleElement);
}

function getSandboxDomState() {
  if (getNameInput() || getAgeInput()) {
    return 'profile';
  }
  if (/what\s+brings\s+you\s+to\s+chatgpt/i.test(document.body?.innerText || '')) {
    return 'onboarding-purpose';
  }
  if (/you['’]re\s+all\s+set/i.test(document.body?.innerText || '')) {
    return 'onboarding-complete';
  }
  if (getCodeInput()) {
    return 'code';
  }
  if (getEmailInput()) {
    return 'email';
  }
  if (document.readyState === 'complete' && !hasVisibleForm()) {
    return 'session-ready';
  }
  return 'unknown';
}

async function waitForControl(resolveControl, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  let control = resolveControl();
  while (!control && Date.now() - startedAt < timeoutMs) {
    await utils.sleep(250);
    control = resolveControl();
  }
  if (!control) {
    throw new Error(`${label}，等待超过 ${Math.round(timeoutMs / 1000)} 秒。URL: ${location.href}`);
  }
  return control;
}

async function step2ConfirmLoginPage() {
  const input = getEmailInput();
  if (!input && !/api\/auth\/session/i.test(location.pathname)) {
    throw new Error(`未找到邮箱输入框，请确认当前是 sandbox 登录页。URL: ${location.href}`);
  }
  utils.log('步骤 2：sandbox 登录页已就绪', 'ok');
  utils.reportComplete(2, { url: location.href });
  return { ok: true };
}

async function step3SubmitEmail(payload = {}) {
  const address = String(payload.address || '').trim();
  if (!address) {
    throw new Error('步骤 3 缺少邮箱地址');
  }

  const input = await utils.waitForElement(
    'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="email"], input[autocomplete="username"], input[placeholder*="email" i]',
    15000
  );
  utils.setInputValue(input, address);
  utils.log(`步骤 3：邮箱已填写：${address}`);
  await utils.humanPause(200, 600);

  const button = findEmailSubmitButton(input);
  if (button) {
    utils.clickElement(button);
    utils.log('步骤 3：邮箱已提交，后台将等待验证码页面或跳转证据...');
  } else {
    utils.log('步骤 3：未找到邮箱输入框对应的 Continue 按钮，已保留邮箱填写结果。', 'warn');
  }

  return { ok: true, clicked: Boolean(button), domState: getSandboxDomState() };
}

async function fillCode(payload = {}) {
  const code = String(payload.code || '').trim();
  if (!code) {
    throw new Error('验证码为空');
  }
  const input = getCodeInput();
  if (!input) {
    throw new Error(`未找到验证码输入框。URL: ${location.href}`);
  }
  utils.setInputValue(input, code);
  utils.log('步骤 4：验证码已填写');
  await utils.humanPause(200, 600);

  const button = findActionButton(/continue|next|submit|verify|finish|确认|继续|下一步|验证|完成/i);
  if (button) {
    utils.clickElement(button);
    utils.log('步骤 4：验证码已提交，后台将等待资料页或跳转证据...');
  } else {
    utils.log('步骤 4：未找到验证码提交按钮，可能页面会在输入完整验证码后自动提交。', 'warn');
  }
  return { ok: true, clicked: Boolean(button), domState: getSandboxDomState() };
}

async function resendVerificationCode() {
  const button = findActionButton(/resend|send\s+again|重新发送|再次发送|重发|再发/i);
  if (!button) {
    throw new Error(`未找到重新发送验证码按钮。URL: ${location.href}`);
  }
  utils.clickElement(button);
  utils.log('步骤 4：已点击重新发送验证码', 'info');
  return { ok: true };
}

async function step5FillProfile(payload = {}) {
  const fullName = String(payload.profileFullName || 'nicai').trim();
  const age = String(payload.profileAge || '25').trim();

  const nameInput = await waitForControl(
    getNameInput,
    '步骤 5：未找到 full name 输入框',
    15000
  );
  utils.setInputValue(nameInput, fullName);
  utils.log(`步骤 5：姓名已填写：${fullName}`);
  await utils.humanPause(200, 600);

  const ageInput = await waitForControl(
    getAgeInput,
    '步骤 5：未找到 age 输入框',
    15000
  );
  utils.setInputValue(ageInput, age);
  utils.log(`步骤 5：年龄已填写：${age}`);
  await utils.humanPause(200, 600);

  const button = findActionButton(/finish|continue|submit|create|完成|继续|提交|创建/i);
  if (button) {
    utils.clickElement(button);
    utils.log('步骤 5：资料已提交，后台将等待 session 就绪或跳转证据...');
  } else {
    utils.log('步骤 5：未找到资料页提交按钮，已保留填写结果。', 'warn');
  }

  return { ok: true, fullName, age, clicked: Boolean(button), domState: getSandboxDomState() };
}

async function copySessionJsonText(text, endpoint) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Session endpoint 返回的不是 JSON');
  }

  const sessionJson = JSON.stringify(json, null, 2);
  await copyTextToClipboard(sessionJson);
  utils.log('步骤 6：Session JSON 已复制到剪贴板', 'ok');
  utils.reportComplete(6, { endpoint });
  return {
    ok: true,
    copied: true,
    endpoint,
    sessionJson,
  };
}

async function copySandboxSessionJson(payload = {}) {
  const endpoint = validateSessionEndpoint(payload.endpoint, payload.allowedBaseUrls || [], {
    enforceAllowlist: payload.enforceAllowlist !== false,
  });
  const parsedEndpoint = new URL(endpoint);
  const requestUrl = parsedEndpoint.origin === location.origin
    ? `${parsedEndpoint.pathname}${parsedEndpoint.search}${parsedEndpoint.hash}`
    : endpoint;
  let response = null;
  let text = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await utils.sleep(1500);
    }
    response = await fetch(requestUrl, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
      },
    });
    text = await response.text();
    if (response.ok) {
      break;
    }
    utils.log(`步骤 6：Session JSON 第 ${attempt}/3 次请求失败：HTTP ${response.status}`, 'warn');
  }
  if (!response?.ok) {
    throw new Error(`Session JSON 请求失败 (${response?.status || 'unknown'})：${text.slice(0, 240)}`);
  }
  return copySessionJsonText(text, endpoint);
}

async function copySessionJsonFromCurrentPage(payload = {}) {
  const endpoint = validateSessionEndpoint(location.href, payload.allowedBaseUrls || [], {
    enforceAllowlist: payload.enforceAllowlist !== false,
  });
  const text = document.querySelector('pre')?.textContent || document.body?.innerText || '';
  return copySessionJsonText(text.trim(), endpoint);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const tasks = {
    PING: async () => ({ ok: true, url: location.href }),
    GET_SANDBOX_DOM_STATE: async () => ({
      ok: true,
      state: getSandboxDomState(),
      url: location.href,
      title: document.title || '',
      readyState: document.readyState,
    }),
    EXECUTE_STEP: async () => {
      if (message.step === 2) return step2ConfirmLoginPage();
      if (message.step === 3) return step3SubmitEmail(message.payload || {});
      if (message.step === 5) return step5FillProfile(message.payload || {});
      return { ok: true, skipped: true };
    },
    FILL_CODE: async () => fillCode(message.payload || {}),
    RESEND_VERIFICATION_CODE: async () => resendVerificationCode(),
    COPY_SANDBOX_SESSION_JSON: async () => copySandboxSessionJson(message.payload || {}),
    COPY_SESSION_JSON_FROM_PAGE: async () => copySessionJsonFromCurrentPage(message.payload || {}),
  };

  const task = tasks[message.type];
  if (!task) return;

  task()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
