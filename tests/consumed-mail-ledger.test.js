import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConsumedMessageIds,
  markVerificationMailConsumed,
} from '../shared/consumed-mail-ledger.js';

test('markVerificationMailConsumed stores lightweight records and prunes old entries', () => {
  const ledger = markVerificationMailConsumed({
    'user@hotmail.com': [
      { messageId: 'old', usedAt: '2026-04-01T00:00:00.000Z' },
      { messageId: 'keep', usedAt: '2026-04-13T00:00:00.000Z' },
    ],
  }, {
    email: 'user@hotmail.com',
    messageId: 'new',
    usedAt: '2026-04-13T09:45:00.000Z',
    now: '2026-04-13T10:00:00.000Z',
    ttlMs: 3 * 24 * 60 * 60 * 1000,
    maxPerEmail: 2,
  });

  assert.deepEqual(ledger, {
    'user@hotmail.com': [
      { messageId: 'new', usedAt: '2026-04-13T09:45:00.000Z' },
      { messageId: 'keep', usedAt: '2026-04-13T00:00:00.000Z' },
    ],
  });
});

test('getConsumedMessageIds merges ids across related email keys', () => {
  const ids = getConsumedMessageIds({
    'user@hotmail.com': [
      { messageId: 'm1', usedAt: '2026-04-13T09:45:00.000Z' },
    ],
    'alias@example.com': [
      { messageId: 'm2', usedAt: '2026-04-13T09:46:00.000Z' },
    ],
  }, [
    'user@hotmail.com',
    'alias@example.com',
    'missing@example.com',
  ], {
    now: '2026-04-13T10:00:00.000Z',
  });

  assert.deepEqual(ids, ['m1', 'm2']);
});
