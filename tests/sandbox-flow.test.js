import test from 'node:test';
import assert from 'node:assert/strict';

import { continueSandboxSessionFlow, runSandboxSessionFlow } from '../shared/sandbox-flow.js';

test('runSandboxSessionFlow executes the sandbox happy path in order', async () => {
  const calls = [];

  const result = await runSandboxSessionFlow({
    actions: {
      async addLog(message) { calls.push(`log:${message}`); },
      async getSandboxEmail() { calls.push('getSandboxEmail'); },
      async openSandboxLoginPage() { calls.push('openSandboxLoginPage'); },
      async executeSandboxStep(step) { calls.push(`executeSandboxStep:${step}`); },
      async pollVerificationCode(phase) { calls.push(`pollVerificationCode:${phase}`); },
      async fillLastCode(phase) { calls.push(`fillLastCode:${phase}`); },
      async copySandboxSessionJson() { calls.push('copySandboxSessionJson'); },
      async submitSessionToPayUrl() { calls.push('submitSessionToPayUrl'); },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:Sandbox 单轮流程开始',
    'getSandboxEmail',
    'openSandboxLoginPage',
    'executeSandboxStep:3',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSandboxStep:5',
    'copySandboxSessionJson',
    'submitSessionToPayUrl',
    'completeCurrentAccount',
    'log:Sandbox 流程完成，当前邮箱已标记为已使用',
  ]);
});

test('continueSandboxSessionFlow resumes from the first incomplete sandbox step', async () => {
  const calls = [];

  const result = await continueSandboxSessionFlow({
    state: {
      stepStatuses: {
        1: 'completed',
        2: 'completed',
        3: 'completed',
        4: 'failed',
        5: 'pending',
        6: 'pending',
        7: 'pending',
      },
    },
    actions: {
      async addLog(message) { calls.push(`log:${message}`); },
      async pollVerificationCode(phase) { calls.push(`pollVerificationCode:${phase}`); },
      async fillLastCode(phase) { calls.push(`fillLastCode:${phase}`); },
      async executeSandboxStep(step) { calls.push(`executeSandboxStep:${step}`); },
      async copySandboxSessionJson() { calls.push('copySandboxSessionJson'); },
      async submitSessionToPayUrl() { calls.push('submitSessionToPayUrl'); },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:继续 Sandbox 流程：从步骤 4 开始',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSandboxStep:5',
    'copySandboxSessionJson',
    'submitSessionToPayUrl',
    'completeCurrentAccount',
    'log:Sandbox 流程完成，当前邮箱已标记为已使用',
  ]);
});
