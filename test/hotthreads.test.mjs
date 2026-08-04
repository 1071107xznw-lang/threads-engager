import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { normalizeKeyword, findHotThreads } from '../src/hotthreads.mjs';

const post = (id, username, text) => ({
  id, username, text, permalink: `https://www.threads.com/@${username}/post/${id}`,
  timestamp: '2026-08-01T00:00:00+0000',
});

function fakeApi(byType) {
  const calls = [];
  return {
    calls,
    async keywordSearch({ q, searchType, limit }) {
      calls.push({ q, searchType, limit });
      return { data: byType[searchType] || [] };
    },
  };
}

test('normalizeKeyword：去掉開頭 #、擋空與超長', () => {
  assert.equal(normalizeKeyword('  #調酒 '), '調酒');
  assert.throws(() => normalizeKeyword('   '), /請輸入關鍵字/);
  assert.throws(() => normalizeKeyword('字'.repeat(51)), /太長/);
});

test('findHotThreads：TOP 優先，不足才補 RECENT，並去重', async () => {
  const api = fakeApi({
    TOP: [post('1', 'alice', 'A'), post('2', 'bob', 'B')],
    RECENT: [post('2', 'bob', 'B'), post('3', 'carol', 'C')], // 2 重複
  });
  const store = createStore(':memory:');
  const r = await findHotThreads({ api, store, accessToken: 't', keyword: '調酒', limit: 20, cap: 500 });
  assert.deepEqual(r.results.map((x) => x.id), ['1', '2', '3']);
  assert.equal(api.calls[0].searchType, 'TOP');
  assert.equal(api.calls[1].searchType, 'RECENT');
  assert.ok(r.results[0].permalink.startsWith('https://'));
});

test('findHotThreads：湊滿 limit 就不再打第二次 API（省額度）', async () => {
  const api = fakeApi({
    TOP: [post('1', 'a', 'x'), post('2', 'b', 'y'), post('3', 'c', 'z')],
    RECENT: [post('4', 'd', 'w')],
  });
  const store = createStore(':memory:');
  const r = await findHotThreads({ api, store, accessToken: 't', keyword: 'k', limit: 3, cap: 500 });
  assert.equal(r.results.length, 3);
  assert.equal(api.calls.length, 1);
});

test('findHotThreads：濾掉自己的貼文；全是自己的 → 標記 Dev 模式徵狀', async () => {
  const api = fakeApi({
    TOP: [post('1', 'argotaipei', '自己的'), post('2', 'argotaipei', '也是自己的')],
    RECENT: [],
  });
  const store = createStore(':memory:');
  const r = await findHotThreads({
    api, store, accessToken: 't', keyword: 'k', cap: 500, ownUsername: 'argotaipei',
  });
  assert.equal(r.results.length, 0);
  assert.equal(r.devModeLikely, true);
});

test('findHotThreads：搜不到東西 ≠ Dev 模式（不要誤導）', async () => {
  const api = fakeApi({ TOP: [], RECENT: [] });
  const store = createStore(':memory:');
  const r = await findHotThreads({ api, store, accessToken: 't', keyword: 'k', cap: 500, ownUsername: 'me' });
  assert.equal(r.results.length, 0);
  assert.equal(r.devModeLikely, false);
});

test('findHotThreads：額度用完 → 不呼叫 API、標記 quotaExhausted', async () => {
  const api = fakeApi({ TOP: [post('1', 'a', 'x')] });
  const store = createStore(':memory:');
  const now = '2026-08-03T00:00:00.000Z';
  for (let i = 0; i < 5; i++) store.logSearch(`q${i}`, now);
  const r = await findHotThreads({
    api, store, accessToken: 't', keyword: 'k', cap: 5, nowIso: now,
  });
  assert.equal(r.quotaExhausted, true);
  assert.equal(r.results.length, 0);
  assert.equal(api.calls.length, 0);
});

test('findHotThreads：每次搜尋都計入 7 天額度', async () => {
  const api = fakeApi({ TOP: [post('1', 'a', 'x')], RECENT: [post('2', 'b', 'y')] });
  const store = createStore(':memory:');
  const now = '2026-08-03T00:00:00.000Z';
  const r = await findHotThreads({
    api, store, accessToken: 't', keyword: 'k', limit: 20, cap: 500, nowIso: now,
  });
  assert.equal(r.quotaUsed7d, 2); // TOP + RECENT 各算一次
});

test('findHotThreads：誠實標註拿不到觀看數', async () => {
  const api = fakeApi({ TOP: [post('1', 'a', 'x')] });
  const store = createStore(':memory:');
  const r = await findHotThreads({ api, store, accessToken: 't', keyword: 'k', limit: 1, cap: 500 });
  assert.match(r.note, /不提供他人貼文的觀看/);
});
