import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { refreshIfNeeded, getActiveToken } from '../src/threads_token.mjs';

const DAY = 24 * 3600 * 1000;
const settings = {
  userId: '1',
  accessToken: 'envtok',
  appSecret: 's',
  apiBase: 'https://graph.threads.net',
  dryRun: false,
};

const memStore = () => createStore(':memory:');

test('DB 空時 fallback 到 env token 並寫入 DB', () => {
  const store = memStore();
  const row = getActiveToken({ store, settings });
  assert.equal(row.accessToken, 'envtok');
  assert.ok(store.getToken());
  store.close();
});

test('剩餘 <10 天且 ≥24h → refresh 並寫回', async () => {
  const store = memStore();
  const now = Date.now();
  store.setToken('dbtok', new Date(now + 5 * DAY).toISOString(), new Date(now - 2 * DAY).toISOString());
  const api = {
    refreshLongLivedToken: async ({ accessToken }) => {
      assert.equal(accessToken, 'dbtok');
      return { access_token: 'fresh', expires_in: 60 * 24 * 3600 };
    },
  };
  const res = await refreshIfNeeded({ store, settings, api, now, log: () => {} });
  assert.equal(res.refreshed, true);
  assert.equal(store.getToken().accessToken, 'fresh');
  store.close();
});

test('仍新鮮（剩餘 40 天）→ 不 refresh', async () => {
  const store = memStore();
  const now = Date.now();
  store.setToken('dbtok', new Date(now + 40 * DAY).toISOString(), new Date(now - 2 * DAY).toISOString());
  let called = false;
  const api = { refreshLongLivedToken: async () => { called = true; return {}; } };
  const res = await refreshIfNeeded({ store, settings, api, now, log: () => {} });
  assert.equal(res.refreshed, false);
  assert.equal(res.reason, 'fresh');
  assert.equal(called, false);
  store.close();
});

test('近到期但 token <24h → 不 refresh（too_young）', async () => {
  const store = memStore();
  const now = Date.now();
  store.setToken('dbtok', new Date(now + 2 * DAY).toISOString(), new Date(now - 3600 * 1000).toISOString());
  let called = false;
  const api = { refreshLongLivedToken: async () => { called = true; return {}; } };
  const res = await refreshIfNeeded({ store, settings, api, now, log: () => {} });
  assert.equal(res.refreshed, false);
  assert.equal(res.reason, 'too_young');
  assert.equal(called, false);
  store.close();
});

test('DRY_RUN → 需要但不實際 refresh', async () => {
  const store = memStore();
  const now = Date.now();
  store.setToken('dbtok', new Date(now + 2 * DAY).toISOString(), new Date(now - 2 * DAY).toISOString());
  let called = false;
  const api = { refreshLongLivedToken: async () => { called = true; return {}; } };
  const res = await refreshIfNeeded({ store, settings: { ...settings, dryRun: true }, api, now, log: () => {} });
  assert.equal(called, false);
  assert.equal(res.reason, 'dry_run');
  store.close();
});
