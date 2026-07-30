import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { searchKeyword, gatherTagPosts, SearchQuotaError } from '../src/threads_search.mjs';

const DAY = 24 * 3600 * 1000;

function fakeApi(byQuery) {
  const calls = [];
  return {
    calls,
    async keywordSearch({ q }) { calls.push(q); return { data: byQuery[q] || [] }; },
  };
}

test('searchKeyword 計數並回傳 data', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({ 調酒: [{ id: '1', text: 'a', username: 'bob' }] });
  const now = new Date().toISOString();
  const r = await searchKeyword({ api, store, accessToken: 't', q: '調酒', cap: 400, nowIso: now });
  assert.equal(r.length, 1);
  assert.equal(store.countSearches7d(now), 1);
  store.close();
});

test('達額度上限時拋 SearchQuotaError 且不呼叫 API', async () => {
  const store = createStore(':memory:');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  for (let i = 0; i < 400; i++) store.logSearch('x', new Date(now - 1000).toISOString());
  const api = fakeApi({});
  await assert.rejects(
    () => searchKeyword({ api, store, accessToken: 't', q: '調酒', cap: 400, nowIso }),
    (e) => e instanceof SearchQuotaError
  );
  assert.equal(api.calls.length, 0);
  store.close();
});

test('searchKeyword 重試時額度守門仍生效，不會衝破 7 天硬上限', async () => {
  const store = createStore(':memory:');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // 已用 399，cap=400 → 只剩 1 次額度
  for (let i = 0; i < 399; i++) store.logSearch('x', new Date(now - 1000).toISOString());
  let apiCalls = 0;
  const api = { async keywordSearch() { apiCalls += 1; const e = new Error('限流'); e.status = 429; throw e; } };
  // 持續 429，若守門在 retry 外，退避會多打 2 次而超額；守門在 retry 內 → 第 2 次 attempt 就撞額度停手
  await assert.rejects(
    () => searchKeyword({ api, store, accessToken: 't', q: '調酒', cap: 400, nowIso, retries: 2, sleepImpl: async () => {} }),
  );
  assert.ok(store.countSearches7d(nowIso) <= 400, `額度不得超過 400，實際 ${store.countSearches7d(nowIso)}`);
  assert.ok(apiCalls <= 1, `剩 1 次額度時最多只能打 1 次 API，實際 ${apiCalls}`);
  store.close();
});

test('7 天窗滾動：8 天前的查詢不計入', () => {
  const store = createStore(':memory:');
  const now = Date.now();
  store.logSearch('old', new Date(now - 8 * DAY).toISOString());
  store.logSearch('recent', new Date(now - 1 * DAY).toISOString());
  assert.equal(store.countSearches7d(new Date(now).toISOString()), 1);
  store.close();
});

test('gatherTagPosts 去重並濾掉自己帳號', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({
    調酒: [{ id: '1', text: 'a', username: 'bob' }, { id: '2', text: 'me', username: 'argotaipei' }],
    酒吧: [{ id: '1', text: 'dup', username: 'bob' }, { id: '3', text: 'c', username: 'ann' }],
  });
  const out = await gatherTagPosts({
    api, store, accessToken: 't', tags: ['調酒', '酒吧'], perTag: 8, cap: 400,
    ownUsername: 'argotaipei', log: () => {},
  });
  assert.deepEqual(out.map((p) => p.id).sort(), ['1', '3']);
  store.close();
});
