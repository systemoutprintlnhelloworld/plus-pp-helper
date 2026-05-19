import test from 'node:test';
import assert from 'node:assert/strict';

import { getAutoRunPrimaryControl, getAutoRunRestartLabel } from '../shared/auto-run-controls.js';

test('getAutoRunPrimaryControl returns continue when flow is paused', () => {
  assert.deepEqual(getAutoRunPrimaryControl({ autoPaused: true }), {
    label: '继续',
    action: 'continue',
  });
});

test('getAutoRunPrimaryControl returns continue when a step failed', () => {
  assert.deepEqual(getAutoRunPrimaryControl({
    stepStatuses: { 3: 'failed' },
  }), {
    label: '继续',
    action: 'continue',
  });
});

test('getAutoRunRestartLabel returns restart wording after pause or failure', () => {
  assert.equal(getAutoRunRestartLabel({ autoPaused: true }), '重新开始');
  assert.equal(getAutoRunRestartLabel({ stepStatuses: { 6: 'failed' } }), '重新开始');
  assert.equal(getAutoRunRestartLabel({ stepStatuses: {} }), '重启本轮');
});
