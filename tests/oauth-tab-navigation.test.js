import test from 'node:test';
import assert from 'node:assert/strict';

import { decideOauthTabNavigation } from '../shared/oauth-tab-navigation.js';

test('decideOauthTabNavigation forces reload when target url matches current tab url', () => {
  const plan = decideOauthTabNavigation({
    currentTab: { id: 9, url: 'https://auth.openai.com/oauth?x=1' },
    targetUrl: 'https://auth.openai.com/oauth?x=1',
  });

  assert.deepEqual(plan, {
    action: 'reload',
    tabId: 9,
    url: 'https://auth.openai.com/oauth?x=1',
  });
});

test('decideOauthTabNavigation updates tab when target url is different', () => {
  const plan = decideOauthTabNavigation({
    currentTab: { id: 9, url: 'https://auth.openai.com/old' },
    targetUrl: 'https://auth.openai.com/new',
  });

  assert.deepEqual(plan, {
    action: 'update',
    tabId: 9,
    url: 'https://auth.openai.com/new',
  });
});

