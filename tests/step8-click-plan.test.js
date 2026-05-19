import test from 'node:test';
import assert from 'node:assert/strict';

import { decideStep8ClickPlan } from '../shared/step8-click-plan.js';

test('decideStep8ClickPlan prefers native click with debugger fallback when both are available', () => {
  assert.equal(decideStep8ClickPlan({
    nativeClicked: true,
    hasRect: true,
  }), 'native_then_debugger_fallback');
});

test('decideStep8ClickPlan falls back to debugger when native click was not attempted', () => {
  assert.equal(decideStep8ClickPlan({
    nativeClicked: false,
    hasRect: true,
  }), 'debugger_only');
});

test('decideStep8ClickPlan returns native only when no debugger rect is available', () => {
  assert.equal(decideStep8ClickPlan({
    nativeClicked: true,
    hasRect: false,
  }), 'native_only');
});
