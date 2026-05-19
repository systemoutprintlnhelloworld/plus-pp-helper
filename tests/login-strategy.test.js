import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseStep6LoginPath } from '../shared/login-strategy.js';

test('chooseStep6LoginPath prefers profile completion when profile page is visible', () => {
  const result = chooseStep6LoginPath({
    hasProfileSetupPage: true,
    hasOneTimeCodeTrigger: true,
    hasPasswordInput: true,
  });

  assert.equal(result, 'profile');
});

test('chooseStep6LoginPath prefers one-time code before password', () => {
  const result = chooseStep6LoginPath({
    hasProfileSetupPage: false,
    hasOneTimeCodeTrigger: true,
    hasPasswordInput: true,
    hasVerificationPage: false,
    hasConsentPage: false,
  });

  assert.equal(result, 'one_time_code');
});

test('chooseStep6LoginPath falls back to password when one-time code trigger is absent', () => {
  const result = chooseStep6LoginPath({
    hasProfileSetupPage: false,
    hasOneTimeCodeTrigger: false,
    hasPasswordInput: true,
    hasVerificationPage: false,
    hasConsentPage: false,
  });

  assert.equal(result, 'password');
});

