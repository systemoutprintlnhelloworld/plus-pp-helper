# Auto Pause Session Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前扩展补齐自动流程暂停/继续、每轮强制刷新 CPA 与认证页、验证码重发恢复、详细日志，以及成功后自动用浏览器 Session 调内部 API 打“已注册”标签。

**Architecture:** 以现有 background orchestrator 为主，新增少量 shared helper，把“自动流程控制”“内部 API 打标签”“验证码重发恢复”抽成可测试单元。UI 只做最小改动，复用现有 sidepanel 按钮与状态展示，不引入新的复杂页面结构。

**Tech Stack:** Chrome MV3、Service Worker、Content Script、Node test runner

---

### Task 1: 自动流程控制与暂停恢复

**Files:**
- Create: `shared/auto-run-control.js`
- Modify: `shared/auto-flow.js`
- Modify: `shared/state-machine.js`
- Modify: `background.js`
- Modify: `sidepanel/sidepanel.js`
- Test: `tests/auto-run-control.test.js`
- Test: `tests/auto-run-batch.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the new tests and verify they fail for the expected reason**
- [ ] **Step 3: Implement pause error helpers, batch resume cursor, runtime fields, and sidepanel pause/continue button state**
- [ ] **Step 4: Run the targeted tests and verify they pass**

### Task 2: 每轮刷新 CPA 与认证页

**Files:**
- Modify: `shared/auto-flow.js`
- Modify: `background.js`
- Create: `shared/oauth-tab-navigation.js`
- Test: `tests/auto-flow.test.js`
- Test: `tests/oauth-tab-navigation.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the new tests and verify they fail for the expected reason**
- [ ] **Step 3: Implement “每轮先 Step 1 刷新 OAuth，再 fresh 打开/强制 reload 认证页”的最小代码**
- [ ] **Step 4: Run the targeted tests and verify they pass**

### Task 3: 验证码重发恢复与详细日志

**Files:**
- Create: `shared/verification-recovery.js`
- Modify: `shared/verification-poller.js`
- Modify: `content/signup-page.js`
- Modify: `background.js`
- Test: `tests/verification-recovery.test.js`
- Test: `tests/verification-poller.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the new tests and verify they fail for the expected reason**
- [ ] **Step 3: Implement重发验证码入口、轮询重试策略、详细阶段日志**
- [ ] **Step 4: Run the targeted tests and verify they pass**

### Task 4: Session Cookie 内部 API 打“已注册”标签

**Files:**
- Create: `shared/internal-session-client.js`
- Modify: `background.js`
- Modify: `manifest.json`
- Test: `tests/internal-session-client.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the new tests and verify they fail for the expected reason**
- [ ] **Step 3: Implement cookie 检测、CSRF 获取、标签查找/创建、账号打标签**
- [ ] **Step 4: Run the targeted tests and verify they pass**

### Task 5: 完整验证与交接

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run `npm test`**
- [ ] **Step 2: Run `find . -name '*.js' -not -path './.git/*' -print0 | xargs -0 -n1 node --check`**
- [ ] **Step 3: Update `README.md` and `HANDOFF.md` with pause/继续、标签同步、真实联调说明**
