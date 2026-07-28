import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';

// 把 .env 的短期 token 換成 60 天長期 token，並抓出 THREADS_USER_ID。
// 刻意不經過 loadSettings —— 此時 THREADS_USER_ID 通常還沒填。
// 長期 token 會存進 data.db（getActiveToken 會優先採用），不列印以免外洩。
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnvFile(join(__dirname, '..', '.env'));
  const shortToken = process.env.THREADS_ACCESS_TOKEN;
  const appSecret = process.env.THREADS_APP_SECRET;
  const apiBase = process.env.THREADS_API_BASE || 'https://graph.threads.net';
  if (!shortToken || !appSecret) {
    console.error('❌ .env 需先填 THREADS_ACCESS_TOKEN 與 THREADS_APP_SECRET');
    process.exit(1);
  }
  const api = createApi({ appSecret, base: apiBase });

  // 1) 短期 → 長期
  const ex = await api.exchangeLongLivedToken({ shortLivedToken: shortToken, appSecret });
  const longToken = ex.access_token;
  const days = ex.expires_in ? Math.round(ex.expires_in / 86400) : '?';
  console.log(`✅ 已換到長期 token，有效約 ${days} 天`);

  // 2) 用長期 token 抓 user id
  const me = await api.getProfile({
    accessToken: longToken,
    userId: 'me',
    fields: 'id,username,name',
  });
  console.log(`✅ 帳號：@${me.username}（${me.name || ''}）`);
  console.log(`✅ THREADS_USER_ID = ${me.id}`);

  // 3) 存長期 token 到 DB（不列印 token 本身）
  const store = createStore(join(__dirname, '..', 'data.db'));
  const expiresAt = ex.expires_in
    ? new Date(Date.now() + Number(ex.expires_in) * 1000).toISOString()
    : null;
  store.setToken(longToken, expiresAt);
  store.close();

  console.log('');
  console.log('下一步：');
  console.log(`  1) 把 .env 的 THREADS_USER_ID 填成上面那個 id`);
  console.log(`  2) 長期 token 已存進 data.db；程式會優先使用它（.env 的短期 token 可留著沒關係）`);
  console.log(`  3) 執行 npm run verify 應該就會通過`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
