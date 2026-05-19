import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('step9 runtime helper attaches getStep9StatusOutcome onto global scope', () => {
  const code = readFileSync(new URL('../shared/step9-status-runtime.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    globalThis: {},
  });

  vm.runInContext(code, context);

  assert.equal(typeof context.globalThis.HotmailRegisterStep9Status?.getStep9StatusOutcome, 'function');
  const result = context.globalThis.HotmailRegisterStep9Status.getStep9StatusOutcome({
    texts: ['Authentication successful'],
    now: 1000,
  });

  assert.equal(result.kind, 'success');
  assert.equal(result.text, 'Authentication successful');
});
