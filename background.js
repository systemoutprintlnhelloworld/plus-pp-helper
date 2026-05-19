import {
  findAvailableAccountByAddress,
  listAvailableAccounts,
  listSkippedAccounts,
  markAccountStatus,
  resolveCurrentAccountSelection,
  summarizeAccountAvailability,
} from './shared/account-ledger.js';
import { continueSandboxSessionFlow, runSandboxSessionFlow } from './shared/sandbox-flow.js';
import { runAutoFlowBatch } from './shared/auto-flow.js';
import { createAutoRunPausedError } from './shared/auto-run-control.js';
import { buildAutoRestartRuntimeUpdates } from './shared/auto-restart.js';
import { getConsumedMessageIds, markVerificationMailConsumed } from './shared/consumed-mail-ledger.js';
import { createInternalSessionClient } from './shared/internal-session-client.js';
import { createSandboxMailClient } from './shared/sandbox-mail-client.js';
import { resolveLoginPassword } from './shared/login-password.js';
import { createContentStepSignalRegistry, settleStepWaiterFromDispatchResult } from './shared/content-step-signals.js';
import { chooseOauthTabCandidate, listAuthTabIds } from './shared/open-oauth-target.js';
import { findLoopbackCallbackUrl } from './shared/oauth-step-helpers-core.js';
import { decideOauthTabNavigation } from './shared/oauth-tab-navigation.js';
import {
  clearPendingSignupStepForTab,
  getPendingSignupStepForTab,
  setPendingSignupStepForTab,
} from './shared/pending-signup-step-store.js';
import { buildPanelTabOpenPlan } from './shared/panel-tab-plan.js';
import { decideStep8ClickPlan } from './shared/step8-click-plan.js';
import { pollVerificationCode } from './shared/verification-poller.js';
import { createReadyCommandQueue } from './shared/ready-command-queue.js';
import { isMissingReceiverError } from './shared/runtime-message-errors.js';
import { executeSignupStepCommand } from './shared/signup-step-executor.js';
import { DEFAULT_RUNTIME, DEFAULT_SETTINGS, mergeLogs, sanitizeSettings } from './shared/state-machine.js';
import { pollVerificationCodeWithResend } from './shared/verification-recovery.js';
import { isForbiddenOpenAITarget, validateSandboxSessionEndpoint } from './shared/sandbox-session.js';
import { openFirstRunUserscriptOnce as openFirstRunUserscriptTabOnce } from './shared/first-run-userscript.js';

const readyCommandQueue = createReadyCommandQueue();
const contentStepSignals = createContentStepSignalRegistry();
const SESSION_PROTECTION_DISABLE_PASSWORD = 'CTF-SANDBOX';
const SANDBOX_LOGIN_SOURCE = 'sandbox-login-page';
const SANDBOX_LOGIN_SCRIPT_FILES = [
  'content/utils.js',
  'shared/oauth-step-helpers-runtime.js',
  'shared/oauth-step-helpers.js',
  'content/sandbox-login-page.js',
];
const MAIL_UI_MANUAL_LOGIN_TIMEOUT_MS = 120000;
const SANDBOX_STEP_EVIDENCE_WAIT_MS = 10000;
const SANDBOX_PROFILE_AFTER_SUBMIT_WAIT_MS = 25000;
const SANDBOX_PROFILE_ONBOARDING_MAX_WAIT_MS = 45000;
const SANDBOX_ONBOARDING_CLICK_SETTLE_MS = 1200;
const PAYMENT_GENERATOR_URL = 'https://payurl.ark2.cn/';
const COMPLETED_ACCOUNT_TAG_NAME = 'plus';
const COMPLETED_ACCOUNT_TAG_COLOR = '#8b5cf6';
let firstRunUserscriptOpenInFlight = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('配置扩展图标打开侧边栏失败:', error);
  }
}

async function openFirstRunUserscriptOnce() {
  if (!firstRunUserscriptOpenInFlight) {
    firstRunUserscriptOpenInFlight = openFirstRunUserscriptTabOnce({
      storageArea: chrome.storage.local,
      tabsApi: chrome.tabs,
    }).finally(() => {
      firstRunUserscriptOpenInFlight = null;
    });
  }
  return firstRunUserscriptOpenInFlight;
}

async function runExtensionStartupTasks() {
  await configureSidePanelAction();
  await openFirstRunUserscriptOnce().catch((error) => {
    console.warn('首次加载 userscript 页面失败:', error);
  });
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function getRuntime() {
  const stored = await chrome.storage.session.get(Object.keys(DEFAULT_RUNTIME));
  return { ...DEFAULT_RUNTIME, ...stored };
}

async function getState() {
  const [settings, runtime] = await Promise.all([getSettings(), getRuntime()]);
  return { ...settings, ...runtime };
}

async function setSettings(updates) {
  await chrome.storage.local.set(sanitizeSettings({ ...(await getSettings()), ...updates }));
}

function assertSessionProtectionSettings(updates = {}) {
  if (updates.sessionProtectionEnabled !== false) {
    return;
  }

  const password = String(updates.sessionProtectionDisablePassword || '').trim();
  if (password !== SESSION_PROTECTION_DISABLE_PASSWORD) {
    throw new Error('关闭 Session 保护需要输入正确密码');
  }
}

async function setRuntime(updates) {
  await chrome.storage.session.set(updates);
}

async function resetTransientRuntime() {
  await setRuntime({
    selectedAccountAddress: '',
    currentAccount: null,
    currentEmailRecord: null,
    pendingSignupSteps: {},
    authTabId: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastLoginCode: '',
    lastSignupMail: null,
    lastLoginMail: null,
  });
}

function compactVerificationMailResult(result = {}) {
  const messageId = String(result?.mail?.messageId || '').trim();
  if (!messageId) {
    return null;
  }

  return {
    messageId,
    resolvedEmail: result.resolvedEmail || '',
    matchedAlias: result.matchedAlias || '',
    folder: result?.mail?.folder || 'inbox',
    receivedAt: result.receivedAt || '',
  };
}

function getVerificationMailRuntimeKey(phase) {
  return phase === 'signup' ? 'lastSignupMail' : 'lastLoginMail';
}

function getVerificationCodeRuntimeKey(phase) {
  return phase === 'signup' ? 'lastSignupCode' : 'lastLoginCode';
}

function collectVerificationLedgerEmails(state = {}, mailMeta = {}) {
  return Array.from(new Set([
    state.currentAccount?.address,
    state.currentEmailRecord?.address,
    state.currentEmailRecord?.resolvedEmail,
    mailMeta?.resolvedEmail,
    mailMeta?.matchedAlias,
    ...(Array.isArray(state.currentEmailRecord?.aliases) ? state.currentEmailRecord.aliases : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)));
}

async function markVerificationMailUsed(state, phase) {
  const mailMeta = phase === 'signup' ? state.lastSignupMail : state.lastLoginMail;
  if (!mailMeta?.messageId) {
    return false;
  }

  const emails = collectVerificationLedgerEmails(state, mailMeta);
  let nextLedger = state.consumedVerificationMails || {};
  const usedAt = new Date().toISOString();

  for (const email of emails) {
    nextLedger = markVerificationMailConsumed(nextLedger, {
      email,
      messageId: mailMeta.messageId,
      usedAt,
    });
  }

  await setSettings({ consumedVerificationMails: nextLedger });
  await addLog(`步骤 ${phase === 'signup' ? 4 : 7}：已记录本次验证码邮件，后续将跳过 messageId=${mailMeta.messageId}`, 'info');
  return true;
}

async function addLog(message, level = 'info') {
  const runtime = await getRuntime();
  const logs = mergeLogs(runtime.logs, {
    level,
    message,
    timestamp: new Date().toISOString(),
  });
  await setRuntime({ logs });
}

async function setStepStatus(step, status) {
  const runtime = await getRuntime();
  await setRuntime({
    stepStatuses: {
      ...runtime.stepStatuses,
      [step]: status,
    },
  });
}

async function savePendingSignupStep(tabId, payload) {
  const runtime = await getRuntime();
  await setRuntime({
    pendingSignupSteps: setPendingSignupStepForTab(runtime.pendingSignupSteps || {}, tabId, payload),
  });
}

async function readPendingSignupStep(tabId) {
  const runtime = await getRuntime();
  return getPendingSignupStepForTab(runtime.pendingSignupSteps || {}, tabId);
}

async function clearPendingSignupStep(tabId) {
  const runtime = await getRuntime();
  await setRuntime({
    pendingSignupSteps: clearPendingSignupStepForTab(runtime.pendingSignupSteps || {}, tabId),
  });
}

async function resetStepStatuses() {
  await setRuntime({
    stepStatuses: {
      1: 'pending',
      2: 'pending',
      3: 'pending',
      4: 'pending',
      5: 'pending',
      6: 'pending',
      7: 'pending',
    },
  });
}

const STEP_TITLES = Object.freeze({
  1: '获取未注册邮箱',
  2: '打开 sandbox 登录页',
  3: '填写邮箱',
  4: '获取邮箱验证码',
  5: '填写基础资料',
  6: '复制 session JSON',
  7: '生成支付长链',
});

function getStepLabel(step) {
  const title = STEP_TITLES[step];
  return title ? `步骤 ${step}：${title}` : `步骤 ${step}`;
}

function markErrorLogged(error) {
  if (error && typeof error === 'object') {
    error.__hotmailRegisterLogged = true;
  }
  return error;
}

function hasLoggedError(error) {
  return Boolean(error && typeof error === 'object' && error.__hotmailRegisterLogged);
}

function findProblemStep(stepStatuses = {}) {
  for (const status of ['failed', 'running']) {
    for (let step = 1; step <= 7; step += 1) {
      if (stepStatuses[step] === status) {
        return step;
      }
    }
  }
  return null;
}

async function ensureAutoFlowActive() {
  const runtime = await getRuntime();
  if (runtime.stopRequested) {
    throw createAutoRunPausedError('自动流程已暂停');
  }
}

async function runManagedStep(step, action, messages = {}) {
  const label = getStepLabel(step);
  const startMessage = messages.startMessage ?? `${label} 开始执行`;
  const successMessage = messages.successMessage ?? `${label} 已完成`;
  const failurePrefix = messages.failurePrefix ?? `${label} 失败`;

  await setStepStatus(step, 'running');
  if (startMessage) {
    await addLog(startMessage, 'info');
  }

  try {
    const result = await action();
    await setStepStatus(step, 'completed');
    if (successMessage) {
      await addLog(successMessage, 'ok');
    }
    return result;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    await setStepStatus(step, 'failed');
    await addLog(`${failurePrefix}：${errorMessage}`, 'error');
    markErrorLogged(error);
    throw error;
  }
}

async function runContentDrivenStep(step, action, messages = {}) {
  const label = getStepLabel(step);
  const startMessage = messages.startMessage ?? '';
  const failurePrefix = messages.failurePrefix ?? `${label} 失败`;

  await setStepStatus(step, 'running');
  if (startMessage) {
    await addLog(startMessage, 'info');
  }

  try {
    const result = await action();
    await setStepStatus(step, 'completed');
    return result;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    await setStepStatus(step, 'failed');
    if (!hasLoggedError(error)) {
      await addLog(`${failurePrefix}：${errorMessage}`, 'error');
      markErrorLogged(error);
    }
    throw error;
  }
}

function buildClient(settings) {
  return createSandboxMailClient({
    apiKey: settings.apiKey,
    baseUrl: settings.mailApiBaseUrl,
  });
}

function getSelectedAccountAddress(state = {}) {
  return String(state.selectedAccountAddress || '').trim().toLowerCase();
}

async function resolvePinnedAccountSelection(state, accounts = []) {
  const selectedAddress = getSelectedAccountAddress(state);
  if (!selectedAddress) {
    return null;
  }

  const selection = findAvailableAccountByAddress(
    accounts,
    state.usedAccounts || {},
    selectedAddress
  );
  if (selection) {
    return selection;
  }

  await setRuntime({
    selectedAccountAddress: '',
    currentAccount: null,
    currentEmailRecord: null,
  });
  throw new Error(`手动指定邮箱不可用：${selectedAddress}，它可能已被标记为已使用或已注册`);
}

async function resolveCurrentAccount(state) {
  const client = buildClient(state);
  const accounts = await client.listAccounts();
  const selection = await resolvePinnedAccountSelection(state, accounts)
    || resolveCurrentAccountSelection({
      accounts,
      ledger: state.usedAccounts || {},
      startIndex: state.currentAccountIndex,
    });
  const account = selection?.account || null;
  if (!account) {
    throw new Error('没有可用邮箱，可能 Outlook API 中的邮箱都已打上“已注册”标签或已被跳过');
  }
  await setRuntime({
    currentAccount: account,
    currentAccountIndex: selection.index,
  });
  return account;
}

async function ensureCurrentAccount(state) {
  return state.currentAccount || resolveCurrentAccount(state);
}

async function ensureCurrentEmailRecord(state) {
  if (state.currentEmailRecord?.id) {
    return state.currentEmailRecord;
  }

  const account = await ensureCurrentAccount(state);
  const client = buildClient(state);
  const record = await client.findUserEmailByAddress(account.address);
  if (!record) {
    throw new Error(`邮件平台中未找到邮箱或别名：${account.address}`);
  }

  await setRuntime({ currentEmailRecord: record });
  return record;
}

async function getActiveAuthTab() {
  const state = await getState();
  if (state.authTabId) {
    const preferredTab = await chrome.tabs.get(state.authTabId).catch(() => null);
    if (preferredTab?.id) {
      return preferredTab;
    }
  }
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await chrome.tabs.query({});
  const tab = chooseOauthTabCandidate({
    currentTab: currentTab || null,
    tabs,
    preferredTabId: state.authTabId,
  }) || currentTab;
  if (!tab?.id) {
    throw new Error('未找到当前活动标签页');
  }
  if (state.authTabId !== tab.id) {
    await setRuntime({ authTabId: tab.id });
  }
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') {
    return current;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`等待标签页加载完成超时，tabId=${tabId}`));
    }, timeoutMs);

    const listener = (updatedTabId, info, tab) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForTabCompleteIfNeeded(tabId, shouldWait, timeoutMs = 30000) {
  if (!shouldWait) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    return current;
  }
  return waitForTabComplete(tabId, timeoutMs);
}

