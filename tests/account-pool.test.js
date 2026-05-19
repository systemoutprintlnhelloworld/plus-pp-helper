import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAccountPool } from '../shared/account-pool.js';

test('parseAccountPool parses valid rows into normalized accounts', () => {
  const accounts = parseAccountPool(
    [
      'user1@hotmail.com----pass123----cid-1----rt-1',
      'user2@outlook.com----pass456----cid-2----rt-2',
    ].join('\n')
  );

  assert.deepEqual(accounts, [
    {
      address: 'user1@hotmail.com',
      password: 'pass123',
      clientId: 'cid-1',
      refreshToken: 'rt-1',
    },
    {
      address: 'user2@outlook.com',
      password: 'pass456',
      clientId: 'cid-2',
      refreshToken: 'rt-2',
    },
  ]);
});

test('parseAccountPool skips empty lines and surrounding whitespace', () => {
  const accounts = parseAccountPool('\n user1@hotmail.com----pass123----cid-1----rt-1 \n\n');

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].address, 'user1@hotmail.com');
});

test('parseAccountPool throws when a row does not have 4 fields', () => {
  assert.throws(
    () => parseAccountPool('user1@hotmail.com----pass123----cid-1'),
    /第 1 行格式错误/
  );
});
