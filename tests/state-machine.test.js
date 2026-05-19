import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSettings } from '../shared/state-machine.js';

test('sanitizeSettings preserves persisted settings beyond basic text fields', () => {
  const result = sanitizeSettings({
    apiKey: ' key ',
    mailApiBaseUrl: ' http://localhost:5000 ',
    mailUiPassword: ' admini123 ',
    loginPageUrl: ' http://localhost:5000/auth/login ',
    sessionEndpointUrl: ' http://localhost:5000/api/auth/session ',
    sessionProtectionEnabled: false,
    sessionProtectionDisablePassword: ' CTF-SANDBOX ',
    profileFullName: ' nicai ',
    profileAge: '25',
    defaultLoginPassword: ' openai-pass ',
    usedAccounts: {
      'user@hotmail.com': { status: 'completed' },
    },
    runCount: 3,
    skipFailedAccounts: true,
    mailKeyword: 'OpenAI',
    mailFromKeyword: 'noreply@openai.com',
    recordSuccessResults: true,
    successResults: [{ address: 'user@hotmail.com' }],
  });

  assert.equal(result.apiKey, 'key');
  assert.equal(result.mailApiBaseUrl, 'http://localhost:5000');
  assert.equal(result.mailUiPassword, 'admini123');
  assert.equal(result.loginPageUrl, 'http://localhost:5000/auth/login');
  assert.equal(result.sessionEndpointUrl, 'http://localhost:5000/api/auth/session');
  assert.equal(result.sessionProtectionEnabled, false);
  assert.equal(result.sessionProtectionDisablePassword, ' CTF-SANDBOX ');
  assert.equal(result.profileFullName, 'nicai');
  assert.equal(result.profileAge, '25');
  assert.equal(result.defaultLoginPassword, 'openai-pass');
  assert.deepEqual(result.usedAccounts, {
    'user@hotmail.com': { status: 'completed' },
  });
  assert.equal(result.runCount, 3);
  assert.equal(result.skipFailedAccounts, true);
  assert.equal(result.mailKeyword, 'OpenAI');
  assert.equal(result.mailFromKeyword, 'noreply@openai.com');
  assert.equal(result.recordSuccessResults, true);
  assert.deepEqual(result.successResults, [{ address: 'user@hotmail.com' }]);
});
