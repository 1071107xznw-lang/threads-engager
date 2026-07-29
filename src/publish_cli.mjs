import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { publishText } from './threads_publish.mjs';

// 發布一則自己的原生貼文。受 DRY_RUN 保護。
// 用法：npm run publish -- "要發布的內容"
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error('用法：npm run publish -- "要發布的內容"');
    process.exit(1);
  }

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

    const res = await publishText({ settings, accessToken, text, api });
    if (res.dryRun) console.log('🧪 DRY_RUN：未實際發布。內容：', res.text);
    else console.log(`✅ 已發布，貼文 id=${res.id}`);
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
