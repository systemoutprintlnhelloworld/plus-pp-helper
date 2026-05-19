# Hotmail Register Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个独立的 Chrome MV3 扩展，使用固定 Hotmail 账号池和 Luckmail API 自动完成 OpenAI OAuth 注册流程中的验证码获取与页面回填。

**Architecture:** 扩展采用 sidepanel + background service worker + content scripts 结构。`background.js` 负责流程编排和状态，`shared/` 负责账号池解析与 Luckmail API 封装，`content/signup-page.js` 负责注册页自动化，`sidepanel/` 负责配置与运行控制。

**Tech Stack:** Chrome MV3, 原生 JavaScript, 原生 fetch, Node.js `node:test`

---

## File Structure

- Create: `manifest.json`
- Create: `background.js`
- Create: `content/utils.js`
- Create: `content/signup-page.js`
- Create: `sidepanel/sidepanel.html`
- Create: `sidepanel/sidepanel.css`
- Create: `sidepanel/sidepanel.js`
- Create: `shared/account-pool.js`
- Create: `shared/luckmail-client.js`
- Create: `shared/oauth-step-helpers.js`
- Create: `shared/state-machine.js`
- Create: `shared/verification-poller.js`
- Create: `tests/account-pool.test.js`
- Create: `tests/luckmail-client.test.js`
- Create: `tests/verification-poller.test.js`
- Modify: `README.md`

### Task 1: Scaffold Independent MV3 Extension

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `sidepanel/sidepanel.html`
- Create: `sidepanel/sidepanel.css`
- Create: `sidepanel/sidepanel.js`
- Create: `content/utils.js`
- Create: `content/signup-page.js`
- Modify: `README.md`

- [ ] **Step 1: Create minimal manifest and folder structure**

```json
{
  "manifest_version": 3,
  "name": "Hotmail Register Extension",
  "version": "0.1.0",
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" }
}
```

- [ ] **Step 2: Add sidepanel shell and background message loop**

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ ok: true });
});
```

- [ ] **Step 3: Add README startup instructions**

```md
1. 打开 chrome://extensions
2. 加载 `hotmail-register-extension`
3. 打开 side panel
```

- [ ] **Step 4: Verify extension files exist and are internally consistent**

Run: `find . -maxdepth 3 -type f | sort`
Expected: 新扩展所需的 `manifest/background/sidepanel/content` 文件均存在

### Task 2: Build Account Pool Parser with Tests

**Files:**
- Create: `shared/account-pool.js`
- Create: `tests/account-pool.test.js`

- [ ] **Step 1: Write failing tests for parsing and validation**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountPool } from '../shared/account-pool.js';

test('parseAccountPool parses valid rows', () => {
  const accounts = parseAccountPool('a@b.com----pass----cid----rt');
  assert.equal(accounts[0].address, 'a@b.com');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/account-pool.test.js`
Expected: FAIL because `parseAccountPool` is not implemented yet

- [ ] **Step 3: Implement parser and validation helpers**

```js
export function parseAccountPool(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseAccountLine);
}
```

- [ ] **Step 4: Run tests to verify parser passes**

Run: `node --test tests/account-pool.test.js`
Expected: PASS

### Task 3: Implement Luckmail Client with Response Normalization

**Files:**
- Create: `shared/luckmail-client.js`
- Create: `tests/luckmail-client.test.js`

- [ ] **Step 1: Write failing tests for list/find helpers**

```js
test('findUserEmailByAddress returns exact matched record', async () => {
  const client = createLuckmailClient({ apiKey: 'x', fetchImpl: async () => mockResponse });
  const record = await client.findUserEmailByAddress('user@hotmail.com');
  assert.equal(record.address, 'user@hotmail.com');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/luckmail-client.test.js`
Expected: FAIL because client is not implemented yet

- [ ] **Step 3: Implement API wrapper and normalization**

```js
export function createLuckmailClient({ apiKey, baseUrl, fetchImpl = fetch }) {
  return {
    listUserEmails,
    findUserEmailByAddress,
    listUserEmailMails,
    getUserEmailMail,
    importEmails,
  };
}
```

- [ ] **Step 4: Run tests to verify client passes**