async function sendMessageWithRetry(tabId, message, {
  timeoutMs = 15000,
  intervalMs = 250,
} = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`认证页面脚本未就绪，等待超过 ${Math.round(timeoutMs / 1000)} 秒。${lastError?.message || ''}`.trim());
}

async function sendToActiveAuthTab(message, options) {
  const tab = await getActiveAuthTab();
  return sendMessageWithRetry(tab.id, message, options);
}

async function injectSandboxLoginScript(tabId) {
  await waitForTabComplete(tabId, 30000);
  readyCommandQueue.markPending(SANDBOX_LOGIN_SOURCE, tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (injectedSource) => {
      window.__HOTMAIL_REGISTER_SOURCE = injectedSource;
    },
    args: [SANDBOX_LOGIN_SOURCE],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: SANDBOX_LOGIN_SCRIPT_FILES,
  });
}

async function ensureSandboxLoginScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response?.ok) {
      return true;
    }
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  await injectSandboxLoginScript(tabId);
  await sendMessageWithRetry(tabId, { type: 'PING' }, { timeoutMs: 5000 });
  return true;
}

async function sendToActiveSandboxAuthTab(message, options) {
  const tab = await getActiveAuthTab();
  await ensureSandboxLoginScriptReady(tab.id);
  return sendMessageWithRetry(tab.id, message, options);
}

async function sendToTab(tabId, message, options) {
  return sendMessageWithRetry(tabId, message, options);
}

async function readSandboxAuthDomSnapshot(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const snapshot = {
    tabId,
    tabUrl: tab?.url || '',
    url: tab?.url || '',
    status: tab?.status || '',
    state: 'unavailable',
    title: tab?.title || '',
    readyState: '',
    error: '',
  };

  if (!tab?.id) {
    return { ...snapshot, error: 'tab_missing' };
  }

  if (options.ensureScript && tab.status === 'complete') {
    await ensureSandboxLoginScriptReady(tabId).catch((error) => {
      snapshot.error = error?.message || String(error);
    });
  }

  try {
    const response = await sendMessageWithRetry(tabId, {
      type: 'GET_SANDBOX_DOM_STATE',
    }, {
      timeoutMs: 1800,
      intervalMs: 250,
    });
    return {
      ...snapshot,
      ...response,
      url: response?.url || snapshot.url,
      state: response?.state || snapshot.state,
      error: '',
    };
  } catch (error) {
    return {
      ...snapshot,
      error: error?.message || String(error),
    };
  }
}

function hasSandboxStepEvidence(step, before = {}, current = {}) {
  const currentState = current.state || 'unavailable';
  const beforeUrl = before.url || before.tabUrl || '';
  const currentUrl = current.url || current.tabUrl || '';
  const urlChanged = Boolean(beforeUrl && currentUrl && beforeUrl !== currentUrl);

  if (step === 3) {
    return ['code', 'profile', 'session-ready'].includes(currentState) || urlChanged;
  }
  if (step === 4) {
    return ['profile', 'session-ready'].includes(currentState) || urlChanged;
  }
  if (step === 5) {
    return ['onboarding-purpose', 'onboarding-complete', 'session-ready'].includes(currentState)
      || (urlChanged && currentState !== 'profile');
  }
  return urlChanged;
}

function describeSandboxDomSnapshot(snapshot = {}) {
  return [
    `state=${snapshot.state || 'unknown'}`,
    snapshot.url ? `url=${snapshot.url}` : '',
    snapshot.readyState ? `ready=${snapshot.readyState}` : '',
    snapshot.error ? `error=${snapshot.error}` : '',
  ].filter(Boolean).join('；');
}

async function waitForSandboxStepEvidence(tabId, step, beforeSnapshot, timeoutMs = SANDBOX_STEP_EVIDENCE_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = beforeSnapshot || {};

  await addLog(`步骤 ${step}：等待页面跳转或 DOM 状态变化，最多 ${Math.round(timeoutMs / 1000)} 秒...`, 'info');
  while (Date.now() < deadline) {
    await ensureAutoFlowActive();
    await sleep(500);
    lastSnapshot = await readSandboxAuthDomSnapshot(tabId, { ensureScript: true });
    if (hasSandboxStepEvidence(step, beforeSnapshot, lastSnapshot)) {
      await addLog(`步骤 ${step}：已确认页面状态变化：${describeSandboxDomSnapshot(lastSnapshot)}`, 'ok');
      return lastSnapshot;
    }
  }

  await addLog(`步骤 ${step}：${Math.round(timeoutMs / 1000)} 秒内未确认目标 DOM/跳转，已完成保守等待后继续。最后状态：${describeSandboxDomSnapshot(lastSnapshot)}`, 'warn');
  return lastSnapshot;
}

async function clickSandboxActionButton(tabId, patterns, actionLabel) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [patterns, actionLabel],
    func: (patternSources, label) => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const getText = (element) => [
        element?.textContent,
        element?.value,
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const patterns = patternSources.map((source) => new RegExp(source, 'i'));
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a'))
        .filter((element) => isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true');
      const button = candidates.find((element) => patterns.some((pattern) => pattern.test(getText(element)))) || null;
      if (!button) {
        return { clicked: false, reason: `missing_${label}`, url: location.href };
      }
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      button.focus?.({ preventScroll: true });
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      button.click?.();
      return { clicked: true, text: getText(button), url: location.href };
    },
  });
  const result = execution?.result || {};
  if (result.clicked) {
    await addLog(`步骤 5：已点击 ${actionLabel}：${result.text || ''}`.trim(), 'ok');
  } else {
    await addLog(`步骤 5：未找到 ${actionLabel} 按钮：${result.reason || 'unknown'}`, 'warn');
  }
  return result;
}

