import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearPendingSignupStepForTab,
  getPendingSignupStepForTab,
  setPendingSignupStepForTab,
} from '../shared/pending-signup-step-store.js';

test('setPendingSignupStepForTab stores payload by tab id', () => {
  const store = setPendingSignupStepForTab({}, 42, {
    step: 2,
    startedAt: 1000,
    payload: { address: 'user@hotmail.com' },
  });

  assert.deepEqual(getPendingSignupStepForTab(store, 42, { now: 1500, ttlMs: 10000 }), {
    step: 2,
    startedAt: 1000,
    payload: { address: 'user@hotmail.com' },
  });
});

test('getPendingSignupStepForTab ignores stale entries', () => {
  const store = setPendingSignupStepForTab({}, 42, {
    step: 3,
    startedAt: 1000,
    payload: { address: 'stale@hotmail.com' },
  });

  assert.equal(getPendingSignupStepForTab(store, 42, { now: 20000, ttlMs: 5000 }), null);
});

test('clearPendingSignupStepForTab removes only the target tab entry', () => {
  const seeded = {
    ...setPendingSignupStepForTab({}, 42, { step: 2, startedAt: 1000 }),
    ...setPendingSignupStepForTab({}, 99, { step: 3, startedAt: 1000 }),
  };

  const store = clearPendingSignupStepForTab(seeded, 42);

  assert.equal(getPendingSignupStepForTab(store, 42, { now: 1200, ttlMs: 5000 }), null);
  assert.deepEqual(getPendingSignupStepForTab(store, 99, { now: 1200, ttlMs: 5000 }), {
    step: 3,
    startedAt: 1000,
  });
});
