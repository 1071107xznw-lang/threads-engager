import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createServer, makePublishDraft } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';

function setup() {
  const store = createStore(':memory:');
  const { id } = store.upsertPost({ account: 'a', threadUrl: 'u1', author: 'x', content: 'c', likes: 9, postedAt: '2026-06-19T11:00:00.000Z' });
  store.setRelevance(id, 0.8);
  store.saveDraft(id, '草稿');
  const app = createServer({
    store,
    accounts: [{ name: 'a' }],
    runScrape: async () => ({ found: 1, kept: 1, inserted: 1 }),
    runSend: async () => ({ attempted: 1, sent: 1, skipped: 0, failed: 0 }),
  });
  return { store, app, id };
}

test('GET /api/accounts 回傳帳號', async () => {
  const { app, store } = setup();
  const res = await request(app).get('/api/accounts');
  assert.equal(res.status, 200);
  assert.equal(res.body[0].name, 'a');
  store.close();
});

test('GET /api/posts 依 status 過濾', async () => {
  const { app, store } = setup();
  const res = await request(app).get('/api/posts?account=a&status=drafted');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].draftText, '草稿');
  store.close();
});

test('POST approve 改變狀態', async () => {
  const { app, store, id } = setup();
  await request(app).post(`/api/posts/${id}/approve`).send();
  assert.equal(store.listByStatus('a', 'approved').length, 1);
  store.close();
});

test('POST /api/scrape 呼叫 runScrape', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/scrape').send({ account: 'a' });
  assert.equal(res.body.inserted, 1);
  store.close();
});

// ── 原生貼文端點 ──
function nativeSetup({ dryRun = false, publishResult } = {}) {
  const store = createStore(':memory:');
  const runGenerate = async () => ({ generated: 2, ids: [1, 2], tagPosts: 3, newsTitles: 1, quotaUsed7d: 3 });
  const publish = async () => publishResult ?? { dryRun: false, id: 'p1' };
  const publishDraft = makePublishDraft({ store, publish });
  const app = createServer({ store, accounts: [], runGenerate, publishDraft, dryRun });
  return { store, app };
}

test('POST /api/native/generate 回產生數量', async () => {
  const { app, store } = nativeSetup();
  const res = await request(app).post('/api/native/generate').send();
  assert.equal(res.body.generated, 2);
  store.close();
});

test('未核准的草稿不能發布（400）', async () => {
  const { app, store } = nativeSetup();
  const id = store.insertNativeDraft({ draftText: '稿' }); // status=drafted
  const res = await request(app).post(`/api/native/${id}/publish`).send();
  assert.equal(res.status, 400);
  assert.match(res.body.error, /已核准/);
  store.close();
});

test('核准後可發布並記錄 postId', async () => {
  const { app, store } = nativeSetup({ publishResult: { dryRun: false, id: 'post999' } });
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.setNativeStatus(id, 'approved');
  const res = await request(app).post(`/api/native/${id}/publish`).send();
  assert.equal(res.body.id, 'post999');
  assert.equal(store.getNativeDraft(id).status, 'published');
  store.close();
});

test('DRY_RUN 發布回 dryRun 且不標記 published', async () => {
  const { app, store } = nativeSetup({ publishResult: { dryRun: true } });
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.setNativeStatus(id, 'approved');
  const res = await request(app).post(`/api/native/${id}/publish`).send();
  assert.equal(res.body.dryRun, true);
  assert.equal(store.getNativeDraft(id).status, 'approved');
  store.close();
});

test('GET /api/config 回傳 dryRun', async () => {
  const { app, store } = nativeSetup({ dryRun: true });
  const res = await request(app).get('/api/config');
  assert.equal(res.body.dryRun, true);
  store.close();
});