async function handlePostProfileOnboarding(tabId) {
  const startedAt = Date.now();
  const deadline = startedAt + SANDBOX_PROFILE_ONBOARDING_MAX_WAIT_MS;
  let clickedPurpose = false;
  let clickedComplete = false;
  let lastSnapshot = await readSandboxAuthDomSnapshot(tabId, { ensureScript: true });

  await addLog(
    `步骤 5：正在自动处理资料后的引导页，最多等待 ${Math.round(SANDBOX_PROFILE_ONBOARDING_MAX_WAIT_MS / 1000)} 秒；出现用途页会点 Skip，出现完成页会点 Continue。`,
    'info'
  );

  while (Date.now() < deadline) {
    await ensureAutoFlowActive();
    lastSnapshot = await readSandboxAuthDomSnapshot(tabId, { ensureScript: true });

    if (lastSnapshot.state === 'onboarding-purpose' && !clickedPurpose) {
      const clickResult = await clickSandboxActionButton(tabId, ['^\\s*skip\\s*$', '跳过'], 'Skip');
      clickedPurpose = Boolean(clickResult.clicked);
      await sleep(SANDBOX_ONBOARDING_CLICK_SETTLE_MS);
      continue;
    }

    if (lastSnapshot.state === 'onboarding-complete') {
      const clickResult = await clickSandboxActionButton(tabId, ['^\\s*continue\\s*$', '继续'], 'Continue');
      clickedComplete = Boolean(clickResult.clicked);
      await sleep(SANDBOX_ONBOARDING_CLICK_SETTLE_MS);
      lastSnapshot = await readSandboxAuthDomSnapshot(tabId, { ensureScript: true });
      if (clickedComplete) {
        break;
      }
    }

    if (clickedComplete || (clickedPurpose && lastSnapshot.state === 'session-ready')) {
      break;
    }

    await sleep(500);
  }

  const elapsedMs = Date.now() - startedAt;
  if (!clickedPurpose && !clickedComplete && elapsedMs < SANDBOX_PROFILE_AFTER_SUBMIT_WAIT_MS) {
    await addLog(`步骤 5：暂未发现引导页，补足 ${Math.round((SANDBOX_PROFILE_AFTER_SUBMIT_WAIT_MS - elapsedMs) / 1000)} 秒保守等待...`, 'info');
    while (Date.now() - startedAt < SANDBOX_PROFILE_AFTER_SUBMIT_WAIT_MS) {
      await ensureAutoFlowActive();
      await sleep(500);
    }
    lastSnapshot = await readSandboxAuthDomSnapshot(tabId, { ensureScript: true });
  }

  await addLog(
    `步骤 5：引导页自动处理结束：Skip=${clickedPurpose ? '已点击' : '未出现'}，Continue=${clickedComplete ? '已点击' : '未出现'}，最后状态 ${describeSandboxDomSnapshot(lastSnapshot)}`,
    clickedPurpose || clickedComplete ? 'ok' : 'warn'
  );
  return lastSnapshot;
}

async function openPaymentGeneratorAndSubmit(sessionJson) {
  if (!sessionJson) {
    throw new Error('缺少可填入支付长链页面的 session JSON');
  }

  const tab = await chrome.tabs.create({ url: PAYMENT_GENERATOR_URL, active: true });
  await waitForTabComplete(tab.id, 30000);

  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [sessionJson],
    func: async (jsonText) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labelText = (element) => [
        element?.textContent,
        element?.value,
        element?.placeholder,
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const setTextareaValue = (textarea, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, value);
        else textarea.value = value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const clickElement = (element) => {
        element.focus?.({ preventScroll: false });
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        element.click?.();
      };
      const findTextarea = () => {
        const textareas = Array.from(document.querySelectorAll('textarea')).filter(isVisible);
        return textareas.find((textarea) => /access\s*token|session\s*json|api\/auth\/session|accessToken|session JSON/i
          .test(labelText(textarea) || labelText(textarea.closest('label, section, form, div'))))
          || textareas[0]
          || null;
      };
      const findGenerateButton = () => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
          .filter((element) => isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true');
        return buttons.find((button) => /生成支付长链|支付长链|generate/i.test(labelText(button)))
          || buttons.find((button) => /生成|generate|submit/i.test(labelText(button)))
          || null;
      };

      const deadline = Date.now() + 10000;
      let textarea = null;
      let button = null;
      while (Date.now() < deadline) {
        textarea = findTextarea();
        button = findGenerateButton();
        if (textarea && button) break;
        await sleep(250);
      }
      if (!textarea) {
        return { ok: false, error: '未找到 Access Token 或 session JSON 输入框' };
      }
      if (!button) {
        return { ok: false, error: '未找到“生成支付长链”按钮' };
      }

      textarea.scrollIntoView({ block: 'center', inline: 'nearest' });
      setTextareaValue(textarea, jsonText);
      await sleep(250);
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      clickElement(button);
      return {
        ok: true,
        url: location.href,
        textareaLength: textarea.value.length,
        buttonText: labelText(button),
      };
    },
  });

  const result = execution?.result || {};
  if (!result.ok) {
    throw new Error(result.error || '支付长链页面自动填充失败');
  }
  return { ...result, tabId: tab.id };
}

async function sendToActiveAuthTabOnce(message) {
  const tab = await getActiveAuthTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function clickWithDebugger(tabId, rect) {
  if (!tabId) {
    throw new Error('未找到用于调试点击的认证页面标签页。');
  }
  if (!rect || !Number.isFinite(rect.centerX) || !Number.isFinite(rect.centerY)) {
    throw new Error('步骤 8 的调试器兜底点击需要有效的按钮坐标。');
  }

  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const x = Math.round(rect.centerX);
    const y = Math.round(rect.centerY);

    await chrome.debugger.sendCommand(target, 'Page.bringToFront');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
      clickCount: 0,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function openOauthUrl(oauthUrl) {
  if (!oauthUrl) {
    throw new Error('请先填写 OAuth URL');
  }

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await chrome.tabs.query({});
  const state = await getState();
  const tab = chooseOauthTabCandidate({
    currentTab: currentTab || null,
    tabs,
    preferredTabId: state.authTabId,
  });
  const plan = decideOauthTabNavigation({
    currentTab: tab,
    targetUrl: oauthUrl,
  });

  if (plan.action === 'reload' && plan.tabId) {
    await chrome.tabs.reload(plan.tabId, { bypassCache: true });
    const resolvedTab = await waitForTabComplete(plan.tabId);
    await setRuntime({ authTabId: plan.tabId });
    return resolvedTab;
  }

  if (plan.action === 'update' && plan.tabId) {
    await chrome.tabs.update(plan.tabId, { url: plan.url, active: true });
    const resolvedTab = await waitForTabComplete(plan.tabId);
    await setRuntime({ authTabId: plan.tabId });
    return resolvedTab;
  }

  const created = await chrome.tabs.create({ url: oauthUrl, active: true });
  const resolvedTab = await waitForTabComplete(created.id);
  await setRuntime({ authTabId: created.id });
  return resolvedTab;
}

function assertSandboxAutomationUrl(url, label) {
  if (!url) {
    throw new Error(`请先填写${label}`);
  }
  if (isForbiddenOpenAITarget(url)) {
    throw new Error(`${label} 不能指向真实 ChatGPT/OpenAI 域名，请配置比赛 sandbox/mock 地址`);
  }
}

async function closeAuthTabs() {
  const state = await getState();
  const tabs = await chrome.tabs.query({});
  const authTabIds = listAuthTabIds(tabs, state.authTabId);
  if (!authTabIds.length) {
    return 0;
  }
  await chrome.tabs.remove(authTabIds).catch(() => {});
  return authTabIds.length;
}

async function openOrReusePanelTab(source, url, files, options = {}) {
  if (!url) {
    throw new Error('缺少面板地址');
  }

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url && tab.url.startsWith(url));
  const plan = buildPanelTabOpenPlan({
    existingTab: existing || null,
    targetUrl: url,
    preserveExistingTab: Boolean(options.preserveExistingTab),
  });

  let tab = null;
  if (plan.action === 'activate' && plan.tabId) {
    tab = await chrome.tabs.update(plan.tabId, { active: true });
  } else if (plan.action === 'reload' && plan.tabId) {
    await chrome.tabs.update(plan.tabId, { active: true });
    await chrome.tabs.reload(plan.tabId, { bypassCache: true });
    tab = await chrome.tabs.get(plan.tabId);
  } else if (plan.action === 'update' && plan.tabId) {
    tab = await chrome.tabs.update(plan.tabId, { url: plan.url, active: true });
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }

  if (options.preserveExistingTab && plan.action === 'activate' && readyCommandQueue.isReadyForTab(source, tab.id)) {
    return tab.id;
  }

  await waitForTabCompleteIfNeeded(tab.id, plan.waitForComplete, 30000);
  readyCommandQueue.markPending(source, tab.id);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (injectedSource) => {
      window.__HOTMAIL_REGISTER_SOURCE = injectedSource;
    },
    args: [source],
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files,
  });

  return tab.id;
}

async function openSandboxLoginPage(state) {
  assertSandboxAutomationUrl(state.loginPageUrl, 'Sandbox 登录页 URL');
  const tabId = await openOrReusePanelTab(SANDBOX_LOGIN_SOURCE, state.loginPageUrl, SANDBOX_LOGIN_SCRIPT_FILES);
  await setRuntime({ authTabId: tabId });
  return chrome.tabs.get(tabId);
}

