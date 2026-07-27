import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResult, scoreAndDraft } from '../src/ai.mjs';

const post = { author: 'bob', content: '剛發了一首新歌', likes: 12 };

test('buildPrompt 含人設與貼文內容', () => {
  const p = buildPrompt(post, '親切的音樂人');
  assert.match(p, /親切的音樂人/);
  assert.match(p, /剛發了一首新歌/);
  assert.match(p, /JSON/);
});

test('parseResult 解析帶圍欄的 JSON', () => {
  const raw = '好的：\n```json\n{"score": 0.8, "draft": "讚！"}\n```\n';
  assert.deepEqual(parseResult(raw), { score: 0.8, draft: '讚！' });
});

test('parseResult 解析純 JSON', () => {
  assert.deepEqual(parseResult('{"score":0.3,"draft":"嗯"}'), { score: 0.3, draft: '嗯' });
});

test('scoreAndDraft 過門檻回傳草稿', async () => {
  const runner = async () => '{"score":0.9,"draft":"很棒的歌！"}';
  const r = await scoreAndDraft({ post, persona: 'x', threshold: 0.6, runner });
  assert.equal(r.score, 0.9);
  assert.equal(r.draft, '很棒的歌！');
});

test('scoreAndDraft 未過門檻草稿為 null', async () => {
  const runner = async () => '{"score":0.3,"draft":"嗯"}';
  const r = await scoreAndDraft({ post, persona: 'x', threshold: 0.6, runner });
  assert.equal(r.score, 0.3);
  assert.equal(r.draft, null);
});
