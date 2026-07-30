import { readFileSync } from 'node:fs';

// 極簡 .env 載入器：把 KEY=VALUE 寫進 process.env（不覆蓋已存在的變數）。
// 不引入第三方依賴；格式支援 # 註解、成對引號、KEY=VALUE。
export function loadEnvFile(path = '.env', env = process.env) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return env; // 沒有 .env 就略過，改吃真實環境變數
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in env)) env[key] = val;
  }
  return env;
}

const TRUEY = new Set(['1', 'true', 'yes', 'on']);

export function parseDryRun(v) {
  if (v == null) return false;
  return TRUEY.has(String(v).trim().toLowerCase());
}

const trimOrNull = (v) => (v && String(v).trim()) || null;

// 綜合解析設定：憑證優先序 DB（設定精靈寫入）→ .env。
// 三要素（appSecret / userId / token）齊全才 setupComplete=true；否則 server 進設定模式。
// dryRun：DB（網頁切換）優先，其次 .env，預設 true（安全，避免誤發）。
export function resolveSettings({ store, env = process.env }) {
  // 切換帳號後（store.clearAccount）不再回落 .env 憑證，否則舊帳號會被 .env 復活。
  // 連接新帳號時 connectAccount 會清掉這個旗標。
  const ignoreEnvCreds = store.getSetting('ignoreEnvCreds') === '1';
  const envIf = (v) => (ignoreEnvCreds ? null : trimOrNull(v));

  const appSecret = trimOrNull(store.getSetting('appSecret')) || envIf(env.THREADS_APP_SECRET);
  const userId = trimOrNull(store.getSetting('userId')) || envIf(env.THREADS_USER_ID);
  const envToken = envIf(env.THREADS_ACCESS_TOKEN);
  const hasStoredToken = Boolean(store.getToken()?.accessToken);

  const dbDry = store.getSetting('dryRun');
  const dryRun =
    dbDry != null ? dbDry === '1' || dbDry === 'true'
    : env.DRY_RUN != null ? parseDryRun(env.DRY_RUN)
    : true;

  const apiBase = trimOrNull(env.THREADS_API_BASE) || 'https://graph.threads.net';
  const setupComplete = Boolean(appSecret && userId && (hasStoredToken || envToken));

  // accessToken 回傳 .env 的 bootstrap token（getActiveToken 會優先用 DB 的長期 token）
  return { setupComplete, appSecret, userId, accessToken: envToken, apiBase, dryRun };
}

// 從環境變數組出單帳號設定；缺必填即拋繁中錯誤。
export function loadSettings(env = process.env) {
  const required = ['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN', 'THREADS_APP_SECRET'];
  const missing = required.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length) {
    throw new Error(
      `缺少必要環境變數：${missing.join('、')}（請在 .env 設定，可參考 .env.example）`
    );
  }
  return {
    userId: String(env.THREADS_USER_ID).trim(),
    accessToken: String(env.THREADS_ACCESS_TOKEN).trim(),
    appSecret: String(env.THREADS_APP_SECRET).trim(),
    dryRun: parseDryRun(env.DRY_RUN),
    apiBase:
      (env.THREADS_API_BASE && String(env.THREADS_API_BASE).trim()) ||
      'https://graph.threads.net',
  };
}
