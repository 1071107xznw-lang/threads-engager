import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createStore } from './store.mjs';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { loadBrand, resolveBrandPath } from './brand.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText } from './threads_publish.mjs';
import { runGeneration } from './native_generate.mjs';
import { findAndDraft } from './reply_pipeline.mjs';
import { sendApprovedReplies } from './threads_reply.mjs';
import { mountSetupRoutes } from './setup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

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
  configDir,
  apiBase = 'https://graph.threads.net',
  getConfig = () => ({}),
  setDryRun,
  setupComplete = false,
  accounts = [],
  runScrape,
  runSend,
  runGenerate,
  publishDraft,
}) {
  const app = express();
  app.use(express.json());

  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
  };

  // 設定精靈路由永遠可用（允許重新設定）
  mountSetupRoutes(app, { store, configDir, apiBase });

  app.get('/api/config', (req, res) => res.json(getConfig()));
  if (setDryRun) {
    app.post('/api/config/dryrun', (req, res) => {
      const on = Boolean(req.body?.dryRun);
      setDryRun(on);
      res.json({ ok: true, dryRun: on });
    });
  }

  // ── 功能路由：僅在完成設定時掛載 ──
  if (setupComplete) {
    // 回覆審核佇列
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

    // 原生貼文 產稿→審核→發布
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
  }

  // 首頁：未完成設定 → 導到精靈；完成 → dashboard
  app.get('/', (req, res) => {
    res.sendFile(join(PUBLIC, setupComplete ? 'index.html' : 'setup.html'));
  });
  app.use(express.static(PUBLIC, { index: false }));

  return app;
}

// ── 直接啟動：組裝真實依賴並監聽 ──
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configDir = join(__dirname, '..', 'config');
  loadEnvFile(join(__dirname, '..', '.env'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  const settings = resolveSettings({ store });
  const brand = loadBrand(resolveBrandPath(configDir, existsSync));

  // DRY_RUN：以 DB 設定為準（網頁可切換）；首次以 settings.dryRun 種入
  if (store.getSetting('dryRun') == null) store.setSetting('dryRun', settings.dryRun ? '1' : '0');
  const dryRunNow = () => store.getSetting('dryRun') === '1';
  const setDryRun = (on) => store.setSetting('dryRun', on ? '1' : '0');

  const getConfig = () => {
    const tok = store.getToken();
    const tokenExpiresInDays = tok?.expiresAt
      ? Math.round((Date.parse(tok.expiresAt) - Date.now()) / 86400000)
      : null;
    return {
      setupComplete: settings.setupComplete,
      brandName: brand.brandName || '',
      username: store.getSetting('username') || null,
      dryRun: dryRunNow(),
      tokenExpiresInDays,
      liveMode: Boolean(brand.useThreadsSearch),
    };
  };

  let handlers = {};
  if (settings.setupComplete) {
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const { accessToken } = getActiveToken({ store, settings });
    const ACCOUNT = 'me';
    handlers = {
      accounts: [{ name: ACCOUNT }],
      runScrape: () => findAndDraft({ settings, brand, store, accessToken, api, account: ACCOUNT }),
      runSend: () => sendApprovedReplies({
        settings, store, accessToken, api, account: ACCOUNT,
        dailyCap: brand.replyDailyCap, dryRun: dryRunNow(),
      }),
      runGenerate: () => runGeneration({ settings, brand, store, accessToken, api }),
      publishDraft: makePublishDraft({
        store,
        publish: ({ text }) => publishText({ settings, accessToken, text, api, dryRun: dryRunNow() }),
      }),
    };
  }

  const app = createServer({
    store, configDir, apiBase: settings.apiBase,
    getConfig, setDryRun, setupComplete: settings.setupComplete, ...handlers,
  });
  app.listen(4321, () => {
    if (!settings.setupComplete) {
      console.log('尚未設定 → 開啟 http://localhost:4321 完成設定精靈');
    } else {
      console.log('Dashboard: http://localhost:4321' + (dryRunNow() ? '　[DRY_RUN 乾跑中]' : ''));
    }
  });
}
