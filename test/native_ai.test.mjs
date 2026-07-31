import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativePrompt, parseDrafts, generateDrafts, suggestTopic } from '../src/native_ai.mjs';

test('buildNativePrompt 含 persona/熱搜/新聞/站內/自己貼文', () => {
  const p = buildNativePrompt({
    persona: 'ARGO人設',
    hotTrends: [{ topic: '大樂透', traffic: '10000+', context: '頭獎9億' }],
    newsTitles: ['新聞A'],
    tagPosts: [{ text: '站內貼文X' }],
    ownPosts: ['自己Y'],
    n: 3,
  });
  assert.match(p, /ARGO人設/);
  assert.match(p, /即時熱搜/);
  assert.match(p, /大樂透（流量 10000\+）：頭獎9億/);
  assert.match(p, /政治、災難/);
  assert.match(p, /新聞A/);
  assert.match(p, /站內貼文X/);
  assert.match(p, /自己Y/);
  assert.match(p, /JSON 陣列/);
});

test('無熱搜素材時不出現熱搜段落', () => {
  const p = buildNativePrompt({ persona: 'x', newsTitles: [], tagPosts: [], ownPosts: [], n: 1 });
  assert.doesNotMatch(p, /即時熱搜/);
});

test('parseDrafts 解析並擋超長/缺欄位', () => {
  const raw = '亂碼前 [{"text":"稿一","angle":"角度"},{"nope":1},{"text":"' + '字'.repeat(501) + '"}] 後綴';
  const out = parseDrafts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, '稿一');
  assert.equal(out[0].angle, '角度');
});

test('parseDrafts 找不到陣列拋錯', () => {
  assert.throws(() => parseDrafts('沒有 JSON'), /找不到/);
});

test('parseDrafts 全部無效拋錯', () => {
  assert.throws(() => parseDrafts('[{"nope":1}]'), /未產出/);
});

test('buildNativePrompt 要求 AI 一併建議主題', () => {
  const p = buildNativePrompt({ persona: 'x', n: 2 });
  assert.match(p, /主題\(topic\)/);
  assert.match(p, /"topic":"主題"/);
});

test('parseDrafts 解析並整理 AI 建議的主題（去符號/截長/無效回 null）', () => {
  const raw = '[{"text":"稿一","angle":"a","topic":"調酒.吧"},{"text":"稿二","angle":"b","topic":"' + '長'.repeat(60) + '"},{"text":"稿三","topic":"  "}]';
  const out = parseDrafts(raw);
  assert.equal(out[0].topic, '調酒吧'); // 句點被去掉
  assert.equal([...out[1].topic].length, 50); // 截到 50 字
  assert.equal(out[2].topic, null); // 空白 → null
});

test('generateDrafts 用注入 runner，回傳含 topic', async () => {
  const runner = async () => '[{"text":"嗨","angle":"a","topic":"派對"}]';
  const out = await generateDrafts({ persona: 'p', newsTitles: [], tagPosts: [], ownPosts: [], n: 1, runner });
  assert.equal(out[0].text, '嗨');
  assert.equal(out[0].topic, '派對');
});

test('suggestTopic：注入 runner，整理輸出（取第一行、去符號）', async () => {
  const runner = async () => '#微醺週五\n（這是說明，不該被採用）';
  const t = await suggestTopic({ text: '週五來喝一杯', persona: 'p', runner });
  assert.equal(t, '微醺週五');
});

test('suggestTopic：空內容回 null、不呼叫 AI', async () => {
  let called = false;
  const runner = async () => { called = true; return 'x'; };
  const t = await suggestTopic({ text: '   ', runner });
  assert.equal(t, null);
  assert.equal(called, false);
});
