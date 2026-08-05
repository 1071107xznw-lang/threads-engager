import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVoiceSamples, voiceSamplesBlock, fetchVoiceSamples } from '../src/voice.mjs';

// 真實資料長這樣：一堆單一 emoji、單一名詞，夾雜少數有語感的短句。
const REAL = [
  { text: '生蠔' },
  { text: '先到先先享受😂' },
  { text: '感覺懂喝懂吃' },
  { text: '不會是冰節吧😂' },
  { text: '哪家醫院，想認識😂' },
  { text: '@housyunn' },
  { text: '怎麼有種xx叉燒包的Feel' },
  { text: '🤣' },
];

test('pickVoiceSamples 濾掉沒內容的，但保留短句', () => {
  const out = pickVoiceSamples(REAL);
  // 「短」本身就是要學的語感，不能因為短就丟掉
  assert.ok(out.includes('先到先先享受😂'), '有語感的短句要留著');
  assert.ok(out.includes('哪家醫院，想認識😂'));
  // 這些教不了東西
  assert.ok(!out.includes('🤣'), '單一 emoji 要濾掉');
  assert.ok(!out.includes('生蠔'), '單一名詞要濾掉');
  assert.ok(!out.includes('@housyunn'), '只 tag 人要濾掉');
});

test('pickVoiceSamples 去重、限量、濾掉過長的', () => {
  const rows = [
    { text: '一樣的話' }, { text: '一樣的話' },
    { text: 'x'.repeat(200) },
    ...Array.from({ length: 30 }, (_, i) => ({ text: `第${i}則有內容的留言` })),
  ];
  const out = pickVoiceSamples(rows, { limit: 5 });
  assert.equal(out.length, 5);
  assert.equal(out.filter((t) => t === '一樣的話').length, 1);
  assert.ok(!out.some((t) => t.length > 120), '太長的通常是貼文不是留言');
});

test('pickVoiceSamples 容忍空值', () => {
  assert.deepEqual(pickVoiceSamples(null), []);
  assert.deepEqual(pickVoiceSamples([{ text: '' }, {}, null]), []);
});

test('voiceSamplesBlock 沒樣本時回空字串（不要在 prompt 留空標題）', () => {
  assert.equal(voiceSamplesBlock([]), '');
  assert.equal(voiceSamplesBlock(undefined), '');
});

test('fetchVoiceSamples 抓不到就回空陣列，不可以擋掉產稿', async () => {
  const logs = [];
  const api = { listOwnReplies: async () => { throw new Error('權限不足'); } };
  const out = await fetchVoiceSamples({ api, accessToken: 't', userId: '1', log: (m) => logs.push(m) });
  assert.deepEqual(out, []);
  assert.match(logs.join(''), /不擋產稿/);
});

test('fetchVoiceSamples 成功時挑好樣本', async () => {
  const api = { listOwnReplies: async () => ({ data: REAL }) };
  const out = await fetchVoiceSamples({ api, accessToken: 't', userId: '1', limit: 3 });
  assert.equal(out.length, 3);
  assert.ok(out.every((t) => t.length > 1));
});
