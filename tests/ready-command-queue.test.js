import test from 'node:test';
import assert from 'node:assert/strict';

import { createReadyCommandQueue } from '../shared/ready-command-queue.js';

test('ready command queue flushes queued command once source becomes ready', async () => {
  const queue = createReadyCommandQueue();
  const sent = [];

  queue.markPending('vps-panel', 11);
  const resultPromise = queue.queueCommand('vps-panel', { type: 'EXECUTE_STEP', step: 1 }, 2000);

  assert.equal(queue.isReady('vps-panel'), false);

  const flushPromise = queue.flushReadyCommand('vps-panel', async (message) => {
    sent.push(message);
    return { ok: true, oauthUrl: 'https://auth.openai.com/x' };
  });

  const [flushResult, queuedResult] = await Promise.all([flushPromise, resultPromise]);

  assert.deepEqual(sent, [{ type: 'EXECUTE_STEP', step: 1 }]);
  assert.deepEqual(flushResult, { ok: true, oauthUrl: 'https://auth.openai.com/x' });
  assert.deepEqual(queuedResult, { ok: true, oauthUrl: 'https://auth.openai.com/x' });
  assert.equal(queue.isReady('vps-panel'), true);
});

test('ready command queue returns null when nothing is queued', async () => {
  const queue = createReadyCommandQueue();
  queue.markPending('vps-panel', 11);

  const result = await queue.flushReadyCommand('vps-panel', async () => ({ ok: true }));
  assert.equal(result, null);
  assert.equal(queue.isReady('vps-panel'), true);
});

test('ready command queue can verify readiness for a specific tab', async () => {
  const queue = createReadyCommandQueue();
  queue.markReady('vps-panel', 11);

  assert.equal(queue.isReadyForTab('vps-panel', 11), true);
  assert.equal(queue.isReadyForTab('vps-panel', 12), false);
});
