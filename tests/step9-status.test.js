import test from 'node:test';
import assert from 'node:assert/strict';

import { getStep9StatusOutcome } from '../shared/step9-status.js';

test('getStep9StatusOutcome prefers success status', () => {
  assert.deepEqual(
    getStep9StatusOutcome({
      texts: ['Authentication successful'],
      now: 1000,
    }),
    { kind: 'success', text: 'Authentication successful' },
  );
});

test('getStep9StatusOutcome treats pending conflict as soft state before grace timeout', () => {
  assert.deepEqual(
    getStep9StatusOutcome({
      texts: ['oauth flow is not pending'],
      now: 5000,
      pendingConflictSeenAt: 1000,
      pendingConflictGraceMs: 10000,
    }),
    { kind: 'pending_conflict_wait', text: 'oauth flow is not pending' },
  );
});

test('getStep9StatusOutcome turns pending conflict into failure after grace timeout', () => {
  assert.deepEqual(
    getStep9StatusOutcome({
      texts: ['oauth flow is not pending'],
      now: 15000,
      pendingConflictSeenAt: 1000,
      pendingConflictGraceMs: 10000,
    }),
    { kind: 'pending_conflict_timeout', text: 'oauth flow is not pending' },
  );
});
