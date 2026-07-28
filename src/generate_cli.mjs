import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, loadSettings } from './env.mjs';
import { loadBrand } from './brand.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken } from './threads_token.mjs';
import { runGeneration } from './native_generate.mjs';

// 一鍵跑生產線並把草稿寫進審核佇列，印出預覽。之後到 dashboard 審核。
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnvFile(join(__dirname, '..', '.env'));
  const settings = loadSettings();
  const brand = loadBrand(join(__dirname, '..', 'config', 'argo.json'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  try {
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });
    const { accessToken } = getActiveToken({ store, settings });
    const res = await runGeneration({ settings, brand, store, accessToken, api });

    console.log(`\n✅ 產生 ${res.generated} 則草稿（站內素材 ${res.tagPosts}、新聞 ${res.newsTitles}）`);
    for (const id of res.ids) {
      const d = store.getNativeDraft(id);
      console.log(`\n— #${id}　${d.angle ? '（' + d.angle + '）' : ''}\n${d.draftText}`);
    }
    console.log('\n下一步：node src/server.mjs → http://localhost:4321 →「原生貼文」分頁審核');
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
