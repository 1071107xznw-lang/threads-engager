import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCompliance, summarizeCompliance, LEGAL_RULES } from '../src/compliance.mjs';

// ── 掃得到真正的紅線 ──
test('scanCompliance：抓到醫療效能宣稱，並標出條款與罰則級距', () => {
  const hits = scanCompliance('這杯超解酒，隔天不會宿醉');
  assert.ok(hits.length >= 1);
  assert.match(hits[0].law, /§28-2/);
  assert.match(hits[0].fine, /60 萬/);
  assert.match(summarizeCompliance(hits), /解酒/);
});

test('scanCompliance：連「當玩笑」也照抓——認定看整體印象，截圖會掉脈絡', () => {
  const hits = scanCompliance('夏天喝這個超解暑（欸不是解酒喔哈哈）');
  assert.ok(hits.length >= 1, '否認式玩笑仍要標示出來讓人自己判斷');
  assert.match(summarizeCompliance(hits), /解酒/);
});

test('scanCompliance：保肝/排毒/助眠/瘦身/美容/免疫都算醫療效能', () => {
  for (const t of ['喝了很保肝', '幫你排毒', '有助眠效果', '這杯能瘦身', '養顏美容', '增強免疫力']) {
    assert.ok(scanCompliance(t).length >= 1, `應該要抓到：${t}`);
  }
});

test('scanCompliance：鼓勵過量飲酒與酒駕情境', () => {
  assert.ok(scanCompliance('今晚不醉不歸').length >= 1);
  assert.ok(scanCompliance('喝完再開車回家沒問題').length >= 1);
});

test('scanCompliance：絕對化宣稱（§28-1，較輕但仍會罰）', () => {
  const hits = scanCompliance('全台第一好喝，保證你會愛上');
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => /§28-1/.test(h.law)));
});

// ── 不能誤殺正常用語（誤判會讓警示變雜訊，久了就沒人看） ──
test('scanCompliance：醒酒/醒酒器是紅酒正常術語，不可誤判成解酒', () => {
  assert.deepEqual(scanCompliance('這支要先醒酒 30 分鐘，用醒酒器更快'), []);
});

test('scanCompliance：療癒是口語講心情，不是療效', () => {
  assert.deepEqual(scanCompliance('下班喝一杯真的很療癒'), []);
});

test('scanCompliance：純風味描述完全不該被標記', () => {
  assert.deepEqual(scanCompliance('果香很跳、尾韻帶點苦，配鐵板的油脂剛好'), []);
  assert.deepEqual(scanCompliance('新的紅酒到了，小編先偷喝一口回報：真的順'), []);
});

test('scanCompliance：空字串回空陣列', () => {
  assert.deepEqual(scanCompliance(''), []);
  assert.deepEqual(scanCompliance(null), []);
  assert.equal(summarizeCompliance([]), '');
});

// ── prompt 規則本身 ──
test('LEGAL_RULES：條款、罰則、玩笑也不行、以及「風味描述沒問題」的界線', () => {
  assert.match(LEGAL_RULES, /§28-2/);
  assert.match(LEGAL_RULES, /60 萬/);
  assert.match(LEGAL_RULES, /連當玩笑、反話、諧音帶到都不行/);
  assert.match(LEGAL_RULES, /截圖傳出去/);
  assert.match(LEGAL_RULES, /風味描述，不是療效/); // 別把 AI 嚇到不敢形容味道
});

// ── 三條產出路徑都要吃到同一份規則 ──
test('紅隊審稿 / ✨優化 / 💬留言區 三個 prompt 都含法規紅線', async () => {
  const { buildRedTeamPrompt } = await import('../src/native_ai.mjs');
  const { buildPolishPrompt } = await import('../src/polish.mjs');
  const { buildInboxPrompt } = await import('../src/inbox.mjs');
  const prompts = [
    buildRedTeamPrompt({ text: 'x' }),
    buildPolishPrompt({ text: 'x' }),
    buildInboxPrompt({ reply: { username: 'a', text: 'b' } }),
  ];
  for (const p of prompts) {
    assert.match(p, /法規紅線/);
    assert.match(p, /§28-2/);
  }
});

test('紅隊：法規問題不可以拿來討價還價', async () => {
  const { buildRedTeamPrompt } = await import('../src/native_ai.mjs');
  assert.match(buildRedTeamPrompt({ text: 'x' }), /法規紅線一律照改/);
});
