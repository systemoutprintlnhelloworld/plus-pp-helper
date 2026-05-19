import test from 'node:test';
import assert from 'node:assert/strict';

import { getLogAreaScrollTop, isScrollNearBottom } from '../shared/log-scroll.js';

test('isScrollNearBottom returns true when viewport is already at the bottom', () => {
  assert.equal(isScrollNearBottom({
    scrollTop: 180,
    scrollHeight: 400,
    clientHeight: 220,
  }), true);
});

test('isScrollNearBottom returns false when user has scrolled away from the bottom', () => {
  assert.equal(isScrollNearBottom({
    scrollTop: 60,
    scrollHeight: 400,
    clientHeight: 220,
  }), false);
});

test('getLogAreaScrollTop keeps sticky logs pinned to the bottom', () => {
  assert.equal(getLogAreaScrollTop({
    preserveScrollTop: 80,
    nextScrollHeight: 520,
    stickToBottom: true,
  }), 520);
});

test('getLogAreaScrollTop preserves manual scroll position when user is reviewing history', () => {
  assert.equal(getLogAreaScrollTop({
    preserveScrollTop: 80,
    nextScrollHeight: 520,
    stickToBottom: false,
  }), 80);
});