async function sendToReadySource(source, tabId, message, timeoutMs = 15000) {
  if (readyCommandQueue.isReady(source)) {
    return chrome.tabs.sendMessage(tabId, message);
  }
  return readyCommandQueue.queueCommand(source, message, timeoutMs);
}

function getDetailMethodFromOptions(options = {}) {
  if (options.method) {
    return options.method;
  }
  const idMode = String(options.idMode || options.id_mode || '').trim().toLowerCase();
  return idMode === 'uid' || idMode === 'sequence' ? 'imap' : 'graph';
}

function isMailDetailSessionError(error) {
  return /401|unauthorized|未经授权|external API Key 只能读取邮件列表预览/i
    .test(error?.message || String(error || ''));
}

function getLoopbackPeerHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (normalized === 'localhost') {
    return '127.0.0.1';
  }
  if (normalized === '127.0.0.1') {
    return 'localhost';
  }
  return '';
}

function getMailUiBaseUrlCandidates(baseUrl) {
  const candidates = [];
  try {
    const parsed = new URL(baseUrl);
    candidates.push(parsed.origin);
    const peerHostname = getLoopbackPeerHostname(parsed.hostname);
    if (peerHostname) {
      const peer = new URL(parsed.toString());
      peer.hostname = peerHostname;
      candidates.push(peer.origin);
    }
  } catch {
    if (baseUrl) {
      candidates.push(baseUrl);
    }
  }
  return Array.from(new Set(candidates));
}

function resolveMailUiBaseUrl(state = {}) {
  const rawBaseUrl = String(state.mailApiBaseUrl || '').trim();
  if (!rawBaseUrl) {
    return '';
  }
  try {
    const parsed = new URL(rawBaseUrl);
    return `${parsed.origin}/`;
  } catch {
    return rawBaseUrl;
  }
}

function resolveMailUiPassword(state = {}) {
  return String(state.mailUiPassword || DEFAULT_SETTINGS.mailUiPassword || 'admini123').trim();
}

async function getOrOpenMailUiTab(baseUrl, options = {}) {
  const origin = new URL(baseUrl).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const readyTab = tabs.find((tab) => tab.id && tab.status === 'complete') || tabs.find((tab) => tab.id);
  if (readyTab?.id) {
    if (options.active) {
      await chrome.tabs.update(readyTab.id, { active: true });
    }
    return readyTab;
  }
  const tab = await chrome.tabs.create({ url: origin, active: Boolean(options.active) });
  return waitForTabComplete(tab.id);
}

async function fetchMailDetailThroughMailUi(baseUrl, email, messageId, options = {}) {
  const baseUrlCandidates = getMailUiBaseUrlCandidates(baseUrl);
  const requestPath = `/api/email/${encodeURIComponent(email)}/${encodeURIComponent(messageId)}?folder=${encodeURIComponent(options.folder || 'inbox')}&method=${encodeURIComponent(getDetailMethodFromOptions(options))}`;

  let lastError = null;
  for (const candidateBaseUrl of baseUrlCandidates) {
    try {
      const tab = await getOrOpenMailUiTab(candidateBaseUrl);
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [requestPath],
        func: async (path) => {
          const parseJsonResponse = async (response) => {
            const text = await response.text();
            let payload = null;
            try {
              payload = text ? JSON.parse(text) : {};
            } catch {
              return {
                ok: false,
                status: response.status,
                error: `邮箱后台接口返回非 JSON (${response.status})`,
                text: text.slice(0, 500),
              };
            }

            return {
              ok: response.ok && payload?.success !== false && payload?.ok !== false,
              status: response.status,
              payload,
              error: payload?.message || payload?.error || '',
              text: text.slice(0, 500),
            };
          };

          const fetchJson = async (url, init = {}) => {
            const headers = {
              Accept: 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              ...(init.headers || {}),
            };
            const response = await fetch(url, {
              cache: 'no-store',
              credentials: 'include',
              ...init,
              headers,
            });
            return parseJsonResponse(response);
          };

          const detailUrl = new URL(path, location.origin).toString();
          const detailResult = await fetchJson(detailUrl);

          return {
            ...detailResult,
            requestUrl: detailUrl,
            pageUrl: location.href,
            pageTitle: document.title || '',
          };
        },
      });
      const result = execution?.result;
      if (!result?.ok) {
        const detailErrorParts = [
          `base=${candidateBaseUrl}`,
          `status=${result?.status || 'unknown'}`,
          result?.error ? `error=${result.error}` : '',
          result?.pageUrl ? `page=${result.pageUrl}` : '',
          result?.requestUrl ? `request=${result.requestUrl}` : '',
          result?.text ? `body=${result.text}` : '',
        ].filter(Boolean);
        throw new Error(detailErrorParts.join('；') || '邮箱后台详情接口请求失败');
      }
      const payload = result.payload || {};
      return payload.email || payload.mail || payload.message || payload.data || payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('邮箱后台详情接口请求失败');
}

async function inspectMailUiLoginState(tabId) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const passwordInput = Array.from(document.querySelectorAll('input[type="password"], input[name*="password" i], input[placeholder*="密码"], input[placeholder*="password" i]'))
        .find(isVisible) || null;
      const bodyText = document.body?.innerText || '';
      const loggedIn = /Outlook\s*邮件|当前邮箱|Token刷新管理|导出邮箱|退出登录/i.test(bodyText)
        && !passwordInput;
      return {
        loggedIn,
        hasPasswordInput: Boolean(passwordInput),
        url: location.href,
        title: document.title || '',
        text: bodyText.slice(0, 240),
      };
    },
  });
  return execution?.result || {};
}

async function submitMailUiLogin(tabId, password) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [password],
    func: (loginPassword) => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const clickElement = (element) => {
        element.focus?.({ preventScroll: true });
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        element.click?.();
      };
      const passwordInput = Array.from(document.querySelectorAll('input[type="password"], input[name*="password" i], input[placeholder*="密码"], input[placeholder*="password" i]'))
        .find(isVisible) || null;
      if (!passwordInput) {
        return { submitted: false, reason: 'missing_password_input' };
      }
      setInputValue(passwordInput, loginPassword);
      const form = passwordInput.closest('form');
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
        .filter(isVisible);
      const button = buttons.find((item) => /登录|login|sign\s*in|进入|提交|确定/i.test([
        item.textContent,
        item.value,
        item.getAttribute?.('aria-label'),
        item.getAttribute?.('title'),
      ].filter(Boolean).join(' '))) || buttons.find((item) => {
        const type = String(item.getAttribute?.('type') || item.type || '').toLowerCase();
        return type === 'submit';
      });
      if (button) {
        clickElement(button);
      } else if (form) {
        form.requestSubmit?.();
        if (!form.requestSubmit) form.submit?.();
      } else {
        passwordInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        passwordInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      }
      return { submitted: true };
    },
  });
  return execution?.result || {};
}

async function ensureMailUiLoggedIn() {
  const state = await getState();
  const mailUiUrl = resolveMailUiBaseUrl(state);
  const mailUiPassword = resolveMailUiPassword(state);
  if (!mailUiUrl) {
    throw new Error('请先配置邮箱 API URL');
  }

  const tab = await getOrOpenMailUiTab(mailUiUrl, { active: true });
  await chrome.tabs.update(tab.id, { url: mailUiUrl, active: true });
  await waitForTabComplete(tab.id, 30000);

  let loginState = await inspectMailUiLoginState(tab.id);
  if (loginState.loggedIn) {
    await addLog(`邮箱后台已登录：${mailUiUrl}`, 'info');
    return { loggedIn: true, alreadyLoggedIn: true, tabId: tab.id };
  }

  if (loginState.hasPasswordInput) {
    await addLog(`已打开邮箱后台：${mailUiUrl}，正在使用独立邮箱后台密码自动登录...`, 'info');
    await submitMailUiLogin(tab.id, mailUiPassword);
  } else {
    await addLog(`已打开邮箱后台：${mailUiUrl}，未发现密码框，将等待页面自行进入已登录状态。`, 'warn');
  }

  const deadline = Date.now() + MAIL_UI_MANUAL_LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    loginState = await inspectMailUiLoginState(tab.id);
    if (loginState.loggedIn) {
      await addLog('邮箱后台登录态已确认，将复用该 Web session 读取完整邮件正文。', 'ok');
      return { loggedIn: true, alreadyLoggedIn: false, tabId: tab.id };
    }
  }

  throw new Error(`邮箱后台登录未确认。请检查邮箱后台密码配置并确认 ${mailUiUrl} 可登录。当前页面片段：${loginState.text || loginState.title || loginState.url || ''}`);
}

async function syncCurrentAccount(state) {
  const account = await ensureCurrentAccount(state);
  const client = buildClient(state);
  return client.importEmails('ms_graph', [{
    address: account.address,
    password: account.password,
    client_id: account.clientId,
    refresh_token: account.refreshToken,
  }]);
}

