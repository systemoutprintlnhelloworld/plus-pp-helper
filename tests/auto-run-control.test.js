import test from 'node:test';
import assert from 'node:assert/strict';

import { createAutoRunPausedError, isAutoRunPausedError } from '../shared/auto-run-control.js';

test('createAutoRunPausedError marks the error for auto-run pause handling', () => {
  const error = createAutoRunPausedError('paused by user');

  assert.equal(error.message, 'paused by user');
  assert.equal(error.code, 'AUTO_RUN_PAUSED');
  assert.equal(isAutoRunPausedError(error), true);
  assert.equal(isAutoRunPausedError(new Error('other')), false);
});

