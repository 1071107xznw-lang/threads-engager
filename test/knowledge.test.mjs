import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadKnowledge, resolveKnowledgePath } from '../src/knowledge.mjs';

test('loadKnowledge：讀檔、去掉 <!-- 註解行、壓縮空行', () => {
  const p = join(tmpdir(), `kb-${process.pid}.md`);
  writeFileSync(p, '<!-- 這是說明，不該進 prompt -->\n# 事實\n\n\n\n- 紅酒先冰 20 分鐘\n', 'utf8');
  const kb = loadKnowledge(p);
  assert.doesNotMatch(kb, /不該進 prompt/);
  assert.match(kb, /紅酒先冰 20 分鐘/);
  assert.doesNotMatch(kb, /\n{3,}/);
  rmSync(p, { force: true });
});

test('loadKnowledge：跨行註解整塊拿掉（不然填寫說明會被當成品牌事實）', () => {
  const p = join(tmpdir(), `kb-multiline-${process.pid}.md`);
  writeFileSync(p, [
    '<!--',
    '這是給店家看的填寫說明。',
    '標「(待確認)」的請改成你們真實的做法或刪掉。',
    '-->',
    '',
    '# 事實',
    '- 紅酒先冰 20 分鐘',
  ].join('\n'), 'utf8');
  const kb = loadKnowledge(p);
  assert.doesNotMatch(kb, /填寫說明/);
  assert.doesNotMatch(kb, /待確認/);
  assert.doesNotMatch(kb, /-->/);
  assert.match(kb, /紅酒先冰 20 分鐘/);
  rmSync(p, { force: true });
});

test('loadKnowledge：沒收尾的註解殘骸也不留', () => {
  const p = join(tmpdir(), `kb-broken-${process.pid}.md`);
  writeFileSync(p, '<!-- 忘了收尾\n# 事實\n-->\n- 真的事實\n', 'utf8');
  const kb = loadKnowledge(p);
  assert.doesNotMatch(kb, /忘了收尾/);
  assert.doesNotMatch(kb, /-->/);
  assert.match(kb, /真的事實/);
  rmSync(p, { force: true });
});

test('loadKnowledge：沒有檔案回空字串（不擋產稿）', () => {
  assert.equal(loadKnowledge(null), '');
  assert.equal(loadKnowledge(join(tmpdir(), 'nope-does-not-exist.md')), '');
});

test('loadKnowledge：超長會截斷', () => {
  const p = join(tmpdir(), `kb-long-${process.pid}.md`);
  writeFileSync(p, '字'.repeat(5000), 'utf8');
  assert.equal(loadKnowledge(p, { maxChars: 100 }).length, 100);
  rmSync(p, { force: true });
});

test('resolveKnowledgePath：有 knowledge.md 才回路徑', () => {
  const dir = tmpdir();
  const p = join(dir, 'knowledge.md');
  assert.equal(resolveKnowledgePath(dir, () => false), null);
  writeFileSync(p, 'x', 'utf8');
  assert.equal(resolveKnowledgePath(dir, existsSync), p);
  rmSync(p, { force: true });
});
