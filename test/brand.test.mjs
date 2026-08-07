import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_VOICE_RULES, DEFAULT_BRAND, loadBrand } from '../src/brand.mjs';

// ── 不准替敘事者發明生平 ──
// 實際踩過：段子寫「直到上禮拜，我自己當了爸。我兒子要出門…」——
// 一句話就替這個帳號指定了性別與家庭狀況，而讀者根本不知道經營者是誰。
// 發出去就收不回來，所以要在規則層擋，不是靠事後一則一則抓。
test('PERSONAL_VOICE_RULES：禁止替「我」發明性別/婚姻/小孩', () => {
  assert.match(PERSONAL_VOICE_RULES, /不准替「我」發明生平/);
  assert.match(PERSONAL_VOICE_RULES, /性別、婚姻、有沒有小孩/);
  // 把真正踩過的句子寫進規則，模型比較不會再產一次
  assert.match(PERSONAL_VOICE_RULES, /我自己當了爸/);
  assert.match(PERSONAL_VOICE_RULES, /我太太說/);
});

test('PERSONAL_VOICE_RULES：要給替代寫法，不能只說不行', () => {
  // 只禁不教的話，模型會整段避開親情題材——那是把好題目一起砍掉
  assert.match(PERSONAL_VOICE_RULES, /不指定敘事者身分/);
  assert.match(PERSONAL_VOICE_RULES, /姪子/);
  // 講別人不受限制
  assert.match(PERSONAL_VOICE_RULES, /講「我爸」「我媽」「我朋友」沒問題/);
});

test('PERSONAL_VOICE_RULES：原本的不准自稱小編要留著', () => {
  assert.match(PERSONAL_VOICE_RULES, /不准自稱「小編」/);
});

// 四條產出路徑共用同一份規則。少接一條，那條就會繼續產出有問題的內容。
test('產稿 prompt 帶到「不准發明生平」', async () => {
  const { buildNativePrompt } = await import('../src/native_ai.mjs');
  assert.match(buildNativePrompt({ persona: 'x', n: 1 }), /不准替「我」發明生平/);
});

test('紅隊 prompt 帶到「不准發明生平」（產完還要再被抓一次）', async () => {
  const { buildRedTeamPrompt } = await import('../src/native_ai.mjs');
  assert.match(buildRedTeamPrompt({ text: '我自己當了爸' }), /不准替「我」發明生平/);
});

test('💬 留言區 prompt 帶到「不准發明生平」', async () => {
  const { buildInboxPrompt } = await import('../src/inbox.mjs');
  const p = buildInboxPrompt({ reply: { username: 'a', text: '推' }, persona: 'x' });
  assert.match(p, /不准替「我」發明生平/);
});

// ── 設定預設值 ──
test('DEFAULT_BRAND：自動排程的預設值', () => {
  assert.equal(DEFAULT_BRAND.autoSchedule, true);
  assert.equal(DEFAULT_BRAND.dailyPublishCap, 15);
  assert.equal(DEFAULT_BRAND.minGapMinutes, 55);
  assert.deepEqual(DEFAULT_BRAND.activeHours, { start: 9, end: 25 });
});

test('loadBrand：讀不到設定檔就回預設，不要爆', () => {
  const b = loadBrand('/does/not/exist.json');
  assert.equal(b.minGapMinutes, 55);
  assert.deepEqual(b.audienceInterests, []);
});