async function pollCodeForPhase(state, phase) {
  const account = await ensureCurrentAccount(state);
  const emailRecord = await ensureCurrentEmailRecord(state);
  const step = phase === 'signup' ? 4 : 7;
  const phaseLabel = phase === 'signup' ? '注册验证码' : '登录验证码';
  const phaseStartedAt = new Date().toISOString();
  const client = buildClient(state);
  try {
    await ensureMailUiLoggedIn();
  } catch (error) {
    await addLog(`步骤 ${step}：邮箱后台自动登录检查失败：${error?.message || String(error)}`, 'warn');
  }
  const mailUiBaseUrls = getMailUiBaseUrlCandidates(state.mailApiBaseUrl);
  const sessionCookieChecks = await Promise.all(mailUiBaseUrls.map(async (baseUrl) => ({
    baseUrl,
    cookies: await getSessionCookiesForBaseUrl(baseUrl),
  })));
  const sessionCookieHit = sessionCookieChecks.find((item) => item.cookies.length > 0);
  if (sessionCookieHit) {
    await addLog(`步骤 ${step}：检测到 ${sessionCookieHit.cookies.length} 个邮箱后台 Session Cookie（${sessionCookieHit.baseUrl}），将尝试读取邮件完整正文。`, 'info');
  } else {
    await addLog(`步骤 ${step}：未检测到邮箱后台 Session Cookie（已检查 ${mailUiBaseUrls.join('、')}）；如 external API 只返回预览，可能无法读取验证码完整正文。`, 'warn');
  }
  const consumedMessageIds = getConsumedMessageIds(
    state.consumedVerificationMails || {},
    collectVerificationLedgerEmails(state)
  );
  const result = await pollVerificationCodeWithResend({
    step,
    maxRounds: 3,
    addLog,
    resendVerificationCode: async (targetStep) => {
      await ensureAutoFlowActive();
      await addLog(`步骤 ${targetStep}：正在请求新的验证码...`, 'warn');
      await sendToActiveSandboxAuthTab({
        type: 'RESEND_VERIFICATION_CODE',
        step: targetStep,
        payload: {},
      });
      return new Date().toISOString();
    },
    pollVerificationCode: async ({ minReceivedAt, round }) => {
      await ensureAutoFlowActive();
      return pollVerificationCode({
        client,
        detailFetcher: {
          getEmailDetail: async (resolvedEmail, messageId, options = {}) => {
            try {
              return await client.getEmailDetail(resolvedEmail, messageId, options);
            } catch (error) {
              if (!isMailDetailSessionError(error)) {
                throw error;
              }
              await addLog(`步骤 ${step}：后台直接读取邮件详情未拿到 Web session，尝试通过已登录邮箱页面读取完整正文...`, 'warn');
              return fetchMailDetailThroughMailUi(state.mailApiBaseUrl, resolvedEmail, messageId, options);
            }
          },
        },
        email: account.address,
        intervalMs: state.pollIntervalSec * 1000,
        timeoutMs: state.pollTimeoutSec * 1000,
        minReceivedAt: minReceivedAt || phaseStartedAt,
        freshnessGraceMs: 15000,
        mailboxContext: {
          isTemp: Boolean(account?.isTemp || emailRecord?.isTemp),
        },
        addLog,
        step,
        round,
        maxRounds: 3,
        phaseLabel,
        unreadOnly: true,
        consumedMessageIds,
        shouldContinue: async () => {
          await ensureAutoFlowActive();
          return true;
        },
        match: {
          keyword: state.mailKeyword,
          fromIncludes: state.mailFromKeyword,
          subjectContains: '',
        },
      });
    },
  });

  if (phase === 'signup') {
    await setRuntime({
      lastSignupCode: result.code,
      lastSignupMail: compactVerificationMailResult(result),
    });
  } else {
    await setRuntime({
      lastLoginCode: result.code,
      lastLoginMail: compactVerificationMailResult(result),
    });
  }
  const aliasText = result.matchedAlias ? `，别名命中 ${result.matchedAlias}` : '';
  const detailText = result.extractedFromDetail ? '（来自邮件详情）' : '';
  const olderText = result.usedOlderMatch ? '，使用了较早的匹配邮件' : '';
  await addLog(`步骤 ${step}：已锁定${phaseLabel}${detailText}${aliasText}${olderText}。`, 'info');
  return result;
}

async function broadcastStopFlow() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => tab.id)
    .map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'STOP_FLOW' }).catch(() => null)));
}

function getAutoRestartLabel(mode) {
  return mode === 'next' ? '切换到下一个账号' : '重启本轮';
}

async function queueAutoRestart(mode) {
  const label = getAutoRestartLabel(mode);
  await setRuntime({
    stopRequested: true,
    pendingAutoAction: mode,
  });
  await addLog(`已请求${label}，正在停止当前流程...`, 'warn');
  await broadcastStopFlow();
  return { queued: true, mode };
}

async function performAutoRestart(mode, state) {
  const latestState = state || await getState();
  const label = getAutoRestartLabel(mode);
  const runtimeUpdates = buildAutoRestartRuntimeUpdates({
    mode,
    currentAccountIndex: latestState.currentAccountIndex,
  });
  const resume = Boolean(latestState.autoCurrentRun);

  await setRuntime({
    ...runtimeUpdates,
    ...(mode === 'next' ? { selectedAccountAddress: '' } : {}),
    autoCurrentRun: latestState.autoCurrentRun || 1,
    autoTotalRuns: latestState.autoTotalRuns || latestState.runCount,
    pendingAutoAction: '',
  });
  await addLog(
    mode === 'next'
      ? `已切换到下一个账号，准备重新开始第 ${latestState.autoCurrentRun || 1}/${latestState.autoTotalRuns || latestState.runCount || 1} 轮`
      : `已重启当前账号，准备重新开始第 ${latestState.autoCurrentRun || 1}/${latestState.autoTotalRuns || latestState.runCount || 1} 轮`,
    'warn'
  );
  return runAutoFlow({ resume });
}

async function getSessionCookiesForBaseUrl(baseUrl) {
  if (!chrome.cookies?.getAll || !baseUrl) {
    return [];
  }
  try {
    return await chrome.cookies.getAll({ url: baseUrl });
  } catch {
    return [];
  }
}

async function syncRegisteredTagForState(state, account) {
  const record = state.currentEmailRecord;
  if (account?.isTemp || record?.isTemp) {
    await addLog(`${COMPLETED_ACCOUNT_TAG_NAME} 标签同步跳过：当前账号属于临时邮箱来源`, 'info');
    return { skipped: true, reason: 'temp_email' };
  }
  if (!state.mailApiBaseUrl) {
    await addLog(`${COMPLETED_ACCOUNT_TAG_NAME} 标签同步跳过：未配置 API URL`, 'warn');
    return { skipped: true, reason: 'missing_base_url' };
  }
  if (!record?.id) {
    await addLog(`${COMPLETED_ACCOUNT_TAG_NAME} 标签同步跳过：当前账号缺少平台记录 ID`, 'warn');
    return { skipped: true, reason: 'missing_account_id' };
  }

  const cookies = await getSessionCookiesForBaseUrl(state.mailApiBaseUrl);
  if (!cookies.length) {
    await addLog(`${COMPLETED_ACCOUNT_TAG_NAME} 标签同步跳过：未检测到浏览器 Session Cookie`, 'warn');
    return { skipped: true, reason: 'missing_session_cookie' };
  }

  await addLog(`已检测到 ${cookies.length} 个 Session Cookie，准备同步“${COMPLETED_ACCOUNT_TAG_NAME}”标签...`, 'info');
  const client = createInternalSessionClient({
    baseUrl: state.mailApiBaseUrl,
  });
  const result = await client.markAccountRegistered({
    accountId: record.id,
    tagName: COMPLETED_ACCOUNT_TAG_NAME,
    tagColor: COMPLETED_ACCOUNT_TAG_COLOR,
  });
  await addLog(
    result.created
      ? `已创建并打上“${COMPLETED_ACCOUNT_TAG_NAME}”标签：${account.address}`
      : `已同步“${COMPLETED_ACCOUNT_TAG_NAME}”标签：${account.address}`,
    'ok'
  );
  return result;
}

function buildSandboxFlowActions() {
  return {
    addLog,
    checkAutoControl: ensureAutoFlowActive,
    ensureMailBackendLogin: ensureMailUiLoggedIn,
    getSandboxEmail: handlers.GET_SANDBOX_EMAIL,
    openSandboxLoginPage: handlers.OPEN_SANDBOX_LOGIN_PAGE,
    executeSandboxStep: async (step) => handlers.EXECUTE_SANDBOX_STEP({ step }),
    pollVerificationCode: async (phase) => handlers.POLL_VERIFICATION_CODE({ phase }),
    fillLastCode: async (phase) => handlers.FILL_LAST_CODE({ phase }),
    copySandboxSessionJson: handlers.COPY_SANDBOX_SESSION_JSON,
    submitSessionToPayUrl: handlers.SUBMIT_SESSION_TO_PAYURL,
    completeCurrentAccount: handlers.COMPLETE_CURRENT_ACCOUNT,
  };
}

async function runAutoFlow({ resume = false } = {}) {
  const state = await getState();
  const totalRuns = resume && state.autoTotalRuns ? state.autoTotalRuns : state.runCount;
  const startIndex = resume && state.autoPaused ? Math.max(0, (state.autoCurrentRun || 1) - 1) : 0;
  let restartTriggered = false;
  await resetStepStatuses();
  await setRuntime({
    autoRunning: true,
    autoPaused: false,
    stopRequested: false,
    autoCurrentRun: startIndex + 1,
    autoTotalRuns: totalRuns,
  });

  try {
    const result = await runAutoFlowBatch({
      runCount: totalRuns,
      startIndex,
      continueOnError: false,
      runFlow: async (attempt) => {
        await setRuntime({ autoCurrentRun: attempt + 1, autoTotalRuns: totalRuns });
        await addLog(`=== 第 ${attempt + 1}/${totalRuns} 轮：开始执行自动流程 ===`, 'info');
        return runSandboxSessionFlow({
          actions: buildSandboxFlowActions(),
        });
      },
      onAttemptError: async (error) => {
        const latestState = await getState();
        const failingAccount = latestState.currentAccount;
        const problemStep = findProblemStep(latestState.stepStatuses || {});
        const problemScope = problemStep ? getStepLabel(problemStep) : '自动流程';
        if (!hasLoggedError(error)) {
          await addLog(`${problemScope} 执行失败：${error.message || String(error)}`, 'error');
          markErrorLogged(error);
        }
        await addLog('当前流程已停止，可点击“继续”从失败步骤接着执行。', 'warn');
      },
      onPaused: async (resumeIndex) => {
        await setRuntime({
          autoRunning: false,
          autoPaused: true,
          stopRequested: false,
          autoCurrentRun: resumeIndex + 1,
          autoTotalRuns: totalRuns,
        });
        await addLog(`自动流程已暂停，将从第 ${resumeIndex + 1}/${totalRuns} 轮重新开始当前账号`, 'warn');
      },
    });

    const latestState = await getState();
    if (result.pausedAt != null && latestState.pendingAutoAction) {
      restartTriggered = true;
      await performAutoRestart(latestState.pendingAutoAction, latestState);
    }
    return result;
  } finally {
    if (restartTriggered) {
      return;
    }
    const latestState = await getState();
    if (!latestState.autoPaused) {
      await setRuntime({
        autoRunning: false,
        stopRequested: false,
        autoCurrentRun: 0,
        autoTotalRuns: 0,
        pendingAutoAction: '',
      });
    }
  }
}

