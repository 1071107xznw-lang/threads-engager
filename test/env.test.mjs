import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, parseDryRun } from '../src/env.mjs';

test('loadSettings 缺必填拋錯', () => {
  assert.throws(() => loadSettings({ THREADS_USER_ID: '1' }), /THREADS_ACCESS_TOKEN/);
});

test('loadSettings 回傳解析後設定', () => {
  const s = loadSettings({
    THREADS_USER_ID: 'u',
    THREADS_ACCESS_TOKEN: 't',
    THREADS_APP_SECRET: 's',
    DRY_RUN: '1',
  });
  assert.equal(s.userId, 'u');
  assert.equal(s.accessToken, 't');
  assert.equal(s.appSecret, 's');
  assert.equal(s.dryRun, true);
  assert.equal(s.apiBase, 'https://graph.threads.net');
});

test('parseDryRun 解析各種值', () => {
  for (const v of ['1', 'true', 'YES', 'on']) assert.equal(parseDryRun(v), true);
  for (const v of ['0', 'false', 'no', '', undefined, null]) assert.equal(parseDryRun(v), false);
});
