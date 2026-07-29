import { HARD_SEARCH_CAP_7D } from './brand.mjs';

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
export async function searchKeyword({ api, store, accessToken, q, limit = 10, cap, nowIso = new Date().toISOString() }) {
  const effectiveCap = Math.min(Number(cap) || HARD_SEARCH_CAP_7D, HARD_SEARCH_CAP_7D);
  const used = store.countSearches7d(nowIso);
  if (used >= effectiveCap) throw new SearchQuotaError(used, effectiveCap);
  store.logSearch(q, nowIso);
  const res = await api.keywordSearch({ accessToken, q, limit });
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
  nowIso = new Date().toISOString(),
  log = console.log,
}) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    let posts;
    try {
      posts = await searchKeyword({ api, store, accessToken, q: tag, limit: perTag, cap, nowIso });
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
