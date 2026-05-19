import test from 'node:test';
import assert from 'node:assert/strict';

import { pollVerificationCode } from '../shared/verification-poller.js';

test('pollVerificationCode extracts code from external email preview', async () => {
  let polled = 0;
  const logs = [];

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails(email) {
        polled += 1;
        assert.equal(email, 'user@hotmail.com');
        if (polled < 2) {
          return { emails: [] };
        }
        return {
          resolvedEmail: 'user@hotmail.com',
          matchedAlias: '',
          emails: [
            {
              messageId: 'm1',
              subject: 'OpenAI verification code',
              bodyText: 'Your code is 482910',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:00:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 80,
    addLog: async (message) => {
      logs.push(message);
    },
    step: 4,
    round: 1,
    maxRounds: 2,
    phaseLabel: '注册验证码',
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '482910');
  assert.equal(result.mail.messageId, 'm1');
  assert.equal(logs.some((message) => message.includes('第 1/2 轮第 1 次检查暂未发现匹配的注册验证码邮件')), true);
  assert.equal(logs.some((message) => message.includes('发现新注册验证码邮件，正在提取验证码')), true);
});

test('pollVerificationCode fails when email is missing', async () => {
  await assert.rejects(
    () => pollVerificationCode({
      client: {
        async listUserEmailMails() {
          return { emails: [] };
        },
      },
      timeoutMs: 10,
    }),
    /缺少邮箱地址/
  );
});

test('pollVerificationCode respects sender and keyword filters', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          emails: [
            {
              messageId: 'm1',
              subject: 'Spam code',
              bodyText: '111111',
              from: 'spam@example.com',
              receivedAt: '2026-04-12T18:00:00Z',
            },
            {
              messageId: 'm2',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 222222',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:01:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 20,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '222222');
  assert.equal(result.mail.messageId, 'm2');
});

test('pollVerificationCode falls back to the latest matching older mail when no fresh mail arrives', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm1',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 333444',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T17:59:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 5,
    minReceivedAt: '2026-04-12T18:00:00Z',
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '333444');
  assert.equal(result.mail.messageId, 'm1');
  assert.equal(result.usedOlderMatch, true);
});

test('pollVerificationCode accepts a recent matching mail slightly earlier than minReceivedAt', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm2',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 444555',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T17:59:55Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 20,
    minReceivedAt: '2026-04-12T18:00:00Z',
    freshnessGraceMs: 10000,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '444555');
  assert.equal(result.mail.messageId, 'm2');
  assert.equal(result.usedOlderMatch, false);
});

test('pollVerificationCode fetches message detail when preview does not contain the code', async () => {
  let detailRequested = 0;

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm9',
              subject: 'OpenAI verification code',
              bodyText: 'Click to continue',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:02:00Z',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        detailRequested += 1;
        assert.equal(email, 'user@hotmail.com');
        assert.equal(messageId, 'm9');
        assert.equal(options.folder, 'inbox');
        return {
          body: '<div>Your code is <b>555666</b></div>',
          bodyText: 'Your code is 555666',
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(detailRequested, 1);
  assert.equal(result.code, '555666');
  assert.equal(result.mail.messageId, 'm9');
  assert.equal(result.extractedFromDetail, true);
});

test('pollVerificationCode can extract code from detail when keyword exists only in full body', async () => {
  let detailRequested = 0;

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm10',
              subject: 'Your temporary OpenAI login code',
              bodyText: '<html><head><title>Your temporary OpenAI login code</title></head><body>preview truncated</body></html>',
              from: 'noreply@tm.openai.com',
              receivedAt: '2026-04-13T09:43:42Z',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        detailRequested += 1;
        assert.equal(email, 'user@hotmail.com');
        assert.equal(messageId, 'm10');
        assert.equal(options.folder, 'inbox');
        return {
          subject: 'Your temporary OpenAI login code',
          body: '<div>Enter this temporary verification code to continue: <b>060907</b></div>',
          bodyText: 'Enter this temporary verification code to continue: 060907',
          from: 'noreply@tm.openai.com',
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      fromIncludes: 'tm.openai.com',
      keyword: 'verification',
      subjectContains: '',
    },
  });

  assert.equal(detailRequested, 1);
  assert.equal(result.code, '060907');
  assert.equal(result.mail.messageId, 'm10');
  assert.equal(result.extractedFromDetail, true);
});

