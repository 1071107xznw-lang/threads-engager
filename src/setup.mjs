import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApi } from './threads_api.mjs';

// 設定精靈後端。憑證由使用者在自己的 localhost 網頁輸入，存進本機 gitignore 的 data.db。

// 步驟 1：連接帳號。輸入 App Secret + 短期 token → 換 60 天長期 token → 抓帳號 → 存入 store。
export async function connectAccount({
  store,
  appSecret,
  shortToken,
  apiBase = 'https://graph.threads.net',
  api,
  now = Date.now(),
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

  return { username: me.username, userId: me.id, name: me.name || '', expiresAt };
}

// 切換帳號：清掉目前帳號的憑證與設定完成標記 → 前端導回設定精靈連下一個帳號。
// 一次只服務一個帳號（CLAUDE.md 規則 3）；這裡不保留任何「多帳號並存」狀態。
export function disconnectAccount({ store }) {
  const username = store.getSetting('username') || null;
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
  writeFileSync(configPath, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  store.setSetting('setupComplete', '1');
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
  app.post('/api/setup/connect', wrap((req) =>
    connectAccount({ store, appSecret: req.body.appSecret, shortToken: req.body.accessToken, apiBase })));
  app.post('/api/setup/brand', wrap((req) =>
    saveBrand({ store, configPath: join(configDir, 'brand.json'), brand: req.body })));
  app.post('/api/setup/disconnect', wrap(() => disconnectAccount({ store })));
}
