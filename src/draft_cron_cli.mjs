import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile, resolveSettings } from './env.mjs';
import { createStore } from './store.mjs';
import { createApi } from './threads_api.mjs';
import { getActiveToken, refreshIfNeeded } from './threads_token.mjs';
import { loadBrand, resolveBrandPath } from './brand.mjs';
import { findAndDraft } from './reply_pipeline.mjs';
import { isClaudeAvailable } from './ai.mjs';

// 夜間自動產回覆草稿：搜尋候選串 → AI 評分 → 產草稿 → 進審核佇列。
// 交給 cron 低頻跑（建議每 6 小時，見 README），隔天早上在 dashboard 批次核准。
//
// ⚠️ 這支 CLI 只自動到「產草稿」（status=drafted）。它沒有、也不會有送出路徑：
//    對外送出回覆一律要人在 dashboard 逐則/批次核准（CLAUDE.md 規則 1）。
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
  if (!isClaudeAvailable()) {
    console.error('找不到 claude CLI，無法自動評分/產草稿。請安裝並登入 claude CLI 後再排程這支。');
    store.close();
    process.exit(1);
  }

  try {
    const configDir = join(__dirname, '..', 'config');
    const brand = loadBrand(resolveBrandPath(configDir, existsSync));
    const api = createApi({ appSecret: settings.appSecret, base: settings.apiBase });

    // 順手續期 token（長期跑無人值守時，避免 token 悄悄過期）
    try {
      const t = await refreshIfNeeded({ store, settings, api });
      if (t.refreshed) console.log('🔑 token 已續期，新到期：', t.expiresAt);
    } catch (e) {
      console.warn('⚠️ token 續期檢查失敗（繼續執行）：', e.message);
    }

    const { accessToken } = getActiveToken({ store, settings });
    const res = await findAndDraft({
      settings, brand, store, accessToken, api,
      account: 'me',
      // 額度感知：依 cron 頻率把 7 天額度平均攤開（預設每 6 小時 → 28 輪）
      runsPer7d: Number(process.env.DRAFT_RUNS_PER_7D) || brand.replyRunsPer7d || 28,
    });
    console.log('產草稿結果：', res);
    if (res.drafted > 0) {
      console.log(`👉 有 ${res.drafted} 則新草稿待你核准：開 npm start 進「回覆審核」批次核准`);
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
