import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSendable, humanDelay, sendReplies } from '../src/sender.mjs';
import { createStore } from '../src/store.mjs';

test('pickSendable 受 dailyCap 限制', () => {
  const approved = [{ id: 1, author: 'a' }, { id: 2, author: 'b' }, { id: 3, author: 'c' }];
  const r = pickSendable({ approved, sentToday: 1, dailyCap: 2, recentAuthors: new Set() });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test('pickSendable 過濾窗口內已回作者與同批重複作者', () => {
  const approved = [{ id: 1, author: 'a' }, { id: 2, author: 'a' }, { id: 3, author: 'b' }];
  const r = pickSendable({ approved, sentToday: 0, dailyCap: 10, recentAuthors: new Set(['b']) });
  assert.deepEqual(r.map((x) => x.id), [1]);
});

test('humanDelay 落在區間內', () => {
  assert.equal(humanDelay(1000, 2000, () => 0.5), 1500);
});

test('sendReplies dryRun 不呼叫 postReply 但回報', async () => {
  const store = createStore(':memory:');
  const { id } = store.upsertPost({ account: 'a', threadUrl: 'u1', author: 'x', content: 'c', likes: 9, postedAt: '2026-06-19T11:00:00.000Z' });
  store.saveDraft(id, '草稿');
  store.setStatus(id, 'approved');
  let called = 0;
  const r = await sendReplies(
    { name: 'a', profilePath: './p', dailyCap: 5 },
    {
      store,
      openContext: async () => ({ context: { close: async () => {} }, page: {} }),
      postReply: async () => { called += 1; },
      dryRun: true,
      rng: () => 0.5,
      sleep: async () => {},
      nowIso: '2026-06-19T12:00:00.000Z',
    }
  );
  assert.equal(called, 0);
  assert.equal(r.attempted, 1);
  store.close();
});