Run: `node --test tests/luckmail-client.test.js`
Expected: PASS

### Task 4: Implement Verification Poller with Tests

**Files:**
- Create: `shared/verification-poller.js`
- Create: `tests/verification-poller.test.js`

- [ ] **Step 1: Write failing tests for code preference and timeout**

```js
test('poller prefers verification_code from API', async () => {
  const result = await pollVerificationCode({ /* mocked client */ });
  assert.equal(result.code, '482910');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/verification-poller.test.js`
Expected: FAIL because poller is not implemented yet

- [ ] **Step 3: Implement polling flow**

```js
export async function pollVerificationCode(options) {
  while (!timedOut) {
    const mails = await client.listUserEmailMails(emailId);
    const newest = selectNewestMatchingMail(mails);
    if (newest) return normalizeMailResult(newest);
    await sleep(intervalMs);
  }
  throw new Error('轮询超时');
}
```

- [ ] **Step 4: Run tests to verify poller passes**

Run: `node --test tests/verification-poller.test.js`
Expected: PASS

### Task 5: Add Background State and Minimal Orchestration

**Files:**
- Create: `shared/state-machine.js`
- Modify: `background.js`

- [ ] **Step 1: Implement runtime state defaults**

```js
export const DEFAULT_STATE = {
  currentStep: 0,
  currentAccount: null,
  logs: [],
  stepStatuses: { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending', 8: 'pending' }
};
```

- [ ] **Step 2: Add message handlers for settings, account parsing, and polling**

Run path: `background.js`
Expected behavior: sidepanel can save settings, parse accounts, and trigger a mock poll action

- [ ] **Step 3: Verify background syntax**

Run: `node --check background.js`
Expected: no syntax errors

### Task 6: Build Sidepanel Configuration and Control Surface

**Files:**
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.css`
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: Add config fields**

Fields:
- Luckmail API Key
- OAuth URL
- 账号池文本框
- 导入开关
- 轮询间隔
- 轮询超时
- 开始/停止按钮

- [ ] **Step 2: Wire UI to background messages**

```js
chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload });
```

- [ ] **Step 3: Verify sidepanel assets reference valid element IDs**

Run: `rg -n "getElementById|querySelector" sidepanel`
Expected: 所有脚本引用的 DOM id 都在 HTML 中存在

### Task 7: Port Minimal Signup Page Automation

**Files:**
- Modify: `content/utils.js`
- Modify: `shared/oauth-step-helpers.js`
- Modify: `content/signup-page.js`
- Modify: `manifest.json`

- [ ] **Step 1: Copy minimal DOM helper utilities**

Utilities:
- `waitForElement`
- `simulateInput`
- `simulateClick`
- `sleep`

- [ ] **Step 2: Implement minimal step handlers**

Handlers:
- Step 2: open/register entry
- Step 3: fill email/password
- Step 4/7: fill verification code
- Step 5: fill profile fields

- [ ] **Step 3: Verify content script syntax**

Run: `node --check content/utils.js content/signup-page.js shared/oauth-step-helpers.js`
Expected: no syntax errors

### Task 8: Connect End-to-End Minimal Flow

**Files:**
- Modify: `background.js`
- Modify: `shared/verification-poller.js`
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: Implement single-run happy path**

Flow:
- parse first account
- optionally import
- find email record
- trigger signup steps
- poll signup code
- poll login code

- [ ] **Step 2: Add logging for each step**

Expected logs:
- current account selected
- Luckmail email found
- polling started
- code received

- [ ] **Step 3: Verify overall syntax for all JS files**

Run: `find . -name '*.js' -not -path './.git/*' -print0 | xargs -0 -n1 node --check`
Expected: no syntax errors

### Task 9: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run unit tests**

Run: `node --test tests/*.test.js`
Expected: PASS

- [ ] **Step 2: Re-read README and manifest for loadability**

Run: `sed -n '1,220p' README.md && sed -n '1,220p' manifest.json`
Expected: 安装说明、权限、入口路径正确

- [ ] **Step 3: Record manual smoke test checklist**

Checklist:
- extension can load in Chrome
- sidepanel can save settings
- account pool can parse one valid line
- background can resolve a Luckmail email record
- content script can receive step command
