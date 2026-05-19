import test from 'node:test';
import assert from 'node:assert/strict';

import { setButtonBusyState } from '../shared/button-busy-state.js';

function createMockButton(text = '复制') {
  const classes = new Set();
  return {
    textContent: text,
    disabled: false,
    dataset: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
}

test('setButtonBusyState restores button text and clickability after busy state', () => {
  const button = createMockButton();

  setButtonBusyState(button, true, '复制中...');

  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '复制中...');
  assert.equal(button.dataset.busy, '1');
  assert.equal(button.classList.contains('is-busy'), true);

  setButtonBusyState(button, false);

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '复制');
  assert.equal(button.dataset.busy, '0');
  assert.equal(button.classList.contains('is-busy'), false);
});
