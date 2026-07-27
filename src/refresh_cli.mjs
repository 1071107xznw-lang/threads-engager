import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, loadSettings } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { refreshIfNeeded } from './threads_token.mjs';

// 檢查並（必要時）refresh 長期 token。可交給 cron 每天跑一次。
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnvFile(join(__dirname, '..', '.env'));
  const settings = loadSettings();
  const store = createStore(join(__dirname, '..', 'data.db'));
  try {
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const res = await refreshIfNeeded({ store, settings, api });
    console.log('Token refresh 結果：', res);
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