const handlers = {
  async GET_STATE() {
    return getState();
  },
  async SAVE_SETTINGS(payload) {
    assertSessionProtectionSettings(payload || {});
    await setSettings(payload || {});
    await addLog('设置已保存', 'ok');
    return getState();
  },
  async CLEAR_LOGS() {
    await setRuntime({ logs: [] });
    return { ok: true };
  },
  async PARSE_ACCOUNT_POOL(payload) {
    const state = await getState();
    const accounts = await buildClient(state).listAccounts();
    await addLog(`邮箱池已从 Outlook API 拉取完成，共 ${accounts.length} 条`, 'ok');
    return { count: accounts.length, first: accounts[0] || null };
  },
  async LIST_AVAILABLE_ACCOUNTS(payload) {
    const state = await getState();
    const client = buildClient(state);
    const accounts = await client.listAccounts();
    const availableAccounts = listAvailableAccounts(accounts, state.usedAccounts || {}, {
      query: payload?.query || '',
      limit: 30,
    }).map((account) => ({
      address: account.address,
      provider: account.provider || '',
      groupName: account.groupName || '',
      isTemp: Boolean(account.isTemp),
    }));
    return {
      accounts: availableAccounts,
      selectedAccountAddress: getSelectedAccountAddress(state),
      tempEmailStatus: client.getTempEmailStatus?.() || null,
    };
  },
  async SELECT_ACCOUNT(payload) {
    const state = await getState();
    const requestedAddress = String(payload?.address || '').trim().toLowerCase();

    if (!requestedAddress) {
      await setRuntime({
        selectedAccountAddress: '',
        currentAccount: null,
        currentEmailRecord: null,
      });
      await addLog('已清除手动指定邮箱', 'info');
      return { selectedAccountAddress: '' };
    }

    const accounts = await buildClient(state).listAccounts();
    const selection = findAvailableAccountByAddress(accounts, state.usedAccounts || {}, requestedAddress);
    if (!selection?.account?.address) {
      throw new Error(`未找到可用邮箱：${requestedAddress}`);
    }

    await setRuntime({
      selectedAccountAddress: selection.account.address,
      currentAccount: selection.account,
      currentAccountIndex: selection.index,
      currentEmailRecord: null,
    });
    await addLog(`已手动指定邮箱：${selection.account.address}`, 'ok');
    return {
      selectedAccountAddress: selection.account.address,
      account: selection.account,
    };
  },
  async GET_SANDBOX_EMAIL() {
    return runManagedStep(1, async () => {
      const state = await getState();
      await addLog('步骤 1：正在从 sandbox 邮箱 API 拉取未注册邮箱...', 'info');
      const account = await resolveCurrentAccount(state);
      await setRuntime({ currentEmailRecord: account });
      await addLog(`步骤 1：当前邮箱 ${account.address}`, 'ok');
      return account;
    }, {
      startMessage: '',
      successMessage: '步骤 1：已获取未注册邮箱',
    });
  },
  async OPEN_SANDBOX_LOGIN_PAGE() {
    const state = await getState();
    return runManagedStep(2, async () => {
      const tab = await openSandboxLoginPage(state);
      await sendToReadySource(SANDBOX_LOGIN_SOURCE, tab.id, {
        type: 'EXECUTE_STEP',
        step: 2,
        payload: {},
      }, 15000);
      return { tabId: tab.id, url: tab.url };
    }, {
      startMessage: '步骤 2：正在打开 sandbox 登录页...',
      successMessage: '步骤 2：sandbox 登录页已打开',
    });
  },
  async EXECUTE_SANDBOX_STEP(payload) {
    const step = Number(payload?.step || 0);
    if (![3, 5].includes(step)) {
      throw new Error(`Sandbox 流程不支持步骤 ${step}`);
    }
    return runContentDrivenStep(step, async () => {
      const state = await getState();
      const account = await ensureCurrentAccount(state);
      const tab = await getActiveAuthTab();
      await ensureSandboxLoginScriptReady(tab.id);
      const beforeSnapshot = await readSandboxAuthDomSnapshot(tab.id, { ensureScript: true });
      const result = await sendToTab(tab.id, {
        type: 'EXECUTE_STEP',
        step,
        payload: {
          ...payload,
          address: account.address,
          profileFullName: state.profileFullName,
          profileAge: state.profileAge,
        },
      }, { timeoutMs: 30000 });
      const evidence = await waitForSandboxStepEvidence(tab.id, step, beforeSnapshot);
      let onboarding = null;
      if (step === 5) {
        onboarding = await handlePostProfileOnboarding(tab.id);
      }
      return { ...result, evidence, onboarding };
    }, {
      startMessage: step === 3 ? '步骤 3：正在填写 sandbox 邮箱...' : '步骤 5：正在填写基础资料...',
      successMessage: step === 3 ? '步骤 3：邮箱已提交' : '步骤 5：基础资料已提交',
    });
  },
  async GET_OAUTH_FROM_VPS() {
    const state = await getState();
    if (!state.vpsUrl) {
      throw new Error('请先填写 CPA 地址');
    }
    return runManagedStep(1, async () => {
      const tabId = await openOrReusePanelTab('vps-panel', state.vpsUrl, [
        'content/utils.js',
        'shared/oauth-step-helpers-runtime.js',
        'shared/step9-status-runtime.js',
        'content/vps-panel.js',
      ]);
      const result = await sendToReadySource('vps-panel', tabId, {
        type: 'EXECUTE_STEP',
        step: 1,
        payload: { vpsPassword: state.vpsPassword },
      }, 15000);
      if (result?.oauthUrl) {
        await setSettings({ oauthUrl: result.oauthUrl });
        return { oauthUrl: result.oauthUrl };
      }
      return result;
    }, {
      startMessage: '步骤 1：正在从 CPA 面板抓取 OAuth 链接...',
      successMessage: '步骤 1：已从 CPA 面板获取 OAuth 链接',
    });
  },
  async PREPARE_NEXT_ACCOUNT() {
    const state = await getState();
    await addLog('准备账号：正在从邮箱平台拉取可用账号...', 'info');
    const client = buildClient(state);
    const accounts = await client.listAccounts();
    const selection = await resolvePinnedAccountSelection(state, accounts)
      || resolveCurrentAccountSelection({
        accounts,
        ledger: state.usedAccounts || {},
        startIndex: state.currentAccountIndex,
      });
    const match = selection?.account || null;
    if (!match?.address) {
      const summary = summarizeAccountAvailability(accounts, state.usedAccounts || {});
      const skipped = listSkippedAccounts(accounts, state.usedAccounts || {});
      await addLog(
        `准备账号：本次共扫描 ${summary.total} 个邮箱，本地已用 ${summary.completedInLedger} 个，已打 plus/已注册标签 ${summary.taggedRegistered} 个，可用 ${summary.available} 个。`,
        'warn'
      );
      if (skipped.completedInLedger.length) {
        await addLog(`准备账号：被本地账本跳过的邮箱：${skipped.completedInLedger.join(', ')}`, 'warn');
      }
      if (skipped.taggedRegistered.length) {
        await addLog(`准备账号：被 plus/已注册 标签跳过的邮箱：${skipped.taggedRegistered.join(', ')}`, 'warn');
      }
      const tempEmailStatus = client.getTempEmailStatus?.() || null;
      if (tempEmailStatus?.needLogin) {
        await addLog('准备账号：临时邮箱接口当前未登录，本轮未纳入候选账号。请先在同一浏览器登录邮箱后台。', 'warn');
        throw new Error('临时邮箱接口需要登录态，请先在当前浏览器登录邮箱后台后再重试。');
      }
      throw new Error('没有更多未注册邮箱可用');
    }
    await setRuntime({
      currentAccount: match,
      currentAccountIndex: selection.index,
      currentEmailRecord: null,
    });
    await addLog(`当前账号：${match.address}`, 'ok');
    return match;
  },
  async ADVANCE_ACCOUNT() {
    const state = await getState();
    await setRuntime({ selectedAccountAddress: '' });
    const accounts = await buildClient(state).listAccounts();
    const selection = resolveCurrentAccountSelection({
      accounts,
      ledger: state.usedAccounts || {},
      startIndex: Number(state.currentAccountIndex || 0) + 1,
    });
    const nextAccount = selection?.account || null;
    if (!nextAccount?.address) {
      throw new Error('没有更多未注册邮箱可用');
    }
    await setRuntime({
      selectedAccountAddress: '',
      currentAccountIndex: selection.index,
      currentAccount: nextAccount,
      currentEmailRecord: null,
    });
    await addLog(`当前账号：${nextAccount.address}`, 'ok');
    return nextAccount;
  },
  async COMPLETE_CURRENT_ACCOUNT() {
    const state = await getState();
    const account = await ensureCurrentAccount(state);
    try {
      await syncRegisteredTagForState(state, account);
    } catch (error) {
      await addLog(`plus 标签同步失败：${error?.message || String(error)}`, 'warn');
    }
    const usedAccounts = markAccountStatus(state.usedAccounts || {}, account.address, 'completed');
    await setSettings({ usedAccounts });
    const closedAuthTabs = await closeAuthTabs();
    await resetTransientRuntime();
    if (closedAuthTabs) {
      await addLog(`已关闭 ${closedAuthTabs} 个 sandbox 流程标签`, 'info');
    }
    await addLog(`已标记邮箱为本地已使用：${account.address}`, 'ok');
    return { address: account.address, status: 'completed' };
  },
  async RESET_ACCOUNT_LEDGER() {
    await setSettings({ usedAccounts: {} });
    await addLog('已清空已用邮箱账本', 'warn');
    return { ok: true };
  },
  async AUTO_RUN_CURRENT() {
    return runAutoFlow();
  },
  async PAUSE_AUTO_RUN() {
    const state = await getState();
    if (!state.autoRunning) {
      return { paused: false, reason: 'not_running' };
    }
    await setRuntime({ stopRequested: true });
    await addLog('已收到暂停请求，当前步骤结束后将暂停自动流程', 'warn');
    await broadcastStopFlow();
    return { paused: true };
  },
  async QUICK_INTERRUPT_AUTO_RUN() {
    const state = await getState();
    const problemStep = findProblemStep(state.stepStatuses || {});
    await setRuntime({
      stopRequested: true,
      autoRunning: false,
      autoPaused: true,
      pendingAutoAction: '',
    });
    if (problemStep) {
      await setStepStatus(problemStep, 'failed');
    }
    await broadcastStopFlow();
    await addLog(
      problemStep
        ? `已快速中断当前流程，并将 ${getStepLabel(problemStep)} 标记为失败；可直接点击“重新开始”或手动重试该步骤。`
        : '已快速中断当前流程；可直接点击“重新开始”或手动重试。',
      'warn'
    );
    return { interrupted: true, step: problemStep || null };
  },
  async RESUME_AUTO_RUN() {
    const state = await getState();
    if (!state.autoPaused) {
      throw new Error('当前没有已暂停的自动流程');
    }
    if (!state.currentAccount?.address) {
      await addLog(`正在继续自动流程，将从第 ${state.autoCurrentRun}/${state.autoTotalRuns || state.runCount} 轮重新开始当前账号`, 'info');
      return runAutoFlow({ resume: true });
    }

    await setRuntime({
      autoRunning: true,
      autoPaused: false,
      stopRequested: false,
    });
    await addLog(`正在继续自动流程，将从当前中断步骤接着执行`, 'info');

    try {
      return await continueSandboxSessionFlow({
        state,
        actions: buildSandboxFlowActions(),
      });
    } finally {
      await setRuntime({
        autoRunning: false,
        autoPaused: false,
        stopRequested: false,
      });
    }
  },
  async CONTINUE_AUTO_RUN() {
    const state = await getState();
    const problemStep = findProblemStep(state.stepStatuses || {});
    if (!problemStep) {
      throw new Error('当前没有可继续的失败步骤');
    }
    if (!state.currentAccount?.address) {
      throw new Error('当前缺少失败现场账号信息，无法继续');
    }

    await setRuntime({
      autoRunning: true,
      autoPaused: false,
      stopRequested: false,
    });
    await addLog(`正在继续自动流程，将从 ${getStepLabel(problemStep)} 接着执行`, 'info');

    try {
      return await continueSandboxSessionFlow({
        state,
        actions: buildSandboxFlowActions(),
      });
    } finally {
      await setRuntime({
        autoRunning: false,
        autoPaused: false,
        stopRequested: false,
      });
    }
  },
  async RESTART_CURRENT_RUN() {
    const state = await getState();
    if (state.autoRunning) {
      return queueAutoRestart('current');
    }
    return performAutoRestart('current', state);
  },
  async RESTART_WITH_NEXT_ACCOUNT() {
    const state = await getState();
    if (state.autoRunning) {
      return queueAutoRestart('next');
    }
    return performAutoRestart('next', state);
  },
  async EXECUTE_FINAL_VERIFY_STEP() {
    const state = await getState();
    if (!state.localhostUrl) {
      throw new Error('缺少 localhost 回调地址，请先完成步骤 8。');
    }
    if (!state.vpsUrl) {
      throw new Error('请先填写 CPA 地址');
    }
    return runManagedStep(9, async () => {
      const tabId = await openOrReusePanelTab('vps-panel', state.vpsUrl, [
        'content/utils.js',
        'shared/oauth-step-helpers-runtime.js',
        'shared/step9-status-runtime.js',
        'content/vps-panel.js',
      ], {
        preserveExistingTab: true,
      });
      const result = await sendToReadySource('vps-panel', tabId, {
        type: 'EXECUTE_STEP',
        step: 9,
        payload: {
          localhostUrl: state.localhostUrl,
          vpsPassword: state.vpsPassword,
        },
      }, 15000);
      return result;
    }, {
      startMessage: '步骤 9：正在把 localhost 回调地址回填到 CPA 面板...',
      successMessage: '步骤 9：CPA 面板校验完成',
    });
  },
  async COPY_SANDBOX_SESSION_JSON() {
    const state = await getState();
    return runManagedStep(6, async () => {
      const endpoint = validateSandboxSessionEndpoint(state.sessionEndpointUrl, {
        allowedBaseUrls: [state.loginPageUrl, state.mailApiBaseUrl],
        baseUrl: state.loginPageUrl || state.mailApiBaseUrl || 'http://localhost/',
        enforceAllowlist: state.sessionProtectionEnabled !== false,
      });
      const sessionTab = await chrome.tabs.create({ url: endpoint, active: true });
      await waitForTabComplete(sessionTab.id, 30000);
      await injectSandboxLoginScript(sessionTab.id);
      await setRuntime({ authTabId: sessionTab.id });
      const result = await sendToTab(sessionTab.id, {
        type: 'COPY_SESSION_JSON_FROM_PAGE',
        step: 6,
        payload: {
          endpoint,
          allowedBaseUrls: [state.loginPageUrl, state.mailApiBaseUrl],
          enforceAllowlist: state.sessionProtectionEnabled !== false,
        },
      }, { timeoutMs: 30000 });
      await setRuntime({
        lastSessionJson: result.sessionJson || '',
        lastSessionEndpoint: endpoint,
      });
      if (state.recordSuccessResults && result.sessionJson) {
        const account = await ensureCurrentAccount(state);
        await setSettings({
          successResults: [
            ...(state.successResults || []),
            {
              address: account.address,
              sessionEndpoint: endpoint,
              createdAt: new Date().toISOString(),
              status: 'session_copied',
            },
          ],
        });
      }
      return { ok: true, copied: Boolean(result.copied), endpoint, sessionTabId: sessionTab.id };
    }, {
      startMessage: '步骤 6：正在打开 session endpoint 页面并复制 JSON...',
      successMessage: '步骤 6：Session JSON 已复制到剪贴板',
    });
  },
  async SUBMIT_SESSION_TO_PAYURL() {
    const state = await getState();
    return runManagedStep(7, async () => {
      if (!state.lastSessionJson) {
        throw new Error('当前没有可提交的 Session JSON，请先执行步骤 6');
      }
      await addLog(`步骤 7：正在打开支付长链页面并填入 Session JSON：${PAYMENT_GENERATOR_URL}`, 'info');
      const paymentResult = await openPaymentGeneratorAndSubmit(state.lastSessionJson);
      await addLog(`步骤 7：支付长链页面已填入 JSON 并点击生成按钮（tabId=${paymentResult.tabId}）`, 'ok');
      return { ok: true, paymentResult };
    }, {
      startMessage: '步骤 7：正在提交 Session JSON 到支付长链页面...',
      successMessage: '步骤 7：支付长链生成已提交',
    });
  },
  async SYNC_CURRENT_ACCOUNT() {
    await addLog('当前平台不需要在插件内同步邮箱，请在平台后台维护邮箱池', 'info');
    const result = { skipped: true };
    return result;
  },
  async FIND_CURRENT_EMAIL_RECORD() {
    const state = await getState();
    const record = await ensureCurrentEmailRecord(state);
    const hitText = record.matchedAlias
      ? `已定位平台邮箱记录：${record.address}（别名命中 ${record.matchedAlias}）`
      : `已定位平台邮箱记录：${record.address}`;
    await addLog(hitText, 'ok');
    return record;
  },
  async OPEN_OAUTH_URL() {
    const state = await getState();
    await openOauthUrl(state.oauthUrl);
    await addLog('已打开 OAuth 页面', 'ok');
    return { ok: true };
  },
  async EXECUTE_SIGNUP_STEP(payload) {
    const state = await getState();
    if (payload?.step === 1) {
      return handlers.GET_OAUTH_FROM_VPS();
    }
    const step = Number(payload?.step || 0);
    if (!step) {
      throw new Error('缺少 step 参数');
    }

    if (step === 2 || step === 3) {
      return runContentDrivenStep(step, async () => {
        const state = await getState();
        const waitForPageStep = contentStepSignals.waitForStep(step, step === 3 ? 45000 : 20000);
        void executeSignupStepCommand({
          step,
          payload,
          state,
          ensureCurrentAccount,
          openOauthUrl,
          addLog,
          sendToActiveAuthTab,
          sendToTab,
        }).then((dispatchResult) => {
          settleStepWaiterFromDispatchResult(contentStepSignals, step, dispatchResult);
        }).catch((error) => {
          if (!isMissingReceiverError(error)) {
            contentStepSignals.rejectStep(step, error);
          }
        });
        return await waitForPageStep;
      });
    }

    if (step === 8) {
      return runManagedStep(8, () => new Promise(async (resolve, reject) => {
        let resolved = false;
        let webNavListener = null;

        const cleanupListener = () => {
          if (webNavListener) {
            chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
            webNavListener = null;
          }
        };

        const finishStep8WithCallbackUrl = async (url) => {
          const matchedUrl = findLoopbackCallbackUrl([url]);
          if (!matchedUrl || resolved) return false;

          resolved = true;
          cleanupListener();
          clearTimeout(timeout);
          await setRuntime({ localhostUrl: matchedUrl });
          await setStepStatus(8, 'completed');
          await addLog(`步骤 8：已捕获 localhost 回调 ${matchedUrl.slice(0, 80)}...`, 'ok');
          resolve({ localhostUrl: matchedUrl });
          return true;
        };

        const timeout = setTimeout(async () => {
          cleanupListener();
          resolved = true;
          await setStepStatus(8, 'failed');
          reject(new Error('120 秒内未捕获到 localhost 回调跳转。'));
        }, 120000);

        webNavListener = (details) => {
          const matchedUrl = findLoopbackCallbackUrl([details.url]);
          if (matchedUrl) {
            void finishStep8WithCallbackUrl(matchedUrl);
          }
        };

        chrome.webNavigation.onBeforeNavigate.addListener(webNavListener);

        try {
          await addLog('步骤 8：正在监听 localhost 回调地址...', 'info');
          const authTab = await getActiveAuthTab();
          const clickResult = await chrome.tabs.sendMessage(authTab.id, {
            type: 'STEP8_FIND_AND_CLICK',
            payload: {},
          });

          if (clickResult?.error) {
            throw new Error(clickResult.error);
          }

          const clickPlan = decideStep8ClickPlan({
            nativeClicked: Boolean(clickResult?.clicked),
            hasRect: Boolean(clickResult?.rect),
          });

          if (clickPlan === 'no_click_available') {
            throw new Error('步骤 8：未能获取可点击的 Continue 按钮。');
          }

          if (clickPlan === 'debugger_only') {
            await clickWithDebugger(authTab.id, clickResult.rect);
            await addLog('步骤 8：已发送调试器点击，正在等待跳转...', 'info');
          } else if (clickPlan === 'native_only') {
            await addLog('步骤 8：已发送页面内点击，正在等待跳转...', 'info');
          } else {
            await addLog('步骤 8：已发送页面内点击，若未跳转将自动补发调试器点击...', 'info');
            setTimeout(() => {
              if (!resolved && clickResult?.rect) {
                void clickWithDebugger(authTab.id, clickResult.rect)
                  .then(() => addLog('步骤 8：已补发调试器点击，继续等待跳转...', 'info'))
                  .catch(() => null);
              }
            }, 1500);
          }

          (async () => {
            while (!resolved) {
              const tab = await chrome.tabs.get(authTab.id).catch(() => null);
              const matchedUrl = findLoopbackCallbackUrl([tab?.url || '']);
              if (matchedUrl) {
                await finishStep8WithCallbackUrl(matchedUrl);
                return;
              }
              await new Promise((resume) => setTimeout(resume, 250));
            }
          })().catch(async (error) => {
            if (!resolved) {
              clearTimeout(timeout);
              cleanupListener();
              reject(error);
            }
          });
        } catch (error) {
          clearTimeout(timeout);
          cleanupListener();
          reject(error);
        }
      }), {
        startMessage: '步骤 8：正在确认 OAuth 同意页并准备点击继续...',
        successMessage: '步骤 8：已确认 OAuth 授权并捕获回调地址',
      });
    }

    return runManagedStep(step, async () => {
      if (step === 6) {
        const account = await ensureCurrentAccount(state);
        const loginPassword = resolveLoginPassword({
          defaultLoginPassword: state.defaultLoginPassword,
          accountPassword: account.password,
        });
        const authTab = await openOauthUrl(state.oauthUrl);
        await addLog('步骤 6：已重新打开 OAuth 页面，准备登录...', 'info');
        return sendToTab(authTab.id, {
          type: 'EXECUTE_STEP',
          step,
          payload: {
            ...account,
            loginPassword,
          },
        });
      }
      return executeSignupStepCommand({
        step,
        payload,
        state,
        ensureCurrentAccount,
        openOauthUrl,
        addLog,
        sendToActiveAuthTab: step === 3 ? sendToActiveAuthTabOnce : sendToActiveAuthTab,
        sendToTab,
      });
    }, {
      startMessage: {
        2: '',
        3: '',
        5: '步骤 5：正在填写基础资料...',
        6: '步骤 6：正在刷新 OAuth 页面并执行登录...',
      }[step] ?? `${getStepLabel(step)} 开始执行`,
      successMessage: {
        2: '',
        3: '',
        5: '步骤 5：基础资料已提交',
        6: '步骤 6：登录操作已提交，准备进入验证码阶段',
      }[step] ?? `${getStepLabel(step)} 已完成`,
    });
  },
  async POLL_VERIFICATION_CODE(payload) {
    const state = await getState();
    const phase = payload?.phase === 'login' ? 'login' : 'signup';
    const step = phase === 'signup' ? 4 : 7;
    return runManagedStep(step, async () => {
      const result = await pollCodeForPhase(state, phase);
      await addLog(`${phase === 'signup' ? '注册' : '登录'}验证码：${result.code}`, 'ok');
      return result;
    }, {
      startMessage: `步骤 ${step}：正在轮询${phase === 'signup' ? '注册' : '登录'}验证码...`,
      successMessage: `步骤 ${step}：已收到${phase === 'signup' ? '注册' : '登录'}验证码`,
    });
  },
  async FILL_LAST_CODE(payload) {
    const state = await getState();
    const phase = payload?.phase === 'login' ? 'login' : 'signup';
    const code = phase === 'signup' ? state.lastSignupCode : state.lastLoginCode;
    const step = phase === 'signup' ? 4 : 7;
    if (!code) {
      throw new Error('当前没有可填写的验证码');
    }
    return runManagedStep(step, async () => {
      const tab = await getActiveAuthTab();
      await ensureSandboxLoginScriptReady(tab.id);
      const beforeSnapshot = await readSandboxAuthDomSnapshot(tab.id, { ensureScript: true });
      const result = await sendToTab(tab.id, { type: 'FILL_CODE', step, payload: { code } }, { timeoutMs: 30000 });
      await waitForSandboxStepEvidence(tab.id, step, beforeSnapshot);
      await markVerificationMailUsed(state, phase);
      await setRuntime({
        [getVerificationCodeRuntimeKey(phase)]: '',
        [getVerificationMailRuntimeKey(phase)]: null,
      });
      return result;
    }, {
      startMessage: '',
      successMessage: '',
      failurePrefix: `步骤 ${step}：验证码回填失败`,
    });
  },
};

