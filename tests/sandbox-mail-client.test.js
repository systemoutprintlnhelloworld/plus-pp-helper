import test from 'node:test';
import assert from 'node:assert/strict';

import { createSandboxMailClient } from '../shared/sandbox-mail-client.js';

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('createSandboxMailClient lists unregistered accounts from flexible payloads', async () => {
  const requests = [];
  const client = createSandboxMailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        accounts: [
          { email: 'fresh@example.test', tags: [] },
          { email: 'registered@example.test', tags: [{ name: '已注册' }] },
          { email: 'plus@example.test', tags: [{ name: 'plus' }] },
        ],
      });
    },
  });

  const accounts = await client.listAccounts();

  assert.deepEqual(accounts.map((account) => account.address), ['fresh@example.test']);
  assert.equal(requests[0].url, 'http://localhost:5000/api/external/accounts?status=unregistered');
  assert.equal(requests[0].options.headers['X-API-Key'], 'test-key');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[0].options.headers['Content-Type'], undefined);
});

test('createSandboxMailClient supports single email payloads', async () => {
  const client = createSandboxMailClient({
    apiKey: 'test-key',
    fetchImpl: async () => jsonResponse({ email: 'next@example.test' }),
  });

  const accounts = await client.listAccounts();

  assert.equal(accounts[0].address, 'next@example.test');
});

test('createSandboxMailClient normalizes message lists for verification polling', async () => {
  const client = createSandboxMailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url) => {
      if (url.includes('/api/external/emails?')) {
        return jsonResponse({
          messages: [
            {
              message_id: 'm1',
              subject: 'Verification',
              body_text: 'Your code is 123456',
              received_at: '2026-05-19T00:00:00Z',
            },
          ],
        });
      }
      return jsonResponse({ accounts: [] });
    },
  });

  const result = await client.listUserEmailMails('next@example.test');

  assert.equal(result.emails[0].messageId, 'm1');
  assert.equal(result.emails[0].bodyText, 'Your code is 123456');
});

test('createSandboxMailClient reads documented internal detail endpoint with cookies', async () => {
  const requests = [];
  const client = createSandboxMailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        success: true,
        email: {
          id: '21',
          subject: 'Your temporary ChatGPT verification code',
          from: 'ChatGPT <noreply@tm.openai.com>',
          body: '<p>Enter this temporary verification code to continue:</p><p>494136</p>',
          body_type: 'html',
        },
      });
    },
  });

  const detail = await client.getEmailDetail('AmyDurhamwjr@outlook.com', '21', {
    folder: 'inbox',
    idMode: 'sequence',
  });

  assert.equal(requests[0].url, 'http://localhost:5000/api/email/AmyDurhamwjr%40outlook.com/21?folder=inbox&method=imap');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(detail.body, '<p>Enter this temporary verification code to continue:</p><p>494136</p>');
});

test('createSandboxMailClient reports external API preview limitation on 401 detail response', async () => {
  const requests = [];
  const client = createSandboxMailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.includes('/api/email/')) {
        return new Response('<!doctype html><title>Unauthorized</title>', { status: 401 });
      }
      return new Response(JSON.stringify({ success: false, error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.getEmailDetail('AmyDurhamwjr@outlook.com', '21', {
      folder: 'inbox',
      idMode: 'sequence',
    }),
    /external API Key 只能读取邮件列表预览/
  );
  assert.deepEqual(requests, [
    'http://localhost:5000/api/email/AmyDurhamwjr%40outlook.com/21?folder=inbox&method=imap',
  ]);
});
