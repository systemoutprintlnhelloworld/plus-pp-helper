import test from 'node:test';
import assert from 'node:assert/strict';

import { pollVerificationCodeWithResend } from '../shared/verification-recovery.js';

test('pollVerificationCodeWithResend retries by requesting resend after a failed poll round', async () => {
  const calls = [];
  let round = 0;

  const result = await pollVerificationCodeWithResend({
    step: 4,
    maxRounds: 2,
    addLog: async (message, level) => {
      calls.push(`log:${level}:${message}`);
    },
    resendVerificationCode: async (step) => {
      calls.push(`resend:${step}`);
      return '2026-04-12T20:00:00.000Z';
    },
    pollVerificationCode: async ({ minReceivedAt }) => {
      round += 1;
      calls.push(`poll:${round}:${minReceivedAt || ''}`);
      if (round === 1) {
        throw new Error('轮询超时');
      }
      return { code: '123456', receivedAt: '2026-04-12T20:00:01.000Z' };
    },
  });

  assert.equal(result.code, '123456');
  assert.deepEqual(calls, [
    'log:info:步骤 4：开始第 1/2 轮验证码轮询。',
    'poll:1:',
    'log:warn:步骤 4：轮询超时',
    'log:warn:步骤 4：将重新发送验证码后重试（2/2）...',
    'resend:4',
    'log:warn:步骤 4：已请求新的验证码，准备进入第 2 轮轮询。',
    'log:info:步骤 4：开始第 2/2 轮验证码轮询。',
    'poll:2:2026-04-12T20:00:00.000Z',
  ]);
});
