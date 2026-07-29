import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { resolveSettings } from '../src/env.mjs';

test('都缺 → setupComplete:false，dryRun 預設 true', () => {
  const store = createStore(':memory:');
  const s = resolveSettings({ store, env: {} });
  assert.equal(s.setupComplete, false);
  assert.equal(s.dryRun, true);
  store.close();
});

test('只有 .env → 用 env，setupComplete:true', () => {
  const store = createStore(':memory:');
  const env = { THREADS_APP_SECRET: 'sec', THREADS_USER_ID: 'u1', THREADS_ACCESS_TOKEN: 'tok', DRY_RUN: '0' };
  const s = resolveSettings({ store, env });
  assert.equal(s.setupComplete, true);
  assert.equal(s.appSecret, 'sec');
  assert.equal(s.userId, 'u1');
  assert.equal(s.dryRun, false);
  store.close();
});

test('DB 憑證優先於 env；有 DB 長期 token 時不需 env token', () => {
  const store = createStore(':memory:');
  store.setSetting('appSecret', 'dbsec');
  store.setSetting('userId', 'dbuser');
  store.setToken('longtok', null);
  const env = { THREADS_APP_SECRET: 'envsec', THREADS_USER_ID: 'envuser' };
  const s = resolveSettings({ store, env });
  assert.equal(s.setupComplete, true);
  assert.equal(s.appSecret, 'dbsec'); // DB 優先
  assert.equal(s.userId, 'dbuser');
  store.close();
});

test('dryRun：DB 設定優先於 env', () => {
  const store = createStore(':memory:');
  store.setSetting('dryRun', '0');
  const s = resolveSettings({ store, env: { DRY_RUN: '1' } });
  assert.equal(s.dryRun, false); // DB 的 0 勝
  store.close();
});
