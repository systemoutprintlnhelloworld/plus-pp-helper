import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_RUN_USERSCRIPT_OPENED_KEY,
  FIRST_RUN_USERSCRIPT_URL,
  openFirstRunUserscriptOnce,
} from '../shared/first-run-userscript.js';

function createFakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(key) {
      return { [key]: store[key] };
    },
    async set(values) {
      Object.assign(store, values);
    },
  };
}

test('openFirstRunUserscriptOnce opens the raw gist once and stores the marker', async () => {
  const storageArea = createFakeStorage();
  const createdTabs = [];

  const result = await openFirstRunUserscriptOnce({
    storageArea,
    tabsApi: {
      async create(tab) {
        createdTabs.push(tab);
        return { id: 1, ...tab };
      },
    },
    now: () => '2026-05-20T00:00:00.000Z',
  });

  assert.deepEqual(createdTabs, [{ url: FIRST_RUN_USERSCRIPT_URL, active: true }]);
  assert.deepEqual(result, {
    opened: true,
    openedAt: '2026-05-20T00:00:00.000Z',
    url: FIRST_RUN_USERSCRIPT_URL,
  });
  assert.equal(storageArea.store[FIRST_RUN_USERSCRIPT_OPENED_KEY], '2026-05-20T00:00:00.000Z');
});

test('openFirstRunUserscriptOnce does not reopen after the marker exists', async () => {
  const storageArea = createFakeStorage({
    [FIRST_RUN_USERSCRIPT_OPENED_KEY]: '2026-05-20T00:00:00.000Z',
  });
  let createCalls = 0;

  const result = await openFirstRunUserscriptOnce({
    storageArea,
    tabsApi: {
      async create() {
        createCalls += 1;
      },
    },
  });

  assert.deepEqual(result, { opened: false, reason: 'already_opened' });
  assert.equal(createCalls, 0);
});

test('openFirstRunUserscriptOnce does not write the marker when the tab fails to open', async () => {
  const storageArea = createFakeStorage();

  await assert.rejects(
    () => openFirstRunUserscriptOnce({
      storageArea,
      tabsApi: {
        async create() {
          throw new Error('tab create failed');
        },
      },
    }),
    /tab create failed/
  );

  assert.equal(storageArea.store[FIRST_RUN_USERSCRIPT_OPENED_KEY], undefined);
});
