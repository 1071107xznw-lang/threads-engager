import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStore } from './store.mjs';
import { loadEnvFile, loadSettings } from './env.mjs';
import { loadBrand } from './brand.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText } from './threads_publish.mjs';
import { runGeneration } from './native_generate.mjs';
import { findAndDraft } from './reply_pipeline.mjs';
import { sendApprovedReplies } from './threads_reply.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 把「發布一則已核准的原生草稿」包成可注入的函式（守門：只有 approved 可發）。
export function makePublishDraft({ store, publish }) {
  return async (id) => {
    const d = store.getNativeDraft(Number(id));
    if (!d) { const e = new Error('找不到草稿'); e.status = 404; throw e; }
    if (d.status !== 'approved') {
      const e = new Error('只有「已核准」的草稿可以發布'); e.status = 400; throw e;
    }
    const text = d.editedText || d.draftText;
    const res = await publish({ text });
    if (res.dryRun) return { dryRun: true, text };
    store.markNativePublished(Number(id), res.id);
    return { dryRun: false, id: res.id };
  };
}

export function createServer({
  store,
  accounts = [],
  runScrape,
  runSend,
  runGenerate,
  publishDraft,
  dryRun = false,
}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
  };

  app.get('/api/config', (req, res) => res.json({ dryRun }));

  // ── 既有：回覆別人貼文的審核佇列（原樣保留）──
  app.get('/api/accounts', (req, res) => res.json(accounts.map((a) => ({ name: a.name }))));
  app.get('/api/posts', (req, res) => {
    const { account, status = 'drafted' } = req.query;
    res.json(store.listByStatus(account, status));
  });
  app.post('/api/scrape', wrap((req) => runScrape(req.body.account)));
  app.post('/api/send', wrap((req) => runSend(req.body.account)));
  app.post('/api/posts/:id/draft', (req, res) => {
    store.editDraft(Number(req.params.id), req.body.editedText);
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/approve', (req, res) => {
    store.setStatus(Number(req.params.id), 'approved');
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/skip', (req, res) => {
    store.setStatus(Number(req.params.id), 'skipped');
    res.json({ ok: true });
  });

  // ── 新：Argo 原生貼文 產稿→審核→發布 ──
  app.post('/api/native/generate', wrap(() => runGenerate()));
  app.get('/api/native/drafts', (req, res) => {
    res.json(store.listNativeByStatus(req.query.status || 'drafted'));
  });
  app.post('/api/native/:id/draft', (req, res) => {
    store.editNativeDraft(Number(req.params.id), req.body.editedText);
    res.json({ ok: true });
  });
  app.post('/api/native/:id/approve', (req, res) => {
    store.setNativeStatus(Number(req.params.id), 'approved');
    res.json({ ok: true });
  });
  app.post('/api/native/:id/skip', (req, res) => {
    store.setNativeStatus(Number(req.params.id), 'skipped');
    res.json({ ok: true });
  });
  app.post('/api/native/:id/publish', wrap((req) => publishDraft(Number(req.params.id))));

  return app;
}

// ── 直接啟動：組裝真實依賴並監聽 ──
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFile(join(__dirname, '..', '.env'));
  const settings = loadSettings();
  const brand = loadBrand(join(__dirname, '..', 'config', 'argo.json'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
  const { accessToken } = getActiveToken({ store, settings });

  // 單一品牌帳號（不再需要多帳號 accounts.json）。
  const ACCOUNT = 'argo';
  const accounts = [{ name: ACCOUNT }];

  // 搜候選串→評分→產回覆草稿（全自動只到草稿）
  const runScrape = () => findAndDraft({ settings, brand, store, accessToken, api, account: ACCOUNT });
  // 送出「已核准」的回覆（唯一對外送出點，只送 approved）
  const runSend = () =>
    sendApprovedReplies({ settings, store, accessToken, api, account: ACCOUNT, dailyCap: brand.replyDailyCap });

  const runGenerate = () => runGeneration({ settings, brand, store, accessToken, api });
  const publishDraft = makePublishDraft({
    store,
    publish: ({ text }) => publishText({ settings, accessToken, text, api }),
  });

  const app = createServer({
    store, accounts, runScrape, runSend, runGenerate, publishDraft, dryRun: settings.dryRun,
  });
  app.listen(4321, () => {
    console.log('Dashboard: http://localhost:4321' + (settings.dryRun ? '　[DRY_RUN 乾跑中]' : ''));
  });
}
