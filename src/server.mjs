import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createStore } from './store.mjs';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { loadBrand, resolveBrandPath } from './brand.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText, validateTopic, validateText } from './threads_publish.mjs';
import { runGeneration } from './native_generate.mjs';
import { isClaudeAvailable } from './ai.mjs';
import { findAndDraft } from './reply_pipeline.mjs';
import { sendApprovedReplies, validateReply, parseTargetId } from './threads_reply.mjs';
import { publishDue } from './scheduler.mjs';
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
    const res = await publish({ text, topic: d.topic });
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
  account, // 單帳號名稱（一實例一帳號）；預設取 accounts[0]
  runScrape,
  runSend,
  runGenerate,
  publishDraft,
}) {
  const app = express();
  app.use(express.json());
  const accountName = account || accounts[0]?.name || 'me';

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
    // 核准：只允許 drafted → approved。
    // 守門原因：若允許任意狀態改成 approved，已 sent 的貼文會被重新丟進送出佇列而重複回覆。
    const draftedIdSet = (account) => new Set(store.listByStatus(account, 'drafted').map((r) => r.id));
    app.post('/api/posts/:id/approve', (req, res) => {
      const id = Number(req.params.id);
      if (!draftedIdSet(accountName).has(id)) {
        res.status(400).json({ error: '只有「待審核」的草稿可以核准' }); return;
      }
      store.setStatus(id, 'approved');
      res.json({ ok: true });
    });
    // 批次核准：一次核准勾選的多則（可同時帶上編輯後內容，避免編輯被丟掉）。
    app.post('/api/posts/approve-bulk', (req, res) => {
      const body = req.body || {};
      const items = Array.isArray(body.items)
        ? body.items
        : (Array.isArray(body.ids) ? body.ids.map((id) => ({ id })) : []);
      const allowed = draftedIdSet(accountName);
      let approved = 0;
      let skipped = 0;
      for (const it of items) {
        const id = Number(it?.id);
        if (!Number.isInteger(id) || !allowed.has(id)) { skipped += 1; continue; }
        if (typeof it.editedText === 'string' && it.editedText.trim()) {
          try { store.editDraft(id, validateReply(it.editedText)); }
          catch { skipped += 1; continue; }
        }
        store.setStatus(id, 'approved');
        approved += 1;
      }
      res.json({ ok: true, approved, skipped });
    });
    // 手動指定一則貼文寫回覆 → 進「回覆審核」佇列（status=drafted）。
    // 不新增任何送出路徑：送出仍走 /api/send → sendApprovedReplies（只送 approved）。
    app.post('/api/reply/manual', (req, res) => {
      try {
        const targetId = parseTargetId(req.body?.targetId);
        const text = validateReply(String(req.body?.text ?? ''));
        const { id } = store.upsertPost({
          account: accountName,
          threadUrl: `https://www.threads.com/t/${targetId}`,
          author: null,
          content: '（手動指定的貼文）',
          targetId,
        });
        store.setRelevance(id, 1);
        store.saveDraft(id, text); // 轉 status=drafted，等人工核准
        res.json({ ok: true, id, targetId });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.post('/api/posts/:id/skip', (req, res) => {
      store.setStatus(Number(req.params.id), 'skipped');
      res.json({ ok: true });
    });

    // 原生貼文 產稿→審核→發布
    app.post('/api/native/generate', wrap(() => runGenerate()));
    // 手動撰寫一則原生貼文（不需 AI）：進待審核佇列
    app.post('/api/native/manual', (req, res) => {
      try {
        const text = validateText(String(req.body?.text ?? ''));
        const id = store.insertNativeDraft({ draftText: text, angle: '手動撰寫' });
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.get('/api/native/drafts', (req, res) => {
      res.json(store.listNativeByStatus(req.query.status || 'drafted'));
    });
    app.post('/api/native/:id/draft', (req, res) => {
      store.editNativeDraft(Number(req.params.id), req.body.editedText);
      res.json({ ok: true });
    });
    app.post('/api/native/:id/approve', (req, res) => {
      try {
        const topic = req.body && req.body.topic ? validateTopic(req.body.topic) : null;
        if (topic) store.setNativeTopic(Number(req.params.id), topic);
        store.setNativeStatus(Number(req.params.id), 'approved');
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    // 核准 + 排程：時間到由排程器自動發（只發已核准的原生貼文）
    app.post('/api/native/:id/schedule', (req, res) => {
      try {
        const { scheduledAt, topic } = req.body || {};
        if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
          res.status(400).json({ error: '請提供有效的排程時間' }); return;
        }
        store.setNativeSchedule(Number(req.params.id), new Date(scheduledAt).toISOString(), topic ? validateTopic(topic) : null);
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
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
      aiAvailable: isClaudeAvailable(),
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
        publish: ({ text, topic }) => publishText({ settings, accessToken, text, topic, api, dryRun: dryRunNow() }),
      }),
    };

    // in-process 排程器：每分鐘發到期的已核准排程貼文（DRY_RUN 下只 log）
    const schedulePublish = ({ text, topic }) =>
      publishText({ settings, accessToken, text, topic, api, dryRun: dryRunNow() });
    setInterval(() => {
      publishDue({ store, publish: schedulePublish, dryRun: dryRunNow() })
        .catch((e) => console.error('排程器錯誤：', e.message));
    }, 60_000);
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
