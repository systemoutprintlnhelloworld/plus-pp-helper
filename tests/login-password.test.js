import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLoginPassword } from '../shared/login-password.js';

test('resolveLoginPassword prefers default login password over account password', () => {
  const result = resolveLoginPassword({
    defaultLoginPassword: ' openai-pass ',
    accountPassword: 'hotmail-pass',
  });

  assert.equal(result, 'openai-pass');
});

test('resolveLoginPassword falls back to account password when default login password is empty', () => {
  const result = resolveLoginPassword({
    defaultLoginPassword: '   ',
    accountPassword: 'hotmail-pass',
  });

  assert.equal(result, 'hotmail-pass');
});

