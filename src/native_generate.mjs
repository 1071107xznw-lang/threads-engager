import { existsSync } from 'node:fs';
import { createApi } from './threads_api.mjs';
import { gatherTagPosts } from './threads_search.mjs';
import { fetchNewsTitles, fetchTrendingTopics } from './trends.mjs';
import { generateDrafts } from './native_ai.mjs';
import { rankTopics } from './topic_rank.mjs';
import { loadKnowledge, resolveKnowledgePath } from './knowledge.mjs';
import { rankOwnPosts, summarizeMetrics } from './insights.mjs';

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
  configDir = null, // 用來找 config/knowledge.md（品牌知識庫）
  knowledge = null, // 可直接注入（測試用）；未給則從 configDir 讀
  redTeam = true,
  useInsights = brand.useInsights !== false, // 成效回饋（預設開；沒權限會自動略過）
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

  // 2) 全網即時熱搜（Google Trends：搜尋量正在飆高的時勢主題，不限酒吧相關）
  const hotTrends = await fetchTrendingTopics({ fetchImpl, feeds: brand.hotTrendsFeeds, log });
  log(`即時熱搜：${hotTrends.length} 個主題${hotTrends[0] ? `（如「${hotTrends[0].topic}」${hotTrends[0].traffic || ''}）` : ''}`);

  // 3) 網路趨勢（主題式新聞，失敗容忍）
  const newsTitles = await fetchNewsTitles({ fetchImpl, feeds: brand.newsFeeds, log });
  log(`網路趨勢：${newsTitles.length} 則新聞標題`);

  // 4) 自己近期貼文（語氣樣本：學說話方式、避免重複主題）
  let ownRaw = [];
  try {
    const res = await api.listOwnPosts({ accessToken, userId: settings.userId, limit: 25 });
    ownRaw = (res.data || []).filter((p) => p && p.text);
  } catch (e) {
    log(`⚠️ 讀取自己貼文失敗（略過）：${e.message}`);
  }
  const ownPosts = ownRaw.slice(0, 15).map((p) => p.text);
  log(`語氣樣本：自己的 ${ownPosts.length} 則貼文`);

  // 4b) 成效回饋：哪幾則「真的有流量」——拿冠軍當範本，而不是拿最新的當範本。
  //     需 threads_manage_insights 權限；沒有就 fail-open（少一個訊號，不擋產稿）。
  let topPosts = [];
  let rankedAll = [];
  let insightsAvailable = false;
  if (!useInsights) {
    log('成效回饋：已關閉（brand.useInsights = false）');
  } else if (ownRaw.length) {
    const ranked = await rankOwnPosts({ api, accessToken, posts: ownRaw, limit: 5, maxFetch: 15, log });
    insightsAvailable = ranked.available;
    topPosts = ranked.top;
    rankedAll = ranked.all || [];
    if (insightsAvailable) {
      const best = topPosts[0];
      log(`成效回饋：讀到 ${ranked.scored} 則數據${best ? `；表現最好的一則 ${summarizeMetrics(best.metrics)}` : ''}`);
    }
  }

  // 4b-2) 主題排序：建議 topic 時優先挑聲量大的。
  //       兩個代理指標——熱搜的搜尋熱度，加上「我們自己用過這個主題，帶來多少瀏覽」。
  //       後者要靠 publishedPostId 把 DB 的 topic 跟 insights 對起來
  //       （listOwnPosts 預設欄位不含 topic_tag，從 API 拿不到）。
  const ownTopicHistory = [];
  if (insightsAvailable && store.listPublishedNativeTopics) {
    const topicByPostId = new Map(
      store.listPublishedNativeTopics().map((r) => [r.publishedPostId, r.topic])
    );
    for (const s of rankedAll) {
      const topic = topicByPostId.get(s.id);
      if (topic) ownTopicHistory.push({ topic, metrics: s.metrics });
    }
  }
  const topicPool = rankTopics({ hotTrends, ownHistory: ownTopicHistory });
  log(`主題候選：${topicPool.length} 個${ownTopicHistory.length ? `（其中 ${ownTopicHistory.length} 則有自家成效可參考）` : '（尚無自家成效，純看搜尋熱度）'}`);

  // 4c) 搜尋字訊號：顧客實際用什麼字找我們（localSearchTerms）＋ 我們想被搜到的字（tags）
  const searchTerms = [...new Set(
    [...(brand.localSearchTerms || []), ...(brand.tags || [])]
      .map((t) => String(t).trim()).filter(Boolean)
  )].slice(0, 25);

  // 5) 品牌知識庫（我們敢背書的事實）——AI 只能用肯定句講這裡有的東西
  const kb = knowledge != null
    ? knowledge
    : loadKnowledge(configDir ? resolveKnowledgePath(configDir, existsSync) : null);
  log(kb ? `知識庫：已載入 ${kb.length} 字` : '知識庫：無（建議建立 config/knowledge.md，讓 AI 敢講你們的專業）');

  // 6) AI 產稿（含分工配比 + 紅隊審稿：把會被抓語病的斷言改成站得住的說法）
  const drafts = await generateDrafts({
    persona: brand.persona, hotTrends, newsTitles, tagPosts, ownPosts,
    topPosts, searchTerms, goalMix: brand.goalMix, humor: brand.humor,
    audienceInterests: brand.audienceInterests || [],
    topicPool,
    // 從「已產過幾則」接著輪：draftsPerRun 小於 goalMix 長度時（例如 3 則 vs 4 種目標），
    // 沒有這個 offset 的話，排在後面的目標會永遠輪不到。
    goalOffset: store.countNativeDrafts?.() ?? 0,
    knowledge: kb, n: brand.draftsPerRun, runner, redTeam, log,
  });

  // 7) 寫入審核佇列
  const sourceSummary = [
    `熱搜 ${hotTrends.length}`,
    `新聞 ${newsTitles.length}`,
    `站內 ${tagPosts.length}`,
    insightsAvailable ? `成效範本 ${topPosts.length}` : null,
  ].filter(Boolean).join('、');
  const ids = drafts.map((d) =>
    store.insertNativeDraft({
      draftText: d.text, angle: d.angle, sourceSummary,
      topic: d.topic, reviewNote: d.reviewNote, goal: d.goal,
    })
  );
  const reviewed = drafts.filter((d) => d.reviewNote).length;

  return {
    generated: ids.length,
    ids,
    hotTrends: hotTrends.length,
    tagPosts: tagPosts.length,
    newsTitles: newsTitles.length,
    ownPosts: ownPosts.length,
    knowledgeChars: kb.length,
    topicPool: topicPool.length, // 主題候選數（依聲量排序後餵給 AI 挑）
    reviewed, // 被紅隊改寫過的則數
    insightsAvailable, // 有沒有讀到自家成效（false = token 缺 threads_manage_insights）
    topPosts: topPosts.length,
    searchTerms: searchTerms.length,
    quotaUsed7d: store.countSearches7d(nowIso),
  };
}
