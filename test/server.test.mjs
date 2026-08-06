import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'node:events';
import { createServer, makePublishDraft, listenWithFallback } from '../src/server.mjs';
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

// ── 登入密碼（Basic Auth）──
function authApp() {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: true, getConfig: () => ({ ok: true }), password: 'p@ss' });
  return { store, app };
}

test('設密碼後：未帶認證回 401 + WWW-Authenticate', async () => {
  const { app, store } = authApp();
  const res = await request(app).get('/api/config');
  assert.equal(res.status, 401);
  assert.match(res.headers['www-authenticate'] || '', /Basic/);
  store.close();
});

test('設密碼後：正確密碼可通過', async () => {
  const { app, store } = authApp();
  const res = await request(app).get('/api/config').auth('anyuser', 'p@ss');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  store.close();
});

test('設密碼後：錯誤密碼回 401', async () => {
  const { app, store } = authApp();
  const res = await request(app).get('/api/config').auth('anyuser', 'wrong');
  assert.equal(res.status, 401);
  store.close();
});

test('沒設密碼：維持免登入（本機行為不變）', async () => {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: true, getConfig: () => ({ ok: true }) });
  const res = await request(app).get('/api/config');
  assert.equal(res.status, 200);
  store.close();
});

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

// ── 建議主題 ──
test('POST /api/native/suggest-topic 回傳 AI 建議主題', async () => {
  const store = createStore(':memory:');
  const app = createServer({
    store, setupComplete: true, getConfig: () => ({}),
    suggestTopic: async ({ text }) => (text.includes('調酒') ? '調酒' : null),
  });
  const res = await request(app).post('/api/native/suggest-topic').send({ text: '來杯調酒' });
  assert.equal(res.status, 200);
  assert.equal(res.body.topic, '調酒');
  const empty = await request(app).post('/api/native/suggest-topic').send({ text: '無關' });
  assert.equal(empty.body.topic, ''); // 想不到 → 空字串
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

// ── listen 綁不上就退回本機 ───────────────────────────────────
// 真實情境：HOST 綁了 Tailscale 的 100.x，Tailscale 沒開 → 那個 IP 不在機器上
// → listen 噴 EADDRNOTAVAIL → 行程死 → launchd 拉起來 → 再死。無聲重啟迴圈。
// 這裡用 192.0.2.1（RFC 5737 TEST-NET-1，保證不會被指派）穩定重現。
const UNAVAILABLE = '192.0.2.1';

function tinyApp() {
  return express().get('/', (_req, res) => res.send('ok'));
}

test('listenWithFallback：綁得上就用指定介面，不退回', async () => {
  const { server, host, fellBack } = await listenWithFallback({
    app: tinyApp(), port: 0, host: '127.0.0.1', warn: () => {},
  });
  assert.equal(host, '127.0.0.1');
  assert.equal(fellBack, false);
  server.close();
});

test('listenWithFallback：綁不上時退回 127.0.0.1 而不是讓行程死掉', async () => {
  const warnings = [];
  const { server, host, fellBack } = await listenWithFallback({
    app: tinyApp(), port: 0, host: UNAVAILABLE, warn: (m) => warnings.push(m),
  });
  assert.equal(host, '127.0.0.1');
  assert.equal(fellBack, true);
  // 退回這件事必須大聲講，否則使用者只看到「連不到」、原因埋在日誌裡。
  const all = warnings.join('\n');
  assert.match(all, /綁不上/);
  assert.match(all, /已退回 127\.0\.0\.1/);
  server.close();
});

test('listenWithFallback：綁 Tailscale IP 失敗時，警告要點名 Tailscale', async () => {
  const warnings = [];
  const { server } = await listenWithFallback({
    app: tinyApp(), port: 0, host: '100.88.137.107', warn: (m) => warnings.push(m),
  });
  assert.match(warnings.join('\n'), /Tailscale 沒開/);
  server.close();
});

test('listenWithFallback：埠被佔（EADDRINUSE）照樣丟出來，不可以偷偷退回', async () => {
  // 退回只會蓋掉真正的埠衝突——那是另一個問題，要讓它爆出來。
  const first = await listenWithFallback({
    app: tinyApp(), port: 0, host: '127.0.0.1', warn: () => {},
  });
  const busyPort = first.server.address().port;
  await assert.rejects(
    () => listenWithFallback({ app: tinyApp(), port: busyPort, host: '127.0.0.1', warn: () => {} }),
    (e) => e.code === 'EADDRINUSE'
  );
  first.server.close();
});

test('DELETE /api/native/:id 刪掉待發布的草稿', async () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '不想發了' });
  store.setNativeStatus(id, 'approved');
  const app = createServer({ store, setupComplete: true, getConfig: () => ({}) });
  const res = await request(app).delete(`/api/native/${id}`);
  assert.equal(res.status, 200);
  assert.equal(store.getNativeDraft(id), null);
  store.close();
});

