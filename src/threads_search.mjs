import { HARD_SEARCH_CAP_7D } from './brand.mjs';
import { withRetry, clampCap } from './quota.mjs';

// 站內趨勢素材蒐集：用官方 keyword_search 搜多個 tag，帶額度守門。
// 只用於「找靈感 / 看近期話題」，不用於回覆別人貼文（那屬 Phase 3 且需人工核准）。

export class SearchQuotaError extends Error {
  constructor(used, cap) {
    super(`已達 keyword_search 額度上限（近 7 天已用 ${used}／${cap}），暫停搜尋以保護帳號額度`);
    this.name = 'SearchQuotaError';
    this.used = used;
    this.cap = cap;
  }
}

// 搜單一關鍵字（先過額度守門，通過才計數並呼叫 API）。
// 限流/5xx 會指數退避重試；每次實際呼叫都計入額度（保守計算，寧可少搜也不撞頂）。
export async function searchKeyword({
  api, store, accessToken, q, limit = 10, cap, nowIso = new Date().toISOString(),
  searchType = 'TOP', // TOP＝Threads 自己的熱門排序；RECENT＝時間序
  retries = 2, sleepImpl, log = () => {},
}) {
  const effectiveCap = clampCap(cap);
  // 額度守門放進 withRetry 內：每次實際打 API 前都重查一次，
  // 因為每次退避重試都會再打一次 API、再計一次額度——守門若只在外面做一次，
  // 重試會突破官方 7 天硬上限。SearchQuotaError 不可重試，會直接中止並上拋。
  const res = await withRetry(
    () => {
      const used = store.countSearches7d(nowIso);
      if (used >= effectiveCap) throw new SearchQuotaError(used, effectiveCap);
      store.logSearch(q, nowIso);
      return api.keywordSearch({ accessToken, q, limit, searchType });
    },
    { retries, sleepImpl, log },
  );
  return res.data || [];
}

// 搜多個 tag、去重（by id）、濾掉自己帳號的貼文、回精簡素材。
// 額度不足時停止後續 tag，回已蒐集到的（不整批失敗）。
export async function gatherTagPosts({
  api,
  store,
  accessToken,
  tags,
  perTag = 8,
  cap,
  ownUsername = null,
  maxTags, // 由 quota.planRun 算出的本輪 tag 上限（額度感知；未給則全部搜）
  retries = 2,
  sleepImpl,
  nowIso = new Date().toISOString(),
  log = console.log,
}) {
  const seen = new Set();
  const out = [];
  const useTags = Number.isFinite(maxTags) ? tags.slice(0, Math.max(0, maxTags)) : tags;
  for (const tag of useTags) {
    let posts;
    try {
      posts = await searchKeyword({
        api, store, accessToken, q: tag, limit: perTag, cap, nowIso, retries, sleepImpl, log,
      });
    } catch (e) {
      if (e instanceof SearchQuotaError) {
        log(`⚠️ ${e.message}`);
        break;
      }
      log(`⚠️ 搜尋「${tag}」失敗：${e.message}`);
      continue;
    }
    for (const p of posts) {
      if (!p.id || seen.has(p.id)) continue;
      if (ownUsername && p.username === ownUsername) continue; // 濾掉自己
      if (!p.text || !p.text.trim()) continue;
      seen.add(p.id);
      out.push({ id: p.id, text: p.text.trim(), username: p.username, permalink: p.permalink, tag });
    }
  }
  return out;
}
