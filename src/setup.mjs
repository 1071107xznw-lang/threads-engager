import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApi } from './threads_api.mjs';

// 設定精靈後端。憑證由使用者在自己的 localhost 網頁輸入，存進本機 gitignore 的 data.db。

// 每帳號的品牌設定以 userId 為鍵存在本機 DB（app_settings『brand:<userId>』）。
// 用途：一次一帳號切換時，各帳號記住自己的風格（persona/tags/主題），切回來自動還原。
// 這不是多帳號後台——同時仍只操作當前連接的那一個帳號（CLAUDE.md 規則 3）。
const brandKey = (userId) => `brand:${userId}`;

// 步驟 1：連接帳號。輸入 App Secret + 短期 token → 換 60 天長期 token → 抓帳號 → 存入 store。
export async function connectAccount({
  store,
  appSecret,
  shortToken,
  apiBase = 'https://graph.threads.net',
  api,
  now = Date.now(),
  configPath = null,
}) {
  if (!appSecret || !shortToken) {
    const e = new Error('請填入 App Secret 與 Access Token');
    e.status = 400;
    throw e;
  }
  api = api || createApi({ appSecret, base: apiBase });

  const ex = await api.exchangeLongLivedToken({ shortLivedToken: shortToken, appSecret });
  const longToken = ex.access_token;
  if (!longToken) {
    const e = new Error('換發長期 token 失敗，請確認 App Secret 與 token 是否正確且未過期');
    e.status = 400;
    throw e;
  }
  const expiresAt = ex.expires_in ? new Date(now + Number(ex.expires_in) * 1000).toISOString() : null;

  const me = await api.getProfile({ accessToken: longToken, userId: 'me', fields: 'id,username,name' });

  store.setSetting('appSecret', appSecret);
  store.setSetting('userId', me.id);
  store.setSetting('username', me.username || '');
  store.setToken(longToken, expiresAt);
  // 連上新帳號後解除「不回落 .env」旗標（見 store.clearAccount）
  if (store.deleteSetting) store.deleteSetting('ignoreEnvCreds');

  // 這個帳號之前存過品牌設定 → 自動還原到 config/brand.json，跳過品牌步驟。
  let brandExists = false;
  const snap = store.getSetting(brandKey(me.id));
  if (snap && configPath) {
    try {
      writeFileSync(configPath, snap.trimEnd() + '\n', 'utf8');
      store.setSetting('setupComplete', '1');
      brandExists = true;
    } catch { /* 還原失敗就走品牌設定步驟 */ }
  }

  return { username: me.username, userId: me.id, name: me.name || '', expiresAt, brandExists };
}

// 切換帳號：清掉目前帳號的憑證與設定完成標記 → 前端導回設定精靈連下一個帳號。
// 一次只服務一個帳號（CLAUDE.md 規則 3）；這裡不保留任何「多帳號並存」狀態。
export function disconnectAccount({ store, configPath = null }) {
  const username = store.getSetting('username') || null;
  const userId = store.getSetting('userId');
  // 切走前先快照目前帳號的品牌設定（含手動編輯過的 brand.json），下次切回來自動還原。
  if (userId && configPath && existsSync(configPath)) {
    try { store.setSetting(brandKey(userId), readFileSync(configPath, 'utf8')); } catch { /* 忽略 */ }
  }
  store.clearAccount();
  return { ok: true, disconnected: username };
}

const BRAND_FIELDS = [
  'brandName', 'persona', 'tags',
  'replyPersona', 'replyThreshold', 'replyDailyCap', 'replyPerRun', 'replyTags',
  'newsFeeds', 'hotTrendsFeeds', 'useThreadsSearch', 'draftsPerRun', 'perTagPosts', 'searchCap7d',
];

// 步驟 2：存品牌設定 → 寫 config/brand.json，標記設定完成。
export function saveBrand({ store, configPath, brand = {} }) {
  const clean = {};
  for (const k of BRAND_FIELDS) if (brand[k] !== undefined) clean[k] = brand[k];
  if (!clean.brandName || !String(clean.brandName).trim()) {
    const e = new Error('請填入品牌名稱');
    e.status = 400;
    throw e;
  }
  const json = JSON.stringify(clean, null, 2);
  writeFileSync(configPath, json + '\n', 'utf8');
  store.setSetting('setupComplete', '1');
  // 快照到 DB，以 userId 為鍵——切換帳號時各自記住風格
  const userId = store.getSetting('userId');
  if (userId) store.setSetting(brandKey(userId), json);
  return { ok: true };
}

export function setupStatus({ store, env = process.env }) {
  const ignoreEnvCreds = store.getSetting('ignoreEnvCreds') === '1';
  const connected = Boolean(
    (store.getSetting('appSecret') || (ignoreEnvCreds ? null : env.THREADS_APP_SECRET))
    && store.getToken()?.accessToken
  );
  const brandDone = store.getSetting('setupComplete') === '1';
  return { connected, brandDone };
}

// 把設定精靈路由掛上 express app（server 在「設定模式」與正常模式都掛，方便之後重設）。
export function mountSetupRoutes(app, { store, configDir, apiBase = 'https://graph.threads.net' }) {
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
  };
  app.get('/api/setup/status', (req, res) => res.json(setupStatus({ store })));
  const configPath = configDir ? join(configDir, 'brand.json') : null;
  app.post('/api/setup/connect', wrap((req) =>
    connectAccount({ store, appSecret: req.body.appSecret, shortToken: req.body.accessToken, apiBase, configPath })));
  app.post('/api/setup/brand', wrap((req) =>
    saveBrand({ store, configPath, brand: req.body })));
  app.post('/api/setup/disconnect', wrap(() => disconnectAccount({ store, configPath })));
}
