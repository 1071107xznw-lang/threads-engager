import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { findAndDraft } from '../src/reply_pipeline.mjs';

const settings = { userId: '1', appSecret: 's', apiBase: 'https://graph.threads.net', dryRun: false };
const brand = { tags: ['調酒'], perTagPosts: 8, searchCap7d: 400, replyPersona: 'p', replyThreshold: 0.6, replyPerRun: 15 };

function fakeApi(candidatesByQ) {
  return {
    async getProfile() { return { id: '1', username: 'argotaipei' }; },
    async keywordSearch({ q }) { return { data: candidatesByQ[q] || [] }; },
  };
}

test('findAndDraft：找候選→存 targetId→過門檻產草稿／未過略過→濾掉自己', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({
    調酒: [
      { id: 'M1', text: '推薦一間好喝的調酒吧', username: 'bob', permalink: 'https://x/1' },
      { id: 'M2', text: '今天喝多了頭好痛', username: 'ann', permalink: 'https://x/2' },
      { id: 'M3', text: '這是自己的貼文', username: 'argotaipei', permalink: 'https://x/3' },
    ],
  });
  // runner：含「推薦一間」給高分產草稿，否則低分
  const runner = async (prompt) =>
    prompt.includes('推薦一間')
      ? '{"score":0.9,"draft":"這間聽起來不錯欸，改天去喝喝看🍸"}'
      : '{"score":0.2,"draft":"略"}';

  const res = await findAndDraft({ settings, brand, store, accessToken: 't', account: 'argo', api, runner, log: () => {} });

  assert.equal(res.candidates, 2); // M3（自己）被濾
  assert.equal(res.inserted, 2);
  assert.equal(res.drafted, 1); // M1 過門檻
  assert.equal(res.skipped, 1); // M2 未過

  const drafted = store.listByStatus('argo', 'drafted');
  assert.equal(drafted.length, 1);
  assert.equal(drafted[0].targetId, 'M1'); // targetId 有存，供 reply_to_id
  assert.match(drafted[0].draftText, /不錯/);
  store.close();
});

test('findAndDraft：全自動只到產草稿，不會產生 approved/sent', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({ 調酒: [{ id: 'M1', text: '推薦調酒', username: 'bob', permalink: 'https://x/1' }] });
  const runner = async () => '{"score":0.9,"draft":"讚"}';
  await findAndDraft({ settings, brand, store, accessToken: 't', account: 'argo', api, runner, log: () => {} });
  assert.equal(store.listByStatus('argo', 'approved').length, 0, '自動流程不得自行核准');
  assert.equal(store.listByStatus('argo', 'sent').length, 0, '自動流程不得自行送出');
  assert.equal(store.listByStatus('argo', 'drafted').length, 1);
  store.close();
});

test('findAndDraft：額度快用完時整輪跳過搜尋（不撞頂）', async () => {
  const store = createStore(':memory:');
  const now = '2026-07-30T12:00:00.000Z';
  // cap 100，已用 98 → 剩 2，不足以分配到任何 tag
  for (let i = 0; i < 98; i += 1) store.logSearch('q' + i, now);
  let searched = 0;
  const api = {
    async getProfile() { return { id: '1', username: 'argotaipei' }; },
    async keywordSearch() { searched += 1; return { data: [] }; },
  };
  const res = await findAndDraft({
    settings, brand: { ...brand, searchCap7d: 100 }, store, accessToken: 't',
    account: 'argo', api, runner: async () => '{"score":0,"draft":""}', nowIso: now, log: () => {},
  });
  assert.equal(res.skippedForQuota, true);
  assert.equal(res.plannedTags, 0);
  assert.equal(searched, 0, '額度不足時不應打任何搜尋 API');
  store.close();
});

test('findAndDraft：額度感知限制本輪 tag 數', async () => {
  const store = createStore(':memory:');
  const now = '2026-07-30T12:00:00.000Z';
  const tags = Array.from({ length: 40 }, (_, i) => 'tag' + i);
  const searchedQs = [];
  const api = {
    async getProfile() { return { id: '1', username: 'me' }; },
    async keywordSearch({ q }) { searchedQs.push(q); return { data: [] }; },
  };
  // 剩 500、28 輪、保留 10% → 每輪 16 個 tag（而不是全部 40 個）
  const res = await findAndDraft({
    settings, brand: { ...brand, tags, searchCap7d: 500 }, store, accessToken: 't',
    account: 'argo', api, runner: async () => '{"score":0,"draft":""}',
    runsPer7d: 28, nowIso: now, log: () => {},
  });
  assert.equal(res.plannedTags, 16);
  assert.equal(searchedQs.length, 16, '應只搜配額內的 tag 數');
  store.close();
});
