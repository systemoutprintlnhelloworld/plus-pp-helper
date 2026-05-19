import test from 'node:test';
import assert from 'node:assert/strict';

import { runSingleAutoFlow } from '../shared/auto-flow.js';

test('runSingleAutoFlow executes the happy path in order and marks account completed', async () => {
  const calls = [];

  const result = await runSingleAutoFlow({
    actions: {
      async prepareNextAccount() {
        calls.push('prepareNextAccount');
        return { address: 'user@hotmail.com' };
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: phase === 'signup' ? '123456' : '654321' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
      async addLog(message) {
        calls.push(`log:${message}`);
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'pollVerificationCode:login',
    'fillLastCode:login',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:单轮自动流程完成，当前邮箱已标记为已使用',
  ]);
});

test('runSingleAutoFlow skips signup verification when step 3 lands directly on the profile page', async () => {
  const calls = [];

  const result = await runSingleAutoFlow({
    autoImport: false,
    actions: {
      async prepareNextAccount() {
        calls.push('prepareNextAccount');
        return { address: 'user@hotmail.com' };
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 3) {
          return { skipSignupVerification: true };
        }
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '654321' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
      async addLog(message) {
        calls.push(`log:${message}`);
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'log:步骤 3：检测到当前邮箱已进入资料页，跳过注册码阶段',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'pollVerificationCode:login',
    'fillLastCode:login',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:单轮自动流程完成，当前邮箱已标记为已使用',
  ]);
});

test('runSingleAutoFlow jumps to login flow when step 3 detects existing account login path', async () => {
  const calls = [];

  const result = await runSingleAutoFlow({
    autoImport: false,
    actions: {
      async prepareNextAccount() {
        calls.push('prepareNextAccount');
        return { address: 'user@hotmail.com' };
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 3) {
          return { switchToLoginFlow: true };
        }
        if (step === 6) {
          return { needsOTP: true };
        }
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '654321' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
      async addLog(message) {
        calls.push(`log:${message}`);
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'log:步骤 3：检测到当前邮箱已注册，切换到登录流程并跳过注册验证码与资料填写',
    'executeSignupStep:6',
    'pollVerificationCode:login',
    'fillLastCode:login',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:单轮自动流程完成，当前邮箱已标记为已使用',
  ]);
});

test('runSingleAutoFlow skips login verification when step 6 completes without OTP', async () => {
  const calls = [];

  const result = await runSingleAutoFlow({
    autoImport: false,
    actions: {
      async prepareNextAccount() {
        calls.push('prepareNextAccount');
        return { address: 'user@hotmail.com' };
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 6) {
          return { needsOTP: false };
        }
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '123456' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
      async addLog(message) {
        calls.push(`log:${message}`);
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'log:步骤 6：已通过密码登录，跳过登录验证码阶段',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:单轮自动流程完成，当前邮箱已标记为已使用',
  ]);
});

test('runSingleAutoFlow returns to step 5 when step 6 lands on the profile page', async () => {
  const calls = [];
  let profilePass = 0;

  const result = await runSingleAutoFlow({
    autoImport: false,
    actions: {
      async prepareNextAccount() {
        calls.push('prepareNextAccount');
        return { address: 'user@hotmail.com' };
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 6) {
          return { needsProfileCompletion: true };
        }
        if (step === 5) {
          profilePass += 1;
          if (profilePass === 2) {
            return { needsOTP: false };
          }
        }
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '123456' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
      async addLog(message) {
        calls.push(`log:${message}`);
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'log:步骤 6：检测到资料页，返回步骤 5 补全资料',
    'executeSignupStep:5',
    'log:步骤 6：资料页已补全，直接进入授权阶段',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:单轮自动流程完成，当前邮箱已标记为已使用',
  ]);
});

test('runSingleAutoFlow does not mark account completed when a step fails', async () => {
  const calls = [];

  await assert.rejects(
    () => runSingleAutoFlow({
      autoImport: false,
      actions: {
        async prepareNextAccount() {
          calls.push('prepareNextAccount');
          return { address: 'user@hotmail.com' };
        },
        async findCurrentEmailRecord() {
          calls.push('findCurrentEmailRecord');
          return { id: 1, address: 'user@hotmail.com' };
        },
        async refreshOauthFromVps() {
          calls.push('refreshOauthFromVps');
        },
        async openOauthUrl() {
          calls.push('openOauthUrl');
        },
        async executeSignupStep(step) {
          calls.push(`executeSignupStep:${step}`);
        },
        async pollVerificationCode() {
          calls.push('pollVerificationCode:signup');
          throw new Error('轮询失败');
        },
        async fillLastCode() {
          calls.push('fillLastCode:signup');
        },
        async completeCurrentAccount() {
          calls.push('completeCurrentAccount');
        },
        async addLog(message) {
          calls.push(`log:${message}`);
        },
      },
    }),
    /轮询失败/
  );

  assert.deepEqual(calls, [
    'prepareNextAccount',
    'log:单轮自动流程开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'pollVerificationCode:signup',
  ]);
});

test('runSingleAutoFlow does not mark account completed when step 8 fails', async () => {
  const calls = [];

  await assert.rejects(
    () => runSingleAutoFlow({
      autoImport: false,
      actions: {
        async prepareNextAccount() {
          calls.push('prepareNextAccount');
        },
        async findCurrentEmailRecord() {
          calls.push('findCurrentEmailRecord');
        },
        async refreshOauthFromVps() {
          calls.push('refreshOauthFromVps');
        },
        async openOauthUrl() {
          calls.push('openOauthUrl');
        },
        async executeSignupStep(step) {
          calls.push(`executeSignupStep:${step}`);
          if (step === 8) {
            throw new Error('consent click failed');
          }
        },
        async executeFinalVerifyStep() {
          calls.push('executeFinalVerifyStep');
        },
        async pollVerificationCode(phase) {
          calls.push(`pollVerificationCode:${phase}`);
          return { code: '123456' };
        },
        async fillLastCode(phase) {
          calls.push(`fillLastCode:${phase}`);
        },
        async completeCurrentAccount() {
          calls.push('completeCurrentAccount');
        },
        async addLog(message) {
          calls.push(`log:${message}`);
        },
      },
    }),
    /consent click failed/
  );

  assert.equal(calls.includes('completeCurrentAccount'), false);
});

test('runSingleAutoFlow does not mark account completed when final verify fails', async () => {
  const calls = [];

  await assert.rejects(
    () => runSingleAutoFlow({
      autoImport: false,
      actions: {
        async prepareNextAccount() { calls.push('prepareNextAccount'); },
        async findCurrentEmailRecord() { calls.push('findCurrentEmailRecord'); },
        async refreshOauthFromVps() { calls.push('refreshOauthFromVps'); },
        async openOauthUrl() { calls.push('openOauthUrl'); },
        async executeSignupStep(step) { calls.push(`executeSignupStep:${step}`); },
        async executeFinalVerifyStep() {
          calls.push('executeFinalVerifyStep');
          throw new Error('verify failed');
        },
        async pollVerificationCode(phase) {
          calls.push(`pollVerificationCode:${phase}`);
          return { code: '123456' };
        },
        async fillLastCode(phase) { calls.push(`fillLastCode:${phase}`); },
        async completeCurrentAccount() { calls.push('completeCurrentAccount'); },
        async addLog(message) { calls.push(`log:${message}`); },
      },
    }),
    /verify failed/
  );

  assert.equal(calls.includes('completeCurrentAccount'), false);
});
