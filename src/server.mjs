import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { scrapeAccount } from './scraper.mjs';
import { sendReplies } from './sender.mjs';
import { scoreAndDraft } from './ai.mjs';
import { loadEnvFile, loadSettings } from './env.mjs';
import { loadBrand } from './brand.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText } from './threads_publish.mjs';
import { runGeneration } from './native_generate.mjs';

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

  // 舊的多帳號 config 可能不存在（重構中）；缺檔就空陣列，dashboard 照開。
  let accounts = [];
  try {
    accounts = loadConfig(join(__dirname, '..', 'config', 'accounts.json'));
  } catch {
    console.warn('（無 config/accounts.json，回覆審核佇列停用，原生貼文功能不受影響）');
  }
  const byName = (name) => accounts.find((a) => a.name === name);

  const runScrape = async (name) => {
    const account = byName(name);
    if (!account) throw new Error('帳號不存在');
    const result = await scrapeAccount(account, { store });
    for (const row of store.listByStatus(name, 'new')) {
      const r = await scoreAndDraft({
        post: { author: row.author, content: row.content, likes: row.likes },
        persona: account.persona,
        threshold: account.relevanceThreshold,
      });
      store.setRelevance(row.id, r.score);
      if (r.draft) store.saveDraft(row.id, r.draft);
      else store.setStatus(row.id, 'skipped');
    }
    return result;
  };
  const runSend = async (name) => {
    const account = byName(name);
    if (!account) throw new Error('帳號不存在');
    return sendReplies(account, { store });
  };

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
