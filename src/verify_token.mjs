import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, loadSettings } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';

// 唯讀驗證 token：讀帳號 profile + 最近 5 篇自己貼文。
// DRY_RUN 不影響此腳本（唯讀呼叫本來就安全，且驗證 token 就是要真的打）。
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnvFile(join(__dirname, '..', '.env'));
  const settings = loadSettings();
  const store = createStore(join(__dirname, '..', 'data.db'));
  try {
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const { accessToken } = getActiveToken({ store, settings });

    const profile = await api.getProfile({ accessToken, userId: settings.userId });
    console.log('✅ Token 有效');
    console.log(`帳號：@${profile.username}（${profile.name || ''}） id=${profile.id}`);

    const posts = await api.listOwnPosts({ accessToken, userId: settings.userId, limit: 5 });
    const items = posts.data || [];
    console.log(`最近 ${items.length} 篇貼文：`);
    for (const p of items) {
      const preview = (p.text || '（無文字）').replace(/\n/g, ' ').slice(0, 40);
      console.log(`  - [${p.timestamp || ''}] ${preview}  ${p.permalink || ''}`);
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
