import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText } from './threads_publish.mjs';
import { publishDue } from './scheduler.mjs';
import { loadBrand, resolveBrandPath } from './brand.mjs';
import { existsSync } from 'node:fs';

// 發布到期的排程原生貼文。可交給 cron 每分鐘跑一次（見 README）。
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnvFile(join(__dirname, '..', '.env'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  const settings = resolveSettings({ store });
  if (!settings.setupComplete) {
    console.error('尚未完成設定，請先執行 npm start 開啟設定精靈');
    store.close();
    process.exit(1);
  }
  try {
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const { accessToken } = getActiveToken({ store, settings });
    const res = await publishDue({
      store,
      publish: ({ text, topic }) =>
        publishText({ settings, accessToken, text, topic, api, dryRun: settings.dryRun }),
      dryRun: settings.dryRun,
      // cron 每分鐘跑一次；積壓的排程要照間隔滴出去，不能一次全倒
      minGapMinutes: loadBrand(resolveBrandPath(join(__dirname, '..', 'config'), existsSync)).minGapMinutes,
    });
    console.log('排程發布結果：', res);
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
