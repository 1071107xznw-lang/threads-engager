import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRssTitles, fetchNewsTitles } from '../src/trends.mjs';

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
