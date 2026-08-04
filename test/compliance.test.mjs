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

// ── 😈 幽默尺度：跟法規紅線是兩件事 ──
test('humorRules：三個尺度各有內容，未知值回落預設', async () => {
  const { humorRules, HUMOR_LEVELS, DEFAULT_HUMOR } = await import('../src/compliance.mjs');
  assert.match(humorRules('mild'), /溫和/);
  assert.match(humorRules('spicy'), /有梗/);
  assert.match(humorRules('hellish'), /地獄梗全開/);
  assert.equal(humorRules('亂寫'), humorRules(DEFAULT_HUMOR));
  assert.equal(humorRules(undefined), humorRules(DEFAULT_HUMOR));
  assert.ok(Object.keys(HUMOR_LEVELS).length === 3);
});

test('spicy：明講生蠔那種文化梗可以寫（先前被我誤判成法規問題）', async () => {
  const { humorRules } = await import('../src/compliance.mjs');
  assert.match(humorRules('spicy'), /弟弟或妹妹/);
  assert.match(humorRules('spicy'), /不用閃/);
});

test('hellish：放行地獄梗，但歧視/災難/未成年/人身攻擊仍是硬線', async () => {
  const { humorRules } = await import('../src/compliance.mjs');
  const p = humorRules('hellish');
  assert.match(p, /歧視/);
  assert.match(p, /災難、疾病、死亡/);
  assert.match(p, /未成年/);
  assert.match(p, /人身攻擊/);
  assert.match(p, /把刀對準自己/); // 地獄梗的正確用法
});

test('LEGAL_RULES：明講玩笑本身不違法，違法的是宣稱功效', async () => {
  const { LEGAL_RULES } = await import('../src/compliance.mjs');
  assert.match(LEGAL_RULES, /玩笑本身不違法/);
  assert.match(LEGAL_RULES, /生蠔補腎壯陽/); // 反例：這才是宣稱
});

test('掃描器不會因為開了地獄梗就漏掉真紅線', async () => {
  const { scanCompliance } = await import('../src/compliance.mjs');
  assert.ok(scanCompliance('這杯超解酒').length >= 1);
  assert.ok(scanCompliance('今晚不醉不歸').length >= 1);
  // 但文化梗不該被掃描器標記（它本來就沒有禁詞）
  assert.deepEqual(scanCompliance('生蠔日帶爸爸來吃，明年送你一個弟弟或妹妹'), []);
});

test('三條產出路徑都吃得到幽默尺度', async () => {
  const { buildNativePrompt, buildRedTeamPrompt } = await import('../src/native_ai.mjs');
  const { buildPolishPrompt } = await import('../src/polish.mjs');
  const { buildInboxPrompt } = await import('../src/inbox.mjs');
  const prompts = [
    buildNativePrompt({ persona: 'x', humor: 'hellish', n: 1 }),
    buildRedTeamPrompt({ text: 'x', humor: 'hellish' }),
    buildPolishPrompt({ text: 'x', humor: 'hellish' }),
    buildInboxPrompt({ reply: { username: 'a', text: 'b' }, humor: 'hellish' }),
  ];
  for (const p of prompts) assert.match(p, /地獄梗全開/);
});

test('紅隊：不准把梗改掉（只拆彈，不消毒）', async () => {
  const { buildRedTeamPrompt } = await import('../src/native_ai.mjs');
  const p = buildRedTeamPrompt({ text: 'x' });
  assert.match(p, /不要把梗改掉/);
  assert.match(p, /拆彈，不是消毒/);
});
