import test from 'node:test';
import assert from 'node:assert/strict';

import { isMissingReceiverError } from '../shared/runtime-message-errors.js';

test('isMissingReceiverError matches async response channel closed errors during page transitions', () => {
  const error = new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');

  assert.equal(isMissingReceiverError(error), true);
});

test('isMissingReceiverError matches classic missing receiver errors', () => {
  const error = new Error('Could not establish connection. Receiving end does not exist.');

  assert.equal(isMissingReceiverError(error), true);
});

test('isMissingReceiverError ignores real business errors', () => {
  const error = new Error('步骤 2：未找到注册入口，无法进入注册流程');

  assert.equal(isMissingReceiverError(error), false);
});
