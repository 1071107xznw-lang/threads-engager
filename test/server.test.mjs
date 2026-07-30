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
    setupComplete: true,
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

// ── 手動回覆入口 + 批次核准 ──
test('POST /api/reply/manual 建立待審核回覆（帶 targetId）', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/reply/manual').send({ targetId: '17912345', text: '手寫回覆' });
  assert.equal(res.status, 200);
  const row = store.listByStatus('a', 'drafted').find((r) => r.id === res.body.id);
  assert.equal(row.targetId, '17912345');
  assert.equal(row.draftText, '手寫回覆');
  store.close();
});

test('POST /api/reply/manual 貼網址被擋，並提示要 media ID', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/reply/manual')
    .send({ targetId: 'https://www.threads.com/@x/post/ABC', text: '嗨' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /media ID/);
  store.close();
});

test('POST /api/reply/manual 空內容被擋（400）', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/reply/manual').send({ targetId: '123', text: '  ' });
  assert.equal(res.status, 400);
  store.close();
});

test('POST /api/reply/manual 已送出的目標貼文回 409、不復活', async () => {
  const { app, store } = setup();
  const r1 = await request(app).post('/api/reply/manual').send({ targetId: '555', text: '第一次' });
  store.setStatus(r1.body.id, 'approved');
  store.markSent(r1.body.id, '2026-07-30T10:00:00.000Z'); // 已送出
  const r2 = await request(app).post('/api/reply/manual').send({ targetId: '555', text: '再回一次' });
  assert.equal(r2.status, 409);
  assert.match(r2.body.error, /已經回覆/);
  assert.equal(store.findByTargetId('a', '555').status, 'sent', '仍是 sent，未被復活成 drafted');
  store.close();
});

test('POST /api/reply/manual 同一 targetId 更新既有草稿、清掉舊編輯', async () => {
  const { app, store } = setup();
  const r1 = await request(app).post('/api/reply/manual').send({ targetId: '777', text: '舊稿' });
  store.editDraft(r1.body.id, '人工編輯舊稿');
  const r2 = await request(app).post('/api/reply/manual').send({ targetId: '777', text: '新稿' });
  assert.equal(r2.body.id, r1.body.id);
  assert.equal(r2.body.updated, true);
  const row = store.listByStatus('a', 'drafted').find((r) => r.id === r1.body.id);
  assert.equal(row.draftText, '新稿');
  assert.equal(row.editedText, null);
  store.close();
});

