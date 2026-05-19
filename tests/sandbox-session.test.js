import test from 'node:test';
import assert from 'node:assert/strict';

import { isForbiddenOpenAITarget, validateSandboxSessionEndpoint } from '../shared/sandbox-session.js';

test('validateSandboxSessionEndpoint allows loopback session endpoints', () => {
  const result = validateSandboxSessionEndpoint('http://localhost:5000/api/auth/session');

  assert.equal(result, 'http://localhost:5000/api/auth/session');
});

test('validateSandboxSessionEndpoint allows the configured sandbox host', () => {
  const result = validateSandboxSessionEndpoint('https://challenge.example/api/auth/session', {
    allowedBaseUrls: ['https://challenge.example/auth/login'],
  });

  assert.equal(result, 'https://challenge.example/api/auth/session');
});

test('validateSandboxSessionEndpoint rejects real ChatGPT and OpenAI hosts', () => {
  assert.throws(
    () => validateSandboxSessionEndpoint('https://chatgpt.com/api/auth/session', {
      allowedBaseUrls: ['https://chatgpt.com/auth/login'],
    }),
    /拒绝读取真实 ChatGPT\/OpenAI session endpoint/
  );

  assert.equal(isForbiddenOpenAITarget('https://auth.openai.com/u/login'), true);
});

test('validateSandboxSessionEndpoint rejects unrelated non-loopback hosts when allowlist exists', () => {
  assert.throws(
    () => validateSandboxSessionEndpoint('https://other.example/api/auth/session', {
      allowedBaseUrls: ['https://challenge.example/auth/login'],
    }),
    /不在当前 sandbox allowlist/
  );
});

test('validateSandboxSessionEndpoint can relax allowlist checks for non-forbidden sandbox hosts', () => {
  const result = validateSandboxSessionEndpoint('https://other.example/api/auth/session', {
    allowedBaseUrls: ['https://challenge.example/auth/login'],
    enforceAllowlist: false,
  });

  assert.equal(result, 'https://other.example/api/auth/session');
});

test('validateSandboxSessionEndpoint still rejects real ChatGPT hosts when allowlist checks are relaxed', () => {
  assert.throws(
    () => validateSandboxSessionEndpoint('https://chatgpt.com/api/auth/session', {
      enforceAllowlist: false,
    }),
    /拒绝读取真实 ChatGPT\/OpenAI session endpoint/
  );
});
