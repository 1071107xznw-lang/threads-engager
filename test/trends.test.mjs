import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRssTitles, fetchNewsTitles, parseTrendingTopics, fetchTrendingTopics } from '../src/trends.mjs';

const SAMPLE = `<rss><channel>
<item><title><![CDATA[調酒新趨勢 &amp; 微醺生活]]></title></item>
<item><title>台北酒吧週末活動</title></item>
</channel></rss>`;

test('parseRssTitles 解析含 CDATA 與 entity', () => {
  const t = parseRssTitles(SAMPLE);
  assert.deepEqual(t, ['調酒新趨勢 & 微醺生活', '台北酒吧週末活動']);
});

test('fetchNewsTitles HTTP 失敗回空、不丟', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '' });
  const r = await fetchNewsTitles({ fetchImpl, feeds: ['http://x'], log: () => {} });
  assert.deepEqual(r, []);
});

test('fetchNewsTitles 例外也不丟', async () => {
  const fetchImpl = async () => { throw new Error('網路壞了'); };
  const r = await fetchNewsTitles({ fetchImpl, feeds: ['http://x'], log: () => {} });
  assert.deepEqual(r, []);
});

test('fetchNewsTitles 成功回標題並跨 feed 去重', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => SAMPLE });
  const r = await fetchNewsTitles({ fetchImpl, feeds: ['http://x', 'http://y'], log: () => {} });
  assert.deepEqual(r, ['調酒新趨勢 & 微醺生活', '台北酒吧週末活動']);
});

const TRENDS_SAMPLE = `<rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<title>Daily Search Trends</title>
<item><title>大樂透</title><ht:approx_traffic>10000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>大樂透頭獎衝上9億！命理師曝旺財法</ht:news_item_title></ht:news_item>
  <ht:news_item><ht:news_item_title>第二則新聞不取</ht:news_item_title></ht:news_item></item>
<item><title>颱風動態 &amp; 停班停課</title></item>
</channel></rss>`;

test('parseTrendingTopics 解析熱搜詞/流量/背景新聞（channel title 不誤入）', () => {
  const r = parseTrendingTopics(TRENDS_SAMPLE);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { topic: '大樂透', traffic: '10000+', context: '大樂透頭獎衝上9億！命理師曝旺財法' });
  assert.deepEqual(r[1], { topic: '颱風動態 & 停班停課', traffic: null, context: null });
});

test('fetchTrendingTopics 失敗容忍且依 topic 去重', async () => {
  const bad = async () => { throw new Error('斷線'); };
  assert.deepEqual(await fetchTrendingTopics({ fetchImpl: bad, feeds: ['http://x'], log: () => {} }), []);
  const ok = async () => ({ ok: true, status: 200, text: async () => TRENDS_SAMPLE });
  const r = await fetchTrendingTopics({ fetchImpl: ok, feeds: ['http://x', 'http://y'], log: () => {} });
  assert.equal(r.length, 2); // 兩個 feed 相同內容 → 去重後仍 2 筆
});
