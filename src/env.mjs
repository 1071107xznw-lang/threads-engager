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
