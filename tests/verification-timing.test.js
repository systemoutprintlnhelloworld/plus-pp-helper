import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getStep4FilterAfterTimestamp,
  getStep7FilterAfterTimestamp,
} from '../shared/verification-timing.js';

test('getStep4FilterAfterTimestamp prefers step3StartTime', () => {
  assert.equal(
    getStep4FilterAfterTimestamp({ step3StartTime: 200, flowStartTime: 100 }, 50),
    200
  );
});

test('getStep7FilterAfterTimestamp prefers step6StartTime then lastEmailTimestamp', () => {
  assert.equal(
    getStep7FilterAfterTimestamp({ step6StartTime: 300, lastEmailTimestamp: 200, flowStartTime: 100 }, 50),
    300
  );
  assert.equal(
    getStep7FilterAfterTimestamp({ lastEmailTimestamp: 200, flowStartTime: 100 }, 50),
    200
  );
});