test('DELETE /api/native/:id 擋掉已發布的，並說清楚為什麼', async () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '已經發出去了' });
  store.markNativePublished(id, 'post_1');
  const app = createServer({ store, setupComplete: true, getConfig: () => ({}) });
  const res = await request(app).delete(`/api/native/${id}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /紀錄/);
  assert.ok(store.getNativeDraft(id));
  store.close();
});

// 綁「真的存在的非本機介面」在測試機上不可攜（每台機器 IP 不同），
// 所以用假的 app 記錄 listen 呼叫，測的是決策邏輯本身。
function recordingApp(failFor = () => null) {
  const calls = [];
  return {
    calls,
    listen(port, host) {
      calls.push(host);
      const em = new EventEmitter();
      em.close = () => {};
      queueMicrotask(() => {
        const code = failFor(host);
        if (code) em.emit('error', Object.assign(new Error(code), { code }));
        else em.emit('listening');
      });
      return em;
    },
  };
}

test('listenWithFallback：綁非本機介面時，額外再綁一個 127.0.0.1', async () => {
  // 只綁 Tailscale IP 的話，這台機器自己反而連不到 localhost——錄影/自用都會卡。
  const app = recordingApp();
  const r = await listenWithFallback({ app, port: 4321, host: '100.119.253.93', warn: () => {} });
  assert.deepEqual(app.calls, ['100.119.253.93', '127.0.0.1']);
  assert.equal(r.host, '100.119.253.93');
  assert.equal(r.alsoLocal, true);
});

test('listenWithFallback：已經是本機或萬用位址就不重複綁', async () => {
  for (const h of ['127.0.0.1', '0.0.0.0']) {
    const app = recordingApp();
    const r = await listenWithFallback({ app, port: 4321, host: h, warn: () => {} });
    assert.deepEqual(app.calls, [h], `${h} 不該多綁一次`);
    assert.equal(r.alsoLocal, false);
  }
});

test('listenWithFallback：額外綁本機失敗，不可以連累主要服務', async () => {
  // 127.0.0.1:port 被別的東西佔住時，Tailscale 那條還是要活著。
  const warnings = [];
  const app = recordingApp((h) => (h === '127.0.0.1' ? 'EADDRINUSE' : null));
  const r = await listenWithFallback({
    app, port: 4321, host: '100.119.253.93', warn: (m) => warnings.push(m),
  });
  assert.equal(r.host, '100.119.253.93');
  assert.equal(r.alsoLocal, false);
  assert.match(warnings.join('\n'), /沒綁上.*EADDRINUSE/s);
});

test('listenWithFallback：退回本機之後不會再多綁一次本機', async () => {
  const app = recordingApp((h) => (h === '192.0.2.1' ? 'EADDRNOTAVAIL' : null));
  const r = await listenWithFallback({ app, port: 4321, host: '192.0.2.1', warn: () => {} });
  assert.deepEqual(app.calls, ['192.0.2.1', '127.0.0.1']);
  assert.equal(r.fellBack, true);
  assert.equal(r.alsoLocal, false);
});

// ── HOST=tailscale 自動抓位址 ──────────────────────────
// 起因：Tailscale 重新登入會換發 IP（實際踩過 .107 → .93），.env 寫死就會某天突然
// 「手機連不到」，而原因埋在日誌裡。

test('isTailscaleIPv4：只認 CGNAT 100.64.0.0/10，不是所有 100.x', async () => {
  const { isTailscaleIPv4 } = await import('../src/server.mjs');
  // 真的是 Tailscale 的
  for (const ok of ['100.64.0.1', '100.127.255.255', '100.119.253.93', '100.88.137.107']) {
    assert.equal(isTailscaleIPv4(ok), true, ok);
  }
  // 100.x 但不在 CGNAT 區段——這些是一般公網位址，抓錯會綁到不該綁的介面
  for (const no of ['100.63.255.255', '100.128.0.1', '100.5.5.5', '100.200.1.1']) {
    assert.equal(isTailscaleIPv4(no), false, no);
  }
  for (const no of ['192.168.1.120', '127.0.0.1', '10.0.0.1', '', null, undefined, 'tailscale']) {
    assert.equal(isTailscaleIPv4(no), false, String(no));
  }
});

test('resolveHost：不是 tailscale 就原樣回傳', async () => {
  const { resolveHost } = await import('../src/server.mjs');
  const never = () => { throw new Error('不該去列舉網路介面'); };
  for (const h of ['0.0.0.0', '127.0.0.1', '100.119.253.93']) {
    assert.equal(resolveHost(h, { interfaces: never }), h);
  }
});

test('resolveHost：HOST=tailscale 抓出當下的 Tailscale 位址', async () => {
  const { resolveHost } = await import('../src/server.mjs');
  const interfaces = () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', address: '192.168.1.120' }],
    utun3: [{ family: 'IPv6', address: 'fd7a:115c:a1e0::1' },
            { family: 'IPv4', address: '100.119.253.93' }],
  });
  assert.equal(resolveHost('tailscale', { interfaces, warn: () => {} }), '100.119.253.93');
  // 大小寫與空白都要吃
  assert.equal(resolveHost('  TailScale ', { interfaces, warn: () => {} }), '100.119.253.93');
});

test('resolveHost：Tailscale 沒開 → 退回本機並說清楚，不是丟錯', async () => {
  const { resolveHost } = await import('../src/server.mjs');
  const warnings = [];
  const interfaces = () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', address: '192.168.1.120' }],
  });
  assert.equal(resolveHost('tailscale', { interfaces, warn: (m) => warnings.push(m) }), '127.0.0.1');
  const all = warnings.join('\n');
  assert.match(all, /找不到 Tailscale 位址/);
  assert.match(all, /把 Tailscale 打開再重啟服務/);
});

test('resolveHost：不會把非 CGNAT 的 100.x 誤認成 Tailscale', async () => {
  const { resolveHost } = await import('../src/server.mjs');
  const interfaces = () => ({ en0: [{ family: 'IPv4', address: '100.200.1.1' }] });
  assert.equal(resolveHost('tailscale', { interfaces, warn: () => {} }), '127.0.0.1');
});

test('resolveHost：網路介面列舉回空值也不能爆', async () => {
  const { resolveHost } = await import('../src/server.mjs');
  assert.equal(resolveHost('tailscale', { interfaces: () => null, warn: () => {} }), '127.0.0.1');
  assert.equal(resolveHost('tailscale', { interfaces: () => ({ en0: null }), warn: () => {} }), '127.0.0.1');
});

// ── 🔄 原生貼文：單則重新生成 ──
function regenApp({ regenerateOne } = {}) {
  const store = createStore(':memory:');
  const app = createServer({
    store,
    setupComplete: true,
    accounts: [{ name: 'a' }],
    regenerateOne: regenerateOne || (async () => ({
      text: '重生後的內容', angle: '新切入點', topic: '新主題', reviewNote: '',
    })),
  });
  return { store, app };
}

test('重新生成：換掉內容，並回傳新的那一則', async () => {
  const { app, store } = regenApp();
  const id = store.insertNativeDraft({ draftText: '原本的爛稿', angle: '舊切入點', goal: 'story' });
  const res = await request(app).post(`/api/native/${id}/regenerate`).send({ reason: '太像廣告' });
  assert.equal(res.status, 200);
  assert.equal(res.body.draftText, '重生後的內容');
  assert.equal(store.getNativeDraft(id).draftText, '重生後的內容');
  store.close();
});

test('重新生成：分工（goal）不能被換掉', async () => {
  const { app, store } = regenApp();
  const id = store.insertNativeDraft({ draftText: '舊的', goal: 'story' });
  await request(app).post(`/api/native/${id}/regenerate`).send({});
  assert.equal(store.getNativeDraft(id).goal, 'story');
  store.close();
});

test('重新生成：原本的 goal 與被打回的內容要傳給產稿端', async () => {
  const seen = [];
  const { app, store } = regenApp({
    regenerateOne: async (args) => { seen.push(args); return { text: '新的' }; },
  });
  const id = store.insertNativeDraft({ draftText: '舊的', goal: 'share' });
  store.editNativeDraft(id, '我手改過的版本');
  await request(app).post(`/api/native/${id}/regenerate`).send({ reason: '梗太冷' });
  // 要拿「使用者眼前看到的那一版」去避開，不是原始 draftText
  assert.deepEqual(seen, [{ previousText: '我手改過的版本', goal: 'share', reason: '梗太冷' }]);
  store.close();
});

test('🔴 重新生成：手改過的 editedText 一定要被清掉', async () => {
  // 渲染與發布走的都是 editedText || draftText。留著的話新稿會被舊的手改內容蓋住，
  // 使用者看到的是「按了沒反應」。
  const { app, store } = regenApp();
  const id = store.insertNativeDraft({ draftText: '舊的' });
  store.editNativeDraft(id, '我手改過的版本');
  await request(app).post(`/api/native/${id}/regenerate`).send({});
  const row = store.getNativeDraft(id);
  assert.equal(row.editedText, null);
  assert.equal(row.editedText || row.draftText, '重生後的內容');
  store.close();
});

test('重新生成：只有待審的能重生，已核准/已發布要擋', async () => {
  const { app, store } = regenApp();
  for (const [status, pattern] of [
    ['approved', /已經核准/],
    ['publishing', /正在發布中/],
    ['published', /不能重新生成/],
    ['skipped', /已經略過/],
  ]) {
    const id = store.insertNativeDraft({ draftText: '內容' });
    store.setNativeStatus(id, status);
    const res = await request(app).post(`/api/native/${id}/regenerate`).send({});
    assert.equal(res.status, 400, `${status} 應該被擋`);
    assert.match(res.body.error, pattern);
    assert.equal(store.getNativeDraft(id).draftText, '內容', `${status} 的內容不該被動到`);
  }
  store.close();
});

test('重新生成：找不到的 id 回 404', async () => {
  const { app, store } = regenApp();
  const res = await request(app).post('/api/native/99999/regenerate').send({});
  assert.equal(res.status, 404);
  store.close();
});

// ── 🚀 核准並發布（一鍵）──
function apPublishApp({ publish } = {}) {
  const store = createStore(':memory:');
  const sent = [];
  const app = createServer({
    store,
    setupComplete: true,
    accounts: [{ name: 'a' }],
    publishDraft: makePublishDraft({
      store,
      publish: publish || (async ({ text }) => { sent.push(text); return { id: 'p1' }; }),
    }),
  });
  return { store, app, sent };
}

test('核准並發布：一次到位，狀態變 published', async () => {
  const { app, store, sent } = apPublishApp();
  const id = store.insertNativeDraft({ draftText: '要發的內容' });
  const res = await request(app).post(`/api/native/${id}/approve-publish`).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(sent, ['要發的內容']);
  const row = store.getNativeDraft(id);
  assert.equal(row.status, 'published');
  assert.equal(row.publishedPostId, 'p1');
  store.close();
});

test('核准並發布：帶主題，且以框裡的手改內容為準', async () => {
  const { app, store, sent } = apPublishApp();
  const id = store.insertNativeDraft({ draftText: '原稿' });
  store.editNativeDraft(id, '我改過的版本');
  await request(app).post(`/api/native/${id}/approve-publish`).send({ topic: '調酒' });
  assert.deepEqual(sent, ['我改過的版本']);
  assert.equal(store.getNativeDraft(id).topic, '調酒');
  store.close();
});

test('核准並發布：只吃待審核，已核准/已發布要擋', async () => {
  const { app, store, sent } = apPublishApp();
  for (const status of ['approved', 'published', 'publishing', 'skipped']) {
    const id = store.insertNativeDraft({ draftText: '內容' });
    store.setNativeStatus(id, status);
    const res = await request(app).post(`/api/native/${id}/approve-publish`).send({});
    assert.equal(res.status, 400, `${status} 應該被擋`);
    assert.match(res.body.error, /只有「待審核」/);
  }
  assert.deepEqual(sent, [], '一則都不該送出去');
  store.close();
});

test('核准並發布：發布失敗要標成 failed，不能卡在 approved 假裝還沒發', async () => {
  const { app, store } = apPublishApp({ publish: async () => { throw new Error('API 掛了'); } });
  const id = store.insertNativeDraft({ draftText: '內容' });
  const res = await request(app).post(`/api/native/${id}/approve-publish`).send({});
  assert.equal(res.status, 500);
  assert.equal(store.getNativeDraft(id).status, 'failed');
  store.close();
});

test('核准並發布：找不到的 id 回 404', async () => {
  const { app, store } = apPublishApp();
  assert.equal((await request(app).post('/api/native/99999/approve-publish').send({})).status, 404);
  store.close();
});

// ── ⏰ 全部排程 ──
test('全部排程：核准 + 照各自的時間排，並存下手改的內容', async () => {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: true, accounts: [{ name: 'a' }] });
  const a = store.insertNativeDraft({ draftText: '甲' });
  const b = store.insertNativeDraft({ draftText: '乙' });
  const res = await request(app).post('/api/native/schedule-all').send({
    items: [
      { id: a, text: '甲（改過）', topic: '調酒', scheduledAt: '2026-08-10T21:00:00.000Z' },
      { id: b, text: '乙', scheduledAt: '2026-08-10T22:00:00.000Z' },
    ],
  });
  assert.equal(res.body.scheduled, 2);
  const ra = store.getNativeDraft(a);
  assert.equal(ra.status, 'approved');
  assert.equal(ra.editedText, '甲（改過）');
  assert.equal(ra.topic, '調酒');
  assert.equal(ra.scheduledAt, '2026-08-10T21:00:00.000Z');
  store.close();
});

test('全部排程：壞掉的那幾則要跳過並回報，不能拖垮整批', async () => {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: true, accounts: [{ name: 'a' }] });
  const ok = store.insertNativeDraft({ draftText: '好的' });
  const done = store.insertNativeDraft({ draftText: '已發過' });
  store.setNativeStatus(done, 'published');
  const res = await request(app).post('/api/native/schedule-all').send({
    items: [
      { id: ok, text: '好的', scheduledAt: '2026-08-10T21:00:00.000Z' },
      { id: done, text: 'x', scheduledAt: '2026-08-10T22:00:00.000Z' },
      { id: 99999, text: 'x', scheduledAt: '2026-08-10T23:00:00.000Z' },
      { id: ok, text: 'y', scheduledAt: '亂打的' },
    ],
  });
  assert.equal(res.body.scheduled, 1);
  assert.equal(res.body.skipped.length, 3);
  assert.match(res.body.skipped.map((s) => s.why).join('|'), /published|找不到|沒有排程時間/);
  store.close();
});

test('全部排程：超過 500 字的那則要跳過，不能把超長內容排進去', async () => {
  const store = createStore(':memory:');
  const app = createServer({ store, setupComplete: true, accounts: [{ name: 'a' }] });
  const id = store.insertNativeDraft({ draftText: '短的' });
  const res = await request(app).post('/api/native/schedule-all').send({
    items: [{ id, text: '長'.repeat(501), scheduledAt: '2026-08-10T21:00:00.000Z' }],
  });
  assert.equal(res.body.scheduled, 0);
  assert.match(res.body.skipped[0].why, /500/);
  assert.equal(store.getNativeDraft(id).status, 'drafted', '沒排成功就不該改狀態');
  store.close();
});
