const SCRIPT_SOURCE = (() => {
  if (window.__HOTMAIL_REGISTER_SOURCE) return window.__HOTMAIL_REGISTER_SOURCE;
  const url = location.href;
  if (url.includes('auth0.openai.com') || url.includes('auth.openai.com') || url.includes('accounts.openai.com')) return 'signup-page';
  return 'vps-panel';
})();

const LOG_PREFIX = `[HotmailRegister:${SCRIPT_SOURCE}]`;
const STOP_ERROR_MESSAGE = '流程已被用户停止。';
let flowStopped = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STOP_FLOW') {
    flowStopped = true;
    console.warn(LOG_PREFIX, STOP_ERROR_MESSAGE);
  }
});

function resetStopState() {
  flowStopped = false;
}

function isStopError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return message === STOP_ERROR_MESSAGE;
}

function throwIfStopped() {
  if (flowStopped) {
    throw new Error(STOP_ERROR_MESSAGE);
  }
}

function log(message, level = 'info') {
  chrome.runtime.sendMessage({
    type: 'LOG',
    source: SCRIPT_SOURCE,
    payload: { message, level, timestamp: Date.now() },
  }).catch(() => {});
}

function reportReady() {
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    source: SCRIPT_SOURCE,
    payload: {},
  }).catch(() => {});
}

async function callRuntime(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || '扩展运行时消息失败');
  }
  return response.data;
}

function reportComplete(step, data = {}) {
  log(`步骤 ${step} 已成功完成`, 'ok');
  chrome.runtime.sendMessage({
    type: 'STEP_COMPLETE',
    source: SCRIPT_SOURCE,
    step,
    payload: data,
  }).catch(() => {});
}

function reportError(step, errorMessage) {
  log(`步骤 ${step} 失败：${errorMessage}`, 'error');
  chrome.runtime.sendMessage({
    type: 'STEP_ERROR',
    source: SCRIPT_SOURCE,
    step,
    error: errorMessage,
    payload: {},
  }).catch(() => {});
}

function isVisible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    throwIfStopped();

    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    let stopTimer = null;
    const cleanup = (observer, timer) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(stopTimer);
    };

    const observer = new MutationObserver(() => {
      if (flowStopped) {
        cleanup(observer, timer);
        reject(new Error(STOP_ERROR_MESSAGE));
        return;
      }

      const element = document.querySelector(selector);
      if (element) {
        cleanup(observer, timer);
        resolve(element);
      }
    });

    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      cleanup(observer, timer);
      reject(new Error(`在 ${location.href} 等待 ${selector} 超时，已超过 ${timeout}ms`));
    }, timeout);

    const pollStop = () => {
      if (settled) return;
      if (flowStopped) {
        cleanup(observer, timer);
        reject(new Error(STOP_ERROR_MESSAGE));
        return;
      }
      stopTimer = setTimeout(pollStop, 100);
    };
    pollStop();
  });
}

function waitForElementByText(containerSelector, textPattern, timeout = 10000) {
  return new Promise((resolve, reject) => {
    throwIfStopped();

    function search() {
      const candidates = document.querySelectorAll(containerSelector);
      for (const element of candidates) {
        if (textPattern.test(element.textContent || '')) {
          return element;
        }
      }
      return null;
    }

    const existing = search();
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    let stopTimer = null;
    const cleanup = (observer, timer) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(stopTimer);
    };

    const observer = new MutationObserver(() => {
      if (flowStopped) {
        cleanup(observer, timer);
        reject(new Error(STOP_ERROR_MESSAGE));
        return;
      }

      const element = search();
      if (element) {
        cleanup(observer, timer);
        resolve(element);
      }
    });

    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      cleanup(observer, timer);
      reject(new Error(`在 ${location.href} 的 ${containerSelector} 中等待文本 "${textPattern}" 超时，已超过 ${timeout}ms`));
    }, timeout);

    const pollStop = () => {
      if (settled) return;
      if (flowStopped) {
        cleanup(observer, timer);
        reject(new Error(STOP_ERROR_MESSAGE));
        return;
      }
      stopTimer = setTimeout(pollStop, 100);
    };
    pollStop();
  });
}

function fillInput(element, value) {
  throwIfStopped();
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeInputValueSetter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSelect(element, value) {
  throwIfStopped();
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveNavigationHref(element) {
  const anchor = element?.closest?.('a[href]') || (element?.matches?.('a[href]') ? element : null);
  const href = anchor?.getAttribute?.('href') || '';
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) {
    return '';
  }

  try {
    return new URL(href, location.href).toString();
  } catch {
    return '';
  }
}

function simulateClick(element) {
  throwIfStopped();
  if (!element) return;

  const beforeHref = location.href;
  const navigationHref = resolveNavigationHref(element);

  try {
    element.focus?.({ preventScroll: true });
  } catch {}

  const mouseEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
  for (const type of mouseEvents) {
    try {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    } catch {}
  }

  try {
    if (typeof element.click === 'function') {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  } catch {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  if (navigationHref && location.href === beforeHref) {
    setTimeout(() => {
      if (!flowStopped && location.href === beforeHref) {
        location.assign(navigationHref);
      }
    }, 150);
  }
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function tick() {
      if (flowStopped) {
        reject(new Error(STOP_ERROR_MESSAGE));
        return;
      }
      if (Date.now() - startedAt >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(100, Math.max(25, ms - (Date.now() - startedAt))));
    }

    tick();
  });
}

async function humanPause(min = 250, max = 850) {
  const duration = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(duration);
}

globalThis.HotmailRegisterUtils = {
  clearPendingSignupStep: async () => callRuntime({ type: 'CLEAR_PENDING_SIGNUP_STEP' }),
  clickElement: simulateClick,
  fillInput,
  fillSelect,
  getPendingSignupStep: async () => callRuntime({ type: 'GET_PENDING_SIGNUP_STEP' }),
  humanPause,
  isStopError,
  isVisible,
  log,
  reportComplete,
  reportError,
  reportReady,
  resetStopState,
  setPendingSignupStep: async (payload) => callRuntime({ type: 'SET_PENDING_SIGNUP_STEP', payload }),
  setInputValue: fillInput,
  simulateClick,
  sleep,
  throwIfStopped,
  waitForElement,
  waitForElementByText,
};

reportReady();
