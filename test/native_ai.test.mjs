import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativePrompt, parseDrafts, generateDrafts } from '../src/native_ai.mjs';

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

test('generateDrafts 用注入 runner', async () => {
  const runner = async () => '[{"text":"嗨","angle":"a"}]';
  const out = await generateDrafts({ persona: 'p', newsTitles: [], tagPosts: [], ownPosts: [], n: 1, runner });
  assert.equal(out[0].text, '嗨');
});
