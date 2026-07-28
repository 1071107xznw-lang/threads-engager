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
