import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createStore } from './store.mjs';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { loadBrand, resolveBrandPath } from './brand.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText, validateTopic, validateText } from './threads_publish.mjs';
import { runGeneration } from './native_generate.mjs';
import { suggestTopic as nativeSuggestTopic } from './native_ai.mjs';
import { rankOwnPosts } from './insights.mjs';
import { scanInbox, draftInboxReply } from './inbox.mjs';
import { polishDraft } from './polish.mjs';
import { findHotThreads } from './hotthreads.mjs';
import { fetchTrendingTopics } from './trends.mjs';
import { scanCompliance, summarizeCompliance } from './compliance.mjs';
import { loadKnowledge, resolveKnowledgePath } from './knowledge.mjs';
import { isClaudeAvailable, scoreAndDraft } from './ai.mjs';
import { findAndDraft } from './reply_pipeline.mjs';
import { sendApprovedReplies, validateReply, parseTargetId } from './threads_reply.mjs';
import { publishDue } from './scheduler.mjs';
import { mountSetupRoutes } from './setup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

// 定時比較（避免以字元逐一比較洩漏長度/內容的計時側信道）。
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// HTTP Basic Auth middleware。只有設了密碼才啟用；帳號任意、只比對密碼。
// 用途：區網/遠端存取時保護整個 dashboard（含設定精靈）。本機不設密碼則維持免登入。
export function basicAuth(password) {
  return (req, res, next) => {
    const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
    let ok = false;
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      ok = safeEqual(pass, password);
    }
    if (!ok) {
      res.set('WWW-Authenticate', 'Basic realm="threads-engager", charset="UTF-8"');
      res.status(401).send('需要登入');
      return;
    }
    next();
  };
}