test('pollVerificationCode decodes quoted-printable detail body and forwards id mode', async () => {
  let requestedOptions = null;

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'AmyDurhamwjr@outlook.com',
          emails: [
            {
              messageId: '21',
              idMode: 'sequence',
              subject: 'Your temporary ChatGPT verification code',
              bodyText: '<html><head><title>Your temporary ChatGPT verification code</title><meta name="viewport" content="width=device-width, i...',
              from: 'ChatGPT <noreply@tm.openai.com>',
              receivedAt: '19-May-2026 22:04:56 +0800',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        assert.equal(email, 'AmyDurhamwjr@outlook.com');
        assert.equal(messageId, '21');
        requestedOptions = options;
        return {
          subject: 'Your temporary ChatGPT verification code',
          from: 'ChatGPT <noreply@tm.openai.com>',
          body: '<p>Enter this temporary verification code to continue:</p><p style=3D"font-family: Menlo;">494136</p>',
        };
      },
    },
    email: 'amydurhamwjr@outlook.com',
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      keyword: 'ChatGPT',
    },
  });

  assert.equal(requestedOptions.folder, 'inbox');
  assert.equal(requestedOptions.idMode, 'sequence');
  assert.equal(result.code, '494136');
  assert.equal(result.extractedFromDetail, true);
});

test('pollVerificationCode extracts code from noisy OpenAI-style HTML body', async () => {
  const noisyHtml = `
    <td style="padding: 0 16px;height: 100% !important;" align="center">
      <div style="background-color: #ffffff;color:#202123; padding: 56px 0 32px 0;" class="top">
        <img style="height:36px;width:auto;" alt="OpenAI" height="168" width="560" src="https://cdn.openai.com/API/logo-assets/openai-logo-email-header-2.png">
      </div>
      <p>Enter this temporary verification code to continue:</p>
      <p style="font-family: Menlo; font-size: 24px; line-height: 28px; padding: 28px 24px; margin: 24px 0;">
        547003
      </p>
      <p>Please ignore this email if this wasn't you trying to create a ChatGPT account.</p>
      <a href="https://u20216706.ct.sendgrid.net/ls/click?upn=u001.1234567890-2BK7JhymNusRMtxuwNyiH8tHYK">ChatGPT</a>
    </td>
  `;

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          emails: [
            {
              messageId: 'm-html',
              subject: 'Your temporary OpenAI login code',
              bodyHtml: noisyHtml,
              from: 'noreply@tm.openai.com',
              receivedAt: '2026-05-19T10:00:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      keyword: 'OpenAI',
    },
  });

  assert.equal(result.code, '547003');
});

test('pollVerificationCode logs mail snapshot when a new mail has no extractable code', async () => {
  const logs = [];

  await assert.rejects(
    () => pollVerificationCode({
      client: {
        async listUserEmailMails() {
          return {
            emails: [
              {
                messageId: 'm-no-code',
                subject: 'OpenAI verification code',
                bodyHtml: '<img width="600000" height="123456" src="https://u20216706.ct.sendgrid.net/ls/click?x=987654"><p>ChatGPT</p>',
                from: 'noreply@tm.openai.com',
                receivedAt: '2026-05-19T10:01:00Z',
              },
            ],
          };
        },
      },
      email: 'user@hotmail.com',
      intervalMs: 1,
      timeoutMs: 1,
      addLog: async (message) => {
        logs.push(message);
      },
      step: 4,
      phaseLabel: '注册验证码',
      match: {
        keyword: 'OpenAI',
      },
    }),
    /轮询超时/
  );

  const debugLog = logs.find((message) => message.includes('邮件调试快照'));
  assert.ok(debugLog);
  assert.match(debugLog, /messageId：m-no-code/);
  assert.match(debugLog, /600000/);
  assert.match(debugLog, /123456/);
});

test('pollVerificationCode forwards temp mailbox context to list and detail fetchers', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails(email, options = {}) {
        assert.equal(email, 'temp@cstea.shop');
        assert.equal(options.isTemp, true);
        return {
          resolvedEmail: 'temp@cstea.shop',
          emails: [
            {
              messageId: 'tm1',
              subject: 'OpenAI verification code',
              bodyText: 'Open mail body',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:02:00Z',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        assert.equal(email, 'temp@cstea.shop');
        assert.equal(messageId, 'tm1');
        assert.equal(options.folder, 'inbox');
        assert.equal(options.isTemp, true);
        return {
          bodyText: 'Your code is 667788',
        };
      },
    },
    email: 'temp@cstea.shop',
    mailboxContext: {
      isTemp: true,
    },
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '667788');
});

test('pollVerificationCode times out with readable message', async () => {
  await assert.rejects(
    () => pollVerificationCode({
      client: {
        async listUserEmailMails() {
          return { emails: [] };
        },
      },
      email: 'user@hotmail.com',
      intervalMs: 1,
      timeoutMs: 10,
    }),
    /轮询超时/
  );
});

test('pollVerificationCode skips read and consumed mails when configured', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm1',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 111111',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-13T09:40:00Z',
              isRead: true,
            },
            {
              messageId: 'm2',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 222222',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-13T09:41:00Z',
              isRead: false,
            },
            {
              messageId: 'm3',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 333333',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-13T09:42:00Z',
              isRead: false,
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 10,
    unreadOnly: true,
    consumedMessageIds: ['m3'],
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
    },
  });

  assert.equal(result.code, '222222');
  assert.equal(result.mail.messageId, 'm2');
});