test('POST /api/posts/approve-bulk 空白編輯內容不核准（跳過）', async () => {
  const { app, store, id } = setup();
  const res = await request(app).post('/api/posts/approve-bulk')
    .send({ items: [{ id, editedText: '   ' }] });
  assert.equal(res.body.approved, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(store.listByStatus('a', 'approved').length, 0);
  store.close();
});

test('POST /api/posts/approve-bulk 批次核准並保存編輯內容', async () => {
  const { app, store, id } = setup();
  const p2 = store.upsertPost({ account: 'a', threadUrl: 'u2', author: 'y', content: 'c2' });
  store.saveDraft(p2.id, '草稿2');
  const res = await request(app).post('/api/posts/approve-bulk')
    .send({ items: [{ id, editedText: '改過的' }, { id: p2.id }] });
  assert.equal(res.body.approved, 2);
  const approved = store.listByStatus('a', 'approved');
  assert.equal(approved.length, 2);
  assert.equal(approved.find((r) => r.id === id).editedText, '改過的');
  store.close();
});

test('批次核准不會把已送出的貼文重新丟回佇列（防重複回覆）', async () => {
  const { app, store, id } = setup();
  store.markSent(id, '2026-07-30T10:00:00.000Z'); // 已送出
  const res = await request(app).post('/api/posts/approve-bulk').send({ ids: [id] });
  assert.equal(res.body.approved, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(store.listByStatus('a', 'approved').length, 0);
  assert.equal(store.listByStatus('a', 'sent').length, 1);
  store.close();
});

test('單則核准同樣擋掉非 drafted 狀態', async () => {
  const { app, store, id } = setup();
  store.markSent(id, '2026-07-30T10:00:00.000Z');
  const res = await request(app).post(`/api/posts/${id}/approve`).send();
  assert.equal(res.status, 400);
  assert.equal(store.listByStatus('a', 'approved').length, 0);
  store.close();
});

// ── 原生貼文端點 ──
function nativeSetup({ dryRun = false, publishResult } = {}) {
  const store = createStore(':memory:');
  const runGenerate = async () => ({ generated: 2, ids: [1, 2], tagPosts: 3, newsTitles: 1, quotaUsed7d: 3 });
  const publish = async () => publishResult ?? { dryRun: false, id: 'p1' };
  const publishDraft = makePublishDraft({ store, publish });
  const app = createServer({
    store, setupComplete: true, accounts: [], runGenerate, publishDraft,
    getConfig: () => ({ setupComplete: true, dryRun }),
  });
  return { store, app };
}

test('POST /api/native/generate 回產生數量', async () => {
  const { app, store } = nativeSetup();
  const res = await request(app).post('/api/native/generate').send();
  assert.equal(res.body.generated, 2);
  store.close();
});

test('POST /api/native/manual 手動新增草稿進待審核', async () => {
  const { app, store } = nativeSetup();
  const res = await request(app).post('/api/native/manual').send({ text: '自己寫的貼文' });
  assert.equal(res.status, 200);
  const d = store.getNativeDraft(res.body.id);
  assert.equal(d.status, 'drafted');
  assert.equal(d.draftText, '自己寫的貼文');
  store.close();
});

test('POST /api/native/manual 空內容被擋（400）', async () => {
  const { app, store } = nativeSetup();
  const res = await request(app).post('/api/native/manual').send({ text: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /不可為空/);
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

test('makePublishDraft：已被別的發布者認領（publishing）的貼文不會再發一次', async () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.setNativeStatus(id, 'approved');
  let publishCalls = 0;
  const publish = async () => { publishCalls += 1; return { dryRun: false, id: 'p1' }; };
  const publishDraft = makePublishDraft({ store, publish });
  // 模擬另一個發布者已先認領（approved→publishing）
  assert.equal(store.claimNativeForPublish(id), true);
  await assert.rejects(() => publishDraft(id)); // 非 approved → 拒絕（不論 400/409）
  assert.equal(publishCalls, 0, '搶不到就不該再發一次');
  store.close();
});

test('makePublishDraft 失敗時轉 failed、不卡在 publishing', async () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.setNativeStatus(id, 'approved');
  const publishDraft = makePublishDraft({ store, publish: async () => { throw new Error('boom'); } });
  await assert.rejects(() => publishDraft(id), /boom/);
  assert.equal(store.getNativeDraft(id).status, 'failed');
  store.close();
});

test('單則核准擋空白（伺服器端，不只 UI）', async () => {
  const { app, store, id } = setup();
  store.editDraft(id, '   '); // 把草稿改成空白
  const res = await request(app).post(`/api/posts/${id}/approve`).send();
  assert.equal(res.status, 400);
  assert.match(res.body.error, /不可為空/);
  assert.equal(store.listByStatus('a', 'approved').length, 0);
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

test('未完成設定 → 功能路由不掛載（404），首頁給設定精靈', async () => {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: false, getConfig: () => ({ setupComplete: false }) });
  const gen = await request(app).post('/api/native/generate').send();
  assert.equal(gen.status, 404); // 功能路由未掛
  const home = await request(app).get('/');
  assert.match(home.text, /設定精靈/); // 首頁送出 setup.html
  const cfg = await request(app).get('/api/config');
  assert.equal(cfg.body.setupComplete, false);
  store.close();
});

test('DRY_RUN 切換端點呼叫 setDryRun', async () => {
  const store = createStore(':memory:');
  let val = null;
  const app = createServer({ store, setupComplete: true, getConfig: () => ({}), setDryRun: (v) => { val = v; } });
  await request(app).post('/api/config/dryrun').send({ dryRun: false });
  assert.equal(val, false);
  store.close();
});