// 綁定監聽介面，綁不上就退回本機。
//
// 為什麼要這樣：HOST 若指向一個「當下不在這台機器上」的位址（最典型的情況是綁了
// Tailscale 的 100.x，然後 Tailscale 沒開），listen 會噴 EADDRNOTAVAIL 讓整個行程死掉。
// launchd 看到行程死掉就重新拉起來，於是變成無聲的重啟迴圈——使用者看到的只有
// 「連不到」，真正的原因埋在日誌裡。退回 127.0.0.1 至少讓本機還能用，
// 而且把原因大聲印出來。
//
// 只對 EADDRNOTAVAIL 退回。EADDRINUSE（埠被佔）是另一回事，退回只會蓋掉真正的衝突，
// 那種要讓它照常爆出來。
export const isLoopbackHost = (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1';
export const isWildcardHost = (h) => h === '0.0.0.0' || h === '::';

// 單次 listen 包成 Promise。listening / error 只會來一個，用完即棄。
function listenOn(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

export async function listenWithFallback({
  app, port, host, fallbackHost = '127.0.0.1', warn = console.error, alsoLocal = true,
}) {
  let server;
  let boundHost = host;
  let fellBack = false;
  try {
    server = await listenOn(app, port, host);
  } catch (err) {
    if (err.code !== 'EADDRNOTAVAIL') throw err;
    warn(`\n⚠️  綁不上 ${host}:${port}——這個位址現在不在這台機器上。`);
    if (/^100\./.test(host)) warn('   看起來是 Tailscale 的 IP：Tailscale 沒開（或換了 IP），這個位址就會消失。');
    warn(`   已退回 ${fallbackHost}:${port}，本機仍可使用；其他裝置（含手機）連不到。`);
    warn('   要恢復遠端連線：確認 Tailscale 開著、HOST 是當下正確的 IP，再重啟服務。\n');
    server = await listenOn(app, port, fallbackHost);
    boundHost = fallbackHost;
    fellBack = true;
  }

  // 綁單一介面（典型：Tailscale 的 100.x）時，這台機器自己反而連不到 localhost——
  // 因為 loopback 不在綁定的介面裡。所以額外再綁一個 127.0.0.1。
  // 這不會多開放任何人：127.0.0.1 只有本機連得到，區網一樣進不來。
  // 實務上的差別：自己用和錄影都能走 localhost（畫面上不會出現內網位址），
  // 手機走 Tailscale IP。
  let localServer = null;
  if (alsoLocal && !isLoopbackHost(boundHost) && !isWildcardHost(boundHost)) {
    try {
      localServer = await listenOn(app, port, fallbackHost);
    } catch (err) {
      // 本機這條沒綁上（例如 127.0.0.1:port 被別的東西佔了）不該連累主要服務。
      warn(`⚠️  ${fallbackHost}:${port} 沒綁上（${err.code || err.message}）——本機請改用 http://${boundHost}:${port}`);
    }
  }
  return { server, host: boundHost, fellBack, localServer, alsoLocal: Boolean(localServer) };
}

// 把「發布一則已核准的原生草稿」包成可注入的函式（守門：只有 approved 可發）。
export function makePublishDraft({ store, publish }) {
  return async (id) => {
    const nid = Number(id);
    const d = store.getNativeDraft(nid);
    if (!d) { const e = new Error('找不到草稿'); e.status = 404; throw e; }
    if (d.status !== 'approved') {
      const e = new Error('只有「已核准」的草稿可以發布'); e.status = 400; throw e;
    }
    // 原子認領：手動「立即發布」與排程器可能同時觸發同一則。搶不到代表另一方正在發 → 擋下，避免雙發。
    if (store.claimNativeForPublish && !store.claimNativeForPublish(nid)) {
      const e = new Error('這則正在發布中（可能排程器同時觸發），請稍候再看結果'); e.status = 409; throw e;
    }
    const text = d.editedText || d.draftText;
    try {
      const res = await publish({ text, topic: d.topic });
      if (res.dryRun) {
        store.setNativeStatus(nid, 'approved'); // DRY_RUN 沒真的發，退回認領
        return { dryRun: true, text };
      }
      store.markNativePublished(nid, res.id);
      return { dryRun: false, id: res.id };
    } catch (e) {
      store.markNativeFailed(nid, String(e.message || e)); // 失敗轉 failed，不卡在 publishing
      throw e;
    }
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
  password, // 選用：設了就用 Basic Auth 保護整個 dashboard
  runScrape,
  runInboxScan, // 掃自己貼文底下未回覆的留言 → 產草稿
  regenerateReply, // 🔄 重新生成某則回覆草稿（換個角度）
  runSend,
  runGenerate,
  suggestTopic, // 建議主題（AI）：({ text }) => Promise<string|null>
  polishPost, // ✨ 優化自己寫的貼文：({ text }) => Promise<{original, text, hook, ...}>
  findHot, // 🔍 關鍵字找熱門串：({ keyword }) => Promise<{results, ...}>
  topInsights, // 自家貼文成效排名：() => Promise<{available, top, reason}>
  publishDraft,
}) {
  const app = express();
  // 登入密碼（若有）擋在所有路由與靜態檔之前。未設密碼＝維持本機免登入。
  if (password) app.use(basicAuth(password));
  app.use(express.json());
  const accountName = account || accounts[0]?.name || 'me';

  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
  };

  // ⚖️ 列表時掃一次法規紅線，附在每列上。做在讀取端而非寫入端，
  // 所以 AI 產的、你自己手寫的、之前存下的舊草稿，全都會被掃到。
  // 只警示、不阻擋——送出仍由人逐則核准。
  const withCompliance = (rows) => rows.map((r) => {
    const hits = scanCompliance(r.editedText || r.draftText || '');
    return hits.length ? { ...r, compliance: summarizeCompliance(hits) } : r;
  });

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
      res.json(withCompliance(store.listByStatus(account, status)));
    });
    app.post('/api/scrape', wrap((req) => runScrape(req.body.account)));
    // 💬 留言區：掃自己貼文底下還沒回的留言 → 產草稿（送出仍需人工核准）
    if (runInboxScan) app.post('/api/inbox/scan', wrap(() => runInboxScan()));
    // 🔄 重新生成：第一版不夠有趣/太 AI 時換一個角度重寫（會避開已被打槍的版本）
    if (regenerateReply) app.post('/api/posts/:id/regenerate', wrap((req) => regenerateReply(Number(req.params.id))));
    app.post('/api/send', wrap((req) => runSend(req.body.account)));
    app.post('/api/posts/:id/draft', (req, res) => {
      store.editDraft(Number(req.params.id), req.body.editedText);
      res.json({ ok: true });
    });
    // 核准：只允許 drafted → approved，且最終要送出的文字不可為空。
    // 守門原因：(1) 若允許任意狀態改成 approved，已 sent 的貼文會被重丟進送出佇列而重複回覆；
    //          (2) 空白內容不可核准，否則送出時 (editedText || draftText) 會回落舊稿。
    const draftedRows = (account) => store.listByStatus(account, 'drafted');
    app.post('/api/posts/:id/approve', (req, res) => {
      const id = Number(req.params.id);
      const row = draftedRows(accountName).find((r) => r.id === id);
      if (!row) { res.status(400).json({ error: '只有「待審核」的草稿可以核准' }); return; }
      const finalText = row.editedText || row.draftText || '';
      if (!finalText.trim()) { res.status(400).json({ error: '回覆內容不可為空' }); return; }
      store.setStatus(id, 'approved');
      res.json({ ok: true });
    });
    // 批次核准：一次核准勾選的多則（可同時帶上編輯後內容，避免編輯被丟掉）。
    app.post('/api/posts/approve-bulk', (req, res) => {
      const body = req.body || {};
      const items = Array.isArray(body.items)
        ? body.items
        : (Array.isArray(body.ids) ? body.ids.map((id) => ({ id })) : []);
      const rows = new Map(draftedRows(accountName).map((r) => [r.id, r]));
      let approved = 0;
      let skipped = 0;
      for (const it of items) {
        const id = Number(it?.id);
        const row = rows.get(id);
        if (!Number.isInteger(id) || !row) { skipped += 1; continue; }
        // 有帶 editedText 就一律驗證：空白／超長都算無效 → 跳過不核准。
        // （避免使用者把文字框清空卻仍核准，結果送出的是舊草稿。）
        if ('editedText' in it) {
          try { store.editDraft(id, validateReply(String(it.editedText ?? ''))); }
          catch { skipped += 1; continue; }
        } else if (!(row.editedText || row.draftText || '').trim()) {
          skipped += 1; continue; // 沒帶編輯內容、既有草稿又是空的 → 不核准
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
        // 若這則貼文已經回覆並送出過，擋下來——不要把已送出的列復活成待審核而重複回覆。
        const existing = store.findByTargetId(accountName, targetId);
        if (existing && existing.status === 'sent') {
          res.status(409).json({ error: `這則貼文已經回覆並送出過了（#${existing.id}），不重複回覆` });
          return;
        }
        const { id } = store.upsertPost({
          account: accountName,
          threadUrl: `https://www.threads.com/t/${targetId}`,
          author: null,
          content: '（手動指定的貼文）',
          targetId,
        });
        store.setRelevance(id, 1);
        store.saveDraft(id, text); // 存草稿並清舊 editedText，轉 status=drafted，等人工核准
        res.json({ ok: true, id, targetId, updated: Boolean(existing) });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.post('/api/posts/:id/skip', (req, res) => {
      store.setStatus(Number(req.params.id), 'skipped');
      res.json({ ok: true });
    });

    // 自家貼文成效排名：看「哪幾則真的有流量」。需 threads_manage_insights 權限，
    // 沒有就回 available:false + 原因，前端顯示提示而非報錯。
    if (topInsights) {
      app.get('/api/insights/top', wrap(() => topInsights()));
    }

    // 原生貼文 產稿→審核→發布
    app.post('/api/native/generate', wrap(() => runGenerate()));
    // 為一段草稿內容建議主題（AI）。給前端「建議主題」按鈕用；手寫草稿也適用。
    if (suggestTopic) {
      app.post('/api/native/suggest-topic', wrap(async (req) => {
        const topic = await suggestTopic({ text: String(req.body?.text ?? '') });
        return { topic: topic || '' };
      }));
    }
    // ✨ 優化「自己寫的」一則貼文：找鉤子、緊縮、建議主題、自然蹭熱度、去 AI 腔。
    // 只回建議，不動佇列——採不採用由使用者決定。
    if (polishPost) {
      app.post('/api/native/polish', wrap(async (req) => {
        const text = validateText(String(req.body?.text ?? ''));
        return polishPost({ text });
      }));
    }
    // 🔍 關鍵字找熱門串：只產出連結清單，留言由你自己去 Threads 手動做
    if (findHot) {
      app.post('/api/search/hot', wrap((req) => findHot({ keyword: String(req.body?.keyword ?? '') })));
    }
    // 手動撰寫一則原生貼文（不需 AI）：進待審核佇列
    app.post('/api/native/manual', (req, res) => {
      try {
        const text = validateText(String(req.body?.text ?? ''));
        const id = store.insertNativeDraft({ draftText: text, angle: '手動撰寫' });
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.get('/api/native/drafts', (req, res) => {
      res.json(withCompliance(store.listNativeByStatus(req.query.status || 'drafted')));
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
    // 🗑 刪掉不想發的草稿（含已核准待發布的）。已發布的擋著——那是紀錄，不是待辦。
    app.delete('/api/native/:id', (req, res) => {
      const r = store.deleteNativeDraft(Number(req.params.id));
      if (r.deleted) { res.json({ ok: true }); return; }
      const msg = {
        not_found: '找不到這則草稿',
        published: '已發布的貼文不能刪除（那是發生過什麼的紀錄）。要撤下請到 Threads 上刪。',
        publishing: '這則正在發布中，請等結果出來再處理',
      }[r.reason] || '刪不掉';
      res.status(r.reason === 'not_found' ? 404 : 400).json({ error: msg });
    });
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

  // 啟動時回收上次崩潰／重啟遺留的孤兒 publishing 列（標為 failed，不自動重發）。
  const recovered = store.recoverStalePublishing();
  if (recovered > 0) console.warn(`⚠️ 回收 ${recovered} 則中斷的發布（已標為 failed，請到 dashboard 確認）`);

  // 憑證與品牌都「每次呼叫時」重新從 DB / 設定檔解析，而不是啟動時鎖進 closure。
  // 這樣「切換帳號」後，執行中的 server 會立刻改用新帳號，不會以舊帳號身分送出。
  const currentSettings = () => resolveSettings({ store });
  const currentBrand = () => loadBrand(resolveBrandPath(configDir, existsSync));
  const currentAuth = () => {
    const settings = currentSettings();
    if (!settings.setupComplete) { const e = new Error('尚未連接帳號，請先完成設定精靈'); e.status = 400; throw e; }
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const { accessToken } = getActiveToken({ store, settings });
    return { settings, api, accessToken };
  };

  const initial = currentSettings();

  // DRY_RUN：以 DB 設定為準（網頁可切換）；首次以 settings.dryRun 種入
  if (store.getSetting('dryRun') == null) store.setSetting('dryRun', initial.dryRun ? '1' : '0');
  const dryRunNow = () => store.getSetting('dryRun') === '1';
  const setDryRun = (on) => store.setSetting('dryRun', on ? '1' : '0');

  const getConfig = () => {
    const settings = currentSettings(); // 即時：切換帳號後 setupComplete 會變 false → 前端導回精靈
    const brand = currentBrand();
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

  const ACCOUNT = 'me';
  // handlers 一律透過 currentAuth() 即時取用當前帳號憑證（見上）。
  const handlers = {
    accounts: [{ name: ACCOUNT }],
    runScrape: () => {
      const { settings, api, accessToken } = currentAuth();
      return findAndDraft({ settings, brand: currentBrand(), store, accessToken, api, account: ACCOUNT });
    },
    runInboxScan: () => {
      const { settings, api, accessToken } = currentAuth();
      const brand = currentBrand();
      return scanInbox({
        api, accessToken, userId: settings.userId, store, account: ACCOUNT, brand,
        knowledge: loadKnowledge(configDir ? resolveKnowledgePath(configDir, existsSync) : null),
      });
    },
    regenerateReply: async (id) => {
      const row = store.getPost(id);
      if (!row) { const e = new Error('找不到這則'); e.status = 404; throw e; }
      if (row.status !== 'drafted' && row.status !== 'new') {
        const e = new Error('只有待審核的草稿可以重新生成'); e.status = 400; throw e;
      }
      const brand = currentBrand();
      const knowledge = loadKnowledge(configDir ? resolveKnowledgePath(configDir, existsSync) : null);
      // 把目前這版（含你手動改過的）當成「不要再寫成這樣」的負面範例
      const avoid = [row.editedText, row.draftText].filter((t) => t && t.trim());
      let draft = null;
      if (row.kind === 'inbox') {
        draft = await draftInboxReply({
          rootPostText: row.rootText || '',
          reply: { username: row.author, text: row.content },
          persona: brand.replyPersona, knowledge, humor: brand.humor, avoid,
        });
      } else {
        const r = await scoreAndDraft({
          post: { author: row.author, content: row.content, likes: row.likes },
          persona: brand.replyPersona, threshold: 0, avoid,
        });
        draft = r.draft;
      }
      if (!draft) { const e = new Error('AI 沒能產出新版本，原本的草稿保留'); e.status = 502; throw e; }
      store.saveDraft(id, draft);
      return { ok: true, draftText: draft, compliance: summarizeCompliance(scanCompliance(draft)) };
    },
    runSend: () => {
      const { settings, api, accessToken } = currentAuth();
      const brand = currentBrand();
      return sendApprovedReplies({
        settings, store, accessToken, api, account: ACCOUNT,
        dailyCap: brand.replyDailyCap, inboxDailyCap: brand.inboxDailyCap,
        dryRun: dryRunNow(),
      });
    },
    runGenerate: () => {
      const { settings, api, accessToken } = currentAuth();
      return runGeneration({ settings, brand: currentBrand(), store, accessToken, api, configDir });
    },
    suggestTopic: ({ text }) => nativeSuggestTopic({ text, persona: currentBrand().persona }),
    polishPost: async ({ text }) => {
      const { settings, api, accessToken } = currentAuth();
      const brand = currentBrand();
      // 語氣樣本 + 成效範本 + 熱搜，跟產稿吃同一套訊號
      let ownRaw = [];
      try {
        const res = await api.listOwnPosts({ accessToken, userId: settings.userId, limit: 25 });
        ownRaw = (res.data || []).filter((p) => p && p.text);
      } catch { /* 拿不到就少一個訊號，不擋優化 */ }
      let topPosts = [];
      if (brand.useInsights !== false && ownRaw.length) {
        topPosts = (await rankOwnPosts({ api, accessToken, posts: ownRaw, limit: 5, maxFetch: 15 })).top;
      }
      const hotTrends = await fetchTrendingTopics({ feeds: brand.hotTrendsFeeds, log: () => {} });
      return polishDraft({
        text,
        persona: brand.persona,
        hotTrends,
        ownPosts: ownRaw.slice(0, 10).map((p) => p.text),
        topPosts,
        knowledge: loadKnowledge(configDir ? resolveKnowledgePath(configDir, existsSync) : null),
      });
    },
    findHot: async ({ keyword }) => {
      const { settings, api, accessToken } = currentAuth();
      const brand = currentBrand();
      let ownUsername = store.getSetting('username') || null;
      if (!ownUsername) {
        try {
          ownUsername = (await api.getProfile({ accessToken, userId: settings.userId, fields: 'id,username' })).username;
        } catch { /* 拿不到就不濾自己 */ }
      }
      return findHotThreads({
        api, store, accessToken, keyword, limit: 20, cap: brand.searchCap7d, ownUsername,
      });
    },
    topInsights: async () => {
      const { settings, api, accessToken } = currentAuth();
      const res = await api.listOwnPosts({ accessToken, userId: settings.userId, limit: 25 });
      const posts = (res.data || []).filter((p) => p && p.text);
      return rankOwnPosts({ api, accessToken, posts, limit: 10, maxFetch: 15 });
    },
    publishDraft: makePublishDraft({
      store,
      publish: ({ text, topic }) => {
        const { settings, api, accessToken } = currentAuth();
        return publishText({ settings, accessToken, text, topic, api, dryRun: dryRunNow() });
      },
    }),
  };

  // in-process 排程器：每分鐘發到期的已核准排程貼文（DRY_RUN 下只 log）。
  // schedulerBusy：避免上一輪未跑完（每則發布前硬等 30s）就進下一輪造成重入。
  // 若尚未設定或已切換帳號，currentAuth 會擋下（但 clearAccount 已把到期項退回草稿，通常不會走到）。
  let schedulerBusy = false;
  setInterval(() => {
    if (schedulerBusy || !currentSettings().setupComplete) return;
    schedulerBusy = true;
    Promise.resolve()
      .then(() => publishDue({
        store,
        publish: ({ text, topic }) => {
          const { settings, api, accessToken } = currentAuth();
          return publishText({ settings, accessToken, text, topic, api, dryRun: dryRunNow() });
        },
        dryRun: dryRunNow(),
      }))
      .catch((e) => console.error('排程器錯誤：', e.message))
      .finally(() => { schedulerBusy = false; });
  }, 60_000);

  const dashboardPassword = (process.env.DASHBOARD_PASSWORD || '').trim() || null;
  const app = createServer({
    store, configDir, apiBase: initial.apiBase, account: ACCOUNT, password: dashboardPassword,
    getConfig, setDryRun, setupComplete: initial.setupComplete, ...handlers,
  });
  const PORT = Number(process.env.PORT) || 4321;
  // HOST 決定「誰連得到這個 dashboard」。預設 0.0.0.0＝所有網路介面，
  // 也就是**同一個區網的任何人**（店裡的客用 Wi-Fi 也算）都連得到。
  // 這個 dashboard 能用你的身分發文，所以：
  //   · 只在自己電腦上用          → HOST=127.0.0.1
  //   · 要用手機/遠端連（Tailscale）→ 留預設，但密碼要夠強
  const HOST = process.env.HOST || '0.0.0.0';
  // 底下所有訊息都以「真正綁上的」介面為準（boundHost），不是使用者要求的那個。
  // 退回本機之後還印「手機連得到」就是騙人。
  const { host: boundHost, fellBack, alsoLocal } = await listenWithFallback({ app, port: PORT, host: HOST });
  // 綁特定介面時，localhost 只有在額外綁上時才連得到——印出真正能開的網址，不要騙人。
  const isAny = isWildcardHost(boundHost);
  const isLocal = isLoopbackHost(boundHost);
  const url = (isAny || isLocal || alsoLocal) ? `http://localhost:${PORT}` : `http://${boundHost}:${PORT}`;
  if (!initial.setupComplete) {
    console.log(`尚未設定 → 開啟 ${url} 完成設定精靈`);
  } else {
    console.log(`Dashboard: ${url}` + (dryRunNow() ? '　[DRY_RUN 乾跑中]' : ''));
  }
  console.log(dashboardPassword ? '🔒 已啟用登入密碼' : '🔓 未設登入密碼（僅建議本機使用；遠端請設 DASHBOARD_PASSWORD）');
  if (fellBack) {
    console.log(`🏠 已退回本機（原本要綁 ${HOST}，綁不上）——手機/遠端現在連不到。`);
  } else if (isLocal) {
    console.log('🏠 只綁本機——區網其他裝置連不到。要手機連請改 HOST。');
  } else if (isAny) {
    console.log(`🌐 綁 ${boundHost}（所有介面）——**同一個區網的其他裝置都連得到**。`
      + (dashboardPassword ? '' : ' ⚠️ 而且沒設密碼！'));
    console.log('   只在自己電腦上用 → HOST=127.0.0.1；要手機連又不想開放區網 → 綁 Tailscale IP。');
  } else {
    // 綁單一介面（典型用途：Tailscale 的 100.x）——只有那個網路上的裝置連得到
    const via = /^100\./.test(boundHost) ? 'Tailscale 私人網路' : `介面 ${boundHost}`;
    console.log(`🔐 只綁 ${boundHost}——只有${via}上的裝置連得到，區網其他人碰不到。`
      + (dashboardPassword ? '' : ' ⚠️ 但沒設密碼！'));
    if (alsoLocal) console.log(`   📱 手機/遠端：http://${boundHost}:${PORT}　💻 這台機器：http://localhost:${PORT}`);
  }
}
