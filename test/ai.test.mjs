import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

// ── UTF-8 分塊解碼（真正跑一次子行程，確保修好的是實際路徑）──
test('defaultRunner：中文與 emoji 被切在 stdout chunk 邊界也不會變成壞字元', async () => {
  const { defaultRunner } = await import('../src/ai.mjs');
  // 用一個假的 claude：分兩次寫出，故意把一個中文字切成兩半
  const dir = mkdtempSync(join(tmpdir(), 'fakeclaude-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    'const s = "小編偷喝一口回報🍷真的順，這樣才對";',
    'const b = Buffer.from(s, "utf8");',
    'const cut = 20;', // 落在多位元組字元中間
    'process.stdout.write(b.subarray(0, cut));',
    'setTimeout(() => { process.stdout.write(b.subarray(cut)); }, 20);',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);

  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  try {
    const out = await defaultRunner('不重要');
    assert.doesNotMatch(out, /�/, `輸出含壞字元：${JSON.stringify(out)}`);
    assert.match(out, /小編偷喝一口回報🍷真的順/);
  } finally {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isAuthFailure：登入失效與一般錯誤分得開', async () => {
  const { isAuthFailure } = await import('../src/ai.mjs');
  assert.equal(isAuthFailure('Failed to authenticate. API Error: 401 OAuth access token has been revoked.'), true);
  assert.equal(isAuthFailure('Invalid API key'), true);
  assert.equal(isAuthFailure('spawn ENOENT'), false);
  assert.equal(isAuthFailure('AI 輸出找不到 JSON 陣列'), false);
  assert.equal(isAuthFailure(''), false);
});

test('defaultRunner：登入失效時直接告訴使用者要重新登入', async () => {
  const { defaultRunner } = await import('../src/ai.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'fakeclaude-auth-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    'process.stderr.write("Failed to authenticate. API Error: 401 OAuth access token has been revoked.");',
    'process.exit(1);',
  ].join('\n'), 'utf8');
  chmodSync(bin, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  try {
    await assert.rejects(() => defaultRunner('x'), (e) => {
      assert.equal(e.authError, true);
      assert.match(e.message, /需要重新登入/);
      assert.match(e.message, /執行 `claude` 登入/);
      return true;
    });
  } finally {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPrompt：outreach 也支援 avoid（重新生成時換角度）', () => {
  const p = buildPrompt(post, '人設', { avoid: ['太乖的第一版'] });
  assert.match(p, /重新生成/);
  assert.match(p, /太乖的第一版/);
  assert.match(p, /換一個完全不同的切入角度/);
  assert.doesNotMatch(buildPrompt(post, '人設'), /重新生成/);
});
