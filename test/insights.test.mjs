import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInsights, engagementScore, interactionCount, summarizeMetrics, rankOwnPosts, DEFAULT_WEIGHTS,
} from '../src/insights.mjs';

// ── 解析 ──
test('parseInsights：media 版 values:[{value}]', () => {
  const m = parseInsights({
    data: [
      { name: 'views', period: 'lifetime', values: [{ value: 1200 }] },
      { name: 'likes', period: 'lifetime', values: [{ value: 34 }] },
      { name: 'replies', period: 'lifetime', values: [{ value: 7 }] },
    ],
  });
  assert.equal(m.views, 1200);
  assert.equal(m.likes, 34);
  assert.equal(m.replies, 7);
  assert.equal(m.reposts, 0); // 沒回的算 0
});

test('parseInsights：user 版 total_value:{value} 也吃', () => {
  const m = parseInsights({ data: [{ name: 'likes', total_value: { value: 88 } }] });
  assert.equal(m.likes, 88);
});

test('parseInsights：時間序列多筆取總和', () => {
  const m = parseInsights({
    data: [{ name: 'views', values: [{ value: 10 }, { value: 15 }, { value: 5 }] }],
  });
  assert.equal(m.views, 30);
});

test('parseInsights：壞資料/未知指標不炸', () => {
  assert.equal(parseInsights(null).views, 0);
  assert.equal(parseInsights({}).likes, 0);
  const m = parseInsights({ data: [{ name: '不認識的指標', values: [{ value: 9 }] }, null] });
  assert.equal(m.views, 0);
});

// ── 分數 ──
test('engagementScore：留言比讚值錢很多（演算法吃互動）', () => {
  const oneReply = engagementScore({ replies: 1 });
  const oneLike = engagementScore({ likes: 1 });
  assert.ok(oneReply > oneLike * 5, `留言 ${oneReply} 應遠大於讚 ${oneLike}`);
  assert.equal(oneReply, DEFAULT_WEIGHTS.replies);
});

test('engagementScore：高瀏覽但零互動 < 低瀏覽但很多留言', () => {
  const lurked = engagementScore({ views: 3000 });
  const talked = engagementScore({ views: 400, replies: 40, likes: 60 });
  assert.ok(talked > lurked);
});

test('interactionCount / summarizeMetrics', () => {
  const m = { views: 100, likes: 5, replies: 2, reposts: 1, quotes: 1, shares: 0 };
  assert.equal(interactionCount(m), 9);
  const s = summarizeMetrics(m);
  assert.match(s, /瀏覽 100/);
  assert.match(s, /留言 2/);
  assert.match(s, /轉發\/引用 2/);
  assert.equal(summarizeMetrics({}), '無數據');
});

// ── 排名 ──
const insightsFor = (map) => ({
  async getMediaInsights({ mediaId }) {
    if (!(mediaId in map)) throw new Error('no data');
    const m = map[mediaId];
    return { data: Object.entries(m).map(([name, value]) => ({ name, values: [{ value }] })) };
  },
});

test('rankOwnPosts：依加權分數排序，冠軍在前', async () => {
  const api = insightsFor({
    a: { views: 5000, likes: 2 },            // 只有瀏覽
    b: { views: 800, likes: 40, replies: 30 }, // 有人講話
    c: { views: 100, likes: 1 },
  });
  const r = await rankOwnPosts({
    api,
    accessToken: 't',
    posts: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
  });
  assert.equal(r.available, true);
  assert.equal(r.top[0].id, 'b');
  assert.equal(r.top[0].interactions, 70);
  assert.equal(r.scored, 3);
});

test('rankOwnPosts：沒權限（連續失敗）→ fail-open，不擋產稿', async () => {
  const logs = [];
  const api = { async getMediaInsights() { throw new Error('(#10) requires threads_manage_insights'); } };
  const r = await rankOwnPosts({
    api,
    accessToken: 't',
    posts: [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, text: `t${i}` })),
    log: (m) => logs.push(m),
  });
  assert.equal(r.available, false);
  assert.equal(r.top.length, 0);
  assert.match(r.reason, /threads_manage_insights/);
  assert.ok(logs.some((l) => /threads_manage_insights/.test(l)), '要提示使用者怎麼修');
});

test('rankOwnPosts：只有個別貼文讀不到 → 跳過那則，其餘照排', async () => {
  const api = insightsFor({ a: { views: 10 }, c: { views: 999, replies: 5 } });
  const r = await rankOwnPosts({
    api,
    accessToken: 't',
    posts: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
  });
  assert.equal(r.available, true);
  assert.equal(r.scored, 2);
  assert.equal(r.top[0].id, 'c');
});

test('rankOwnPosts：maxFetch 上限與 limit 生效（不無限打 API）', async () => {
  let calls = 0;
  const api = {
    async getMediaInsights() { calls += 1; return { data: [{ name: 'views', values: [{ value: calls }] }] }; },
  };
  const posts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `t${i}` }));
  const r = await rankOwnPosts({ api, accessToken: 't', posts, limit: 3, maxFetch: 8 });
  assert.equal(calls, 8);
  assert.equal(r.top.length, 3);
});

test('rankOwnPosts：沒貼文 → available:false，不呼叫 API', async () => {
  let called = false;
  const api = { async getMediaInsights() { called = true; return {}; } };
  const r = await rankOwnPosts({ api, accessToken: 't', posts: [] });
  assert.equal(r.available, false);
  assert.equal(called, false);
});
