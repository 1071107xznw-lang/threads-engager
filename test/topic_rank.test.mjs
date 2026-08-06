import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTraffic, ownTopicStats, rankTopics } from '../src/topic_rank.mjs';

test('parseTraffic：吃得下 Google Trends 各種寫法', () => {
  assert.equal(parseTraffic('20K+'), 20000);
  assert.equal(parseTraffic('200,000+'), 200000);
  assert.equal(parseTraffic('1M+'), 1000000);
  assert.equal(parseTraffic('2萬+'), 20000);
  assert.equal(parseTraffic('5千'), 5000);
  assert.equal(parseTraffic('1000+'), 1000);
});

test('parseTraffic：拿不到就是 0，不要拋例外', () => {
  assert.equal(parseTraffic(null), 0);
  assert.equal(parseTraffic(''), 0);
  assert.equal(parseTraffic('未知'), 0);
});

test('ownTopicStats：同主題多則要平均，沒數據的略過', () => {
  const stats = ownTopicStats([
    { topic: '調酒', metrics: { views: 1000 } },
    { topic: '調酒', metrics: { views: 3000 } },
    { topic: '電競', metrics: { views: 500 } },
    { topic: '沒數據的', metrics: {} },
    { topic: '', metrics: { views: 999 } }, // 沒主題，不算
  ]);
  assert.deepEqual(stats, [
    { topic: '調酒', avgViews: 2000, n: 2 },
    { topic: '電競', avgViews: 500, n: 1 },
  ]);
});

test('rankTopics：熱度高的排前面', () => {
  const out = rankTopics({
    hotTrends: [{ topic: '小的', traffic: '1K+' }, { topic: '大的', traffic: '500K+' }],
  });
  assert.deepEqual(out.map((t) => t.topic), ['大的', '小的']);
  assert.equal(out[0].source, 'trends');
});

test('rankTopics：自家成效好的要贏過純熱度高的', () => {
  // 這是這個模組存在的理由——「大家在搜」不等於「對我們的受眾有用」。
  // 自家驗證過的主題權重要壓過搜尋熱度。
  const out = rankTopics({
    hotTrends: [{ topic: '很熱但我們沒用過', traffic: '500K+' }, { topic: '我們的主題', traffic: '1K+' }],
    ownHistory: [{ topic: '我們的主題', metrics: { views: 8000 } }],
  });
  assert.equal(out[0].topic, '我們的主題');
  assert.equal(out[0].source, 'both');
  assert.match(out[0].ownNote, /自家用過 1 次/);
});

test('rankTopics：自家用過但不在熱搜清單裡的，也要進候選', () => {
  const out = rankTopics({
    hotTrends: [{ topic: '熱搜來的', traffic: '10K+' }],
    ownHistory: [{ topic: '只有我們用過', metrics: { views: 5000 } }],
  });
  assert.ok(out.some((t) => t.topic === '只有我們用過'));
  assert.equal(out.find((t) => t.topic === '只有我們用過').source, 'own');
});

test('rankTopics：兩邊都沒資料時回空陣列，不要炸', () => {
  assert.deepEqual(rankTopics(), []);
  assert.deepEqual(rankTopics({ hotTrends: [{ topic: '' }] }), []);
});

test('rankTopics：limit 要生效', () => {
  const hotTrends = Array.from({ length: 30 }, (_, i) => ({ topic: `t${i}`, traffic: `${30 - i}K+` }));
  assert.equal(rankTopics({ hotTrends, limit: 5 }).length, 5);
});