chrome.runtime.onInstalled.addListener(() => {
  void runExtensionStartupTasks();
});

chrome.runtime.onStartup.addListener(() => {
  void runExtensionStartupTasks();
});

void runExtensionStartupTasks();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LOG') {
    addLog(message.payload?.message || '', message.payload?.level || 'info')
      .then(() => sendResponse({ ok: true, data: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'STEP_COMPLETE') {
    Promise.all([
      setStepStatus(message.step, 'completed'),
      (message.step === 2 || message.step === 3) && _sender?.tab?.id
        ? clearPendingSignupStep(_sender.tab.id)
        : Promise.resolve(),
      message.payload?.localhostUrl ? setRuntime({ localhostUrl: message.payload.localhostUrl }) : Promise.resolve(),
      addLog(`页面内步骤 ${message.step} 已完成`, 'ok'),
    ])
      .then(() => {
        contentStepSignals.resolveStep(message.step, message.payload || { ok: true });
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'STEP_ERROR') {
    const stepError = new Error(message.error || '未知错误');
    markErrorLogged(stepError);
    Promise.all([
      setStepStatus(message.step, 'failed'),
      (message.step === 2 || message.step === 3) && _sender?.tab?.id
        ? clearPendingSignupStep(_sender.tab.id)
        : Promise.resolve(),
      addLog(`页面内步骤 ${message.step} 失败：${message.error || '未知错误'}`, 'error'),
    ])
      .then(() => {
        contentStepSignals.rejectStep(message.step, stepError);
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'CONTENT_SCRIPT_READY') {
    const source = message.source || 'unknown';
    const tabId = _sender?.tab?.id || null;
    addLog(`页面脚本已就绪：${source}`, 'info')
      .then(async () => {
        readyCommandQueue.markReady(source, tabId);
        if (tabId) {
          await readyCommandQueue.flushReadyCommand(source, (queuedMessage) => chrome.tabs.sendMessage(tabId, queuedMessage)).catch(() => null);
        }
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'SET_PENDING_SIGNUP_STEP') {
    const tabId = _sender?.tab?.id || null;
    if (!tabId) {
      sendResponse({ ok: false, error: '当前页面缺少 tabId，无法保存待恢复步骤' });
      return true;
    }

    savePendingSignupStep(tabId, message.payload || {})
      .then(() => sendResponse({ ok: true, data: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'GET_PENDING_SIGNUP_STEP') {
    const tabId = _sender?.tab?.id || null;
    if (!tabId) {
      sendResponse({ ok: true, data: null });
      return true;
    }

    readPendingSignupStep(tabId)
      .then((payload) => sendResponse({ ok: true, data: payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'CLEAR_PENDING_SIGNUP_STEP') {
    const tabId = _sender?.tab?.id || null;
    if (!tabId) {
      sendResponse({ ok: true, data: true });
      return true;
    }

    clearPendingSignupStep(tabId)
      .then(() => sendResponse({ ok: true, data: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `未知消息类型：${message?.type}` });
    return;
  }

  handler(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch(async (error) => {
      if (!hasLoggedError(error)) {
        await addLog(error.message || String(error), 'error');
      }
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
