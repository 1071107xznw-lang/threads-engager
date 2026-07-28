import { createApi } from './threads_api.mjs';
import { gatherTagPosts } from './threads_search.mjs';
import { fetchNewsTitles } from './trends.mjs';
import { generateDrafts } from './native_ai.mjs';

// 完整生產線：站內趨勢 + 網路趨勢 + 自己貼文 → AI 產稿 → 寫入 native_drafts（status=drafted）。
// 供 CLI 與 server 端點共用。所有外部相依（api/runner/fetch）皆可注入以利測試。
export async function runGeneration({
  settings,
  brand,
  store,
  accessToken,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  runner,
  fetchImpl,
  ownUsername = null,
  nowIso = new Date().toISOString(),
  log = console.log,
}) {
  // 1) 站內 tag 素材（內含 7 天額度守門）。App 為 Development 模式時 keyword_search
  //    只回自己貼文且照吃額度，故由 brand.useThreadsSearch 控制（預設關）。
  let tagPosts = [];
  if (brand.useThreadsSearch) {
    if (!ownUsername) {
      try {
        const me = await api.getProfile({ accessToken, userId: settings.userId, fields: 'id,username' });
        ownUsername = me.username || null;
      } catch {
        /* 拿不到就不濾，無妨 */
      }
    }
    tagPosts = await gatherTagPosts({
      api, store, accessToken,
      tags: brand.tags, perTag: brand.perTagPosts, cap: brand.searchCap7d,
      ownUsername, nowIso, log,
    });
    log(`站內素材：${tagPosts.length} 則；keyword_search 近7天用量 ${store.countSearches7d(nowIso)}/${brand.searchCap7d}`);
  } else {
    log('站內搜尋已關閉（App 需 Live 模式才能取得他人公開貼文；見 config/argo.json useThreadsSearch）');
  }

  // 2) 網路趨勢（失敗容忍）
  const newsTitles = await fetchNewsTitles({ fetchImpl, feeds: brand.newsFeeds, log });
  log(`網路趨勢：${newsTitles.length} 則新聞標題`);

  // 3) 自己近期貼文（語氣樣本、避免重複）
  let ownPosts = [];
  try {
    const res = await api.listOwnPosts({ accessToken, userId: settings.userId, limit: 5 });
    ownPosts = (res.data || []).map((p) => p.text).filter(Boolean);
  } catch (e) {
    log(`⚠️ 讀取自己貼文失敗（略過）：${e.message}`);
  }

  // 4) AI 產稿
  const drafts = await generateDrafts({
    persona: brand.persona, newsTitles, tagPosts, ownPosts, n: brand.draftsPerRun, runner,
  });

  // 5) 寫入審核佇列
  const sourceSummary = `站內 ${tagPosts.length} 則、新聞 ${newsTitles.length} 則`;
  const ids = drafts.map((d) =>
    store.insertNativeDraft({ draftText: d.text, angle: d.angle, sourceSummary })
  );

  return {
    generated: ids.length,
    ids,
    tagPosts: tagPosts.length,
    newsTitles: newsTitles.length,
    quotaUsed7d: store.countSearches7d(nowIso),
  };
}
