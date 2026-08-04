import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPolishPrompt, parsePolish, polishDraft } from '../src/polish.mjs';

const ORIGINAL = '今天進了新的紅酒，很好喝，歡迎大家來喝。';

test('buildPolishPrompt：明講這是作者自己寫的、不准改掉原意', () => {
  const p = buildPolishPrompt({ text: ORIGINAL, persona: '小編' });
  assert.match(p, /自己寫的/);
  assert.match(p, /這是他的文/);
  assert.match(p, /改掉作者的原意/);
  assert.match(p, /鉤子/);
  assert.match(p, /AI 腔/);
  assert.match(p, new RegExp(ORIGINAL));
});

test('buildPolishPrompt：接不上熱度就不准硬蹭', () => {
  const p = buildPolishPrompt({
    text: ORIGINAL,
    hotTrends: [{ topic: '大樂透', traffic: '10000+' }],
  });
  assert.match(p, /大樂透/);
  assert.match(p, /硬凹會很尷尬/);
  assert.match(p, /接不上就不要接/);
});

test('buildPolishPrompt：有知識庫時，不准替原稿補營業細節', () => {
  const p = buildPolishPrompt({ text: ORIGINAL, knowledge: '- 我們夏天會把輕的紅酒冰一下' });
  assert.match(p, /輕的紅酒冰一下/);
  assert.match(p, /不准替原稿補上知識庫沒有的營業細節/);
  assert.match(p, /時間、價格、人名、分鐘數/);
});

test('parsePolish：解析全欄位', () => {
  const r = parsePolish(
    '前綴 {"text":"新版全文","hook":"第一行丟衝突","topic":"紅酒.吧","trend":"夏天","changes":["砍掉廢話","加了問題"]} 後綴',
    { fallbackText: ORIGINAL },
  );
  assert.equal(r.text, '新版全文');
  assert.equal(r.hook, '第一行丟衝突');
  assert.equal(r.topic, '紅酒吧'); // 句點被清掉
  assert.equal(r.trend, '夏天');
  assert.deepEqual(r.changes, ['砍掉廢話', '加了問題']);
  assert.equal(r.ok, true);
});

test('parsePolish：壞輸出 → 原稿原樣回去、ok=false（絕不弄丟使用者寫的東西）', () => {
  const r = parsePolish('AI 講了一堆廢話沒有 JSON', { fallbackText: ORIGINAL });
  assert.equal(r.text, ORIGINAL);
  assert.equal(r.ok, false);
  assert.deepEqual(r.changes, []);
});

test('parsePolish：AI 回空字串也要保住原稿', () => {
  const r = parsePolish('{"text":"   ","hook":"x"}', { fallbackText: ORIGINAL });
  assert.equal(r.text, ORIGINAL);
  assert.equal(r.ok, false);
});

test('polishDraft：優化後會再過紅隊，改寫結果進最終稿', async () => {
  const runner = async (prompt) => (
    prompt.includes('知識型網友')
      ? '{"text":"紅隊改過的版本","changed":true,"note":"把斷言改成自家做法"}'
      : '{"text":"優化版","hook":"h","topic":"t","trend":"","changes":["c"]}'
  );
  const r = await polishDraft({ text: ORIGINAL, runner });
  assert.equal(r.text, '紅隊改過的版本');
  assert.match(r.reviewNote, /自家做法/);
  assert.equal(r.original, ORIGINAL);
  assert.equal(r.ok, true);
});

test('polishDraft：redTeam=false 只呼叫一次', async () => {
  let calls = 0;
  const runner = async () => {
    calls += 1;
    return '{"text":"優化版","hook":"h","topic":"t","trend":"","changes":[]}';
  };
  const r = await polishDraft({ text: ORIGINAL, runner, redTeam: false });
  assert.equal(calls, 1);
  assert.equal(r.text, '優化版');
});

test('polishDraft：AI 掛掉 → 回原稿、ok=false，不丟例外', async () => {
  const runner = async () => { throw new Error('claude 掛了'); };
  const r = await polishDraft({ text: ORIGINAL, runner });
  assert.equal(r.text, ORIGINAL);
  assert.equal(r.ok, false);
});

test('polishDraft：空內容直接拋錯（不浪費一次 AI 呼叫）', async () => {
  let called = false;
  const runner = async () => { called = true; return 'x'; };
  await assert.rejects(() => polishDraft({ text: '   ', runner }), /沒有內容/);
  assert.equal(called, false);
});
