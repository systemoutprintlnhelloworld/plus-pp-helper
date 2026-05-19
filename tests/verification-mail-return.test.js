import test from 'node:test';
import assert from 'node:assert/strict';

import { getMailReturnBehaviorAfterResend } from '../shared/verification-mail-return.js';

test('getMailReturnBehaviorAfterResend chooses navigate mode when mail uses navigateOnReuse', () => {
  const result = getMailReturnBehaviorAfterResend({
    navigateOnReuse: true,
    reloadIfSameUrl: true,
  });

  assert.deepEqual(result, {
    mode: 'navigate',
    reloadIfSameUrl: true,
  });
});

test('getMailReturnBehaviorAfterResend chooses activate mode by default', () => {
  const result = getMailReturnBehaviorAfterResend({});

  assert.deepEqual(result, {
    mode: 'activate',
    reloadIfSameUrl: false,
  });
});
