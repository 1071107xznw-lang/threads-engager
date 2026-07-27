import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPosts, scrapeAccount } from '../src/scraper.mjs';
import { createStore } from '../src/store.mjs';

const nowMs = Date.parse('2026-06-19T12:00:00.000Z');
const posts = [
  { threadUrl: 'u1', author: 'a', content: 'x', likes: 10, postedAt: '2026-06-19T11:00:00.000Z' },
  { threadUrl: 'u2', author: 'b', content: 'y', likes: 1, postedAt: '2026-06-19T11:00:00.000Z' },
  { threadUrl: 'u3', author: 'c', content: 'z', likes: 99, postedAt: '2026-06-10T00:00:00.000Z' },
];

test('filterPosts 過濾讚數與時效', () => {
  const kept = filterPosts(posts, { recencyHours: 48, minLikes: 5, nowMs });
  assert.deepEqual(kept.map((p) => p.threadUrl), ['u1']);
});

test('scrapeAccount 套篩選並寫入 store', async () => {
  const store = createStore(':memory:');
  const account = {
    name: 'a', profilePath: './p', tags: ['#t'],
    filters: { recencyHours: 48, minLikes: 5 },
  };
  const fakeContext = { close: async () => {} };
  const openContext = async () => ({ context: fakeContext, page: {} });
  const extractPosts = async () => posts;
  const r = await scrapeAccount(account, { store, openContext, extractPosts, dryRun: false, nowMs });
  assert.equal(r.found, 3);
  assert.equal(r.kept, 1);
  assert.equal(r.inserted, 1);
  store.close();
});
