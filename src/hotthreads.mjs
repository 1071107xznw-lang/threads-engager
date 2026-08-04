// 🔍 關鍵字找熱門串：輸入一個關鍵字，整理出可以去留言的公開串連結清單。
//
// ⚠️ 兩個誠實的限制，UI 上也要照講：
//
// 1. **拿不到觀看次數**。Threads API 的 insights 只能讀「自己」的貼文；
//    別人的貼文沒有公開的觀看/按讚數。所以無法真的照觀看數排序。
//    能用的最接近替代是 search_type=TOP——Threads 自己的熱門排序。
//
// 2. **App 在 Development 模式時只會回你自己的貼文**，等於沒資料。
//    要上 Live 才有用（見 docs/go-live-checklist.md）。
//
// 這裡不做任何自動留言：只產出連結清單，你自己點進去用 Threads 手動留言。

import { searchKeyword, SearchQuotaError } from './threads_search.mjs';

// 一次搜尋最多打幾次 API（每次都計入 7 天額度，所以刻意保守）。
const MAX_CALLS = 2;

export function normalizeKeyword(input) {
  const s = String(input ?? '').trim().replace(/^#/, '');
  if (!s) throw new Error('請輸入關鍵字');
  if ([...s].length > 50) throw new Error('關鍵字太長（上限 50 字）');
  return s;
}

// 整理成清單用的精簡格式。
export function toRow(p) {
  return {
    id: p.id,
    text: String(p.text || '').trim(),
    username: p.username || null,
    permalink: p.permalink || null,
    timestamp: p.timestamp || null,
  };
}

export async function findHotThreads({
  api,
  store,
  accessToken,
  keyword,
  limit = 20,
  cap,
  ownUsername = null,
  nowIso = new Date().toISOString(),
  sleepImpl,
  log = () => {},
}) {
  const q = normalizeKeyword(keyword);
  const seen = new Set();
  const rows = [];
  let quotaExhausted = false;
  let ownOnly = 0; // 濾掉幾則自己的——全部都是自己的通常代表 App 還在 Dev 模式

  // 先抓 TOP（熱門排序）；不夠 20 則再補 RECENT。
  const passes = [
    { searchType: 'TOP', want: limit },
    { searchType: 'RECENT', want: limit },
  ].slice(0, MAX_CALLS);

  for (const pass of passes) {
    if (rows.length >= limit) break;
    let posts = [];
    try {
      posts = await searchKeyword({
        api, store, accessToken, q, limit: pass.want, cap, nowIso,
        searchType: pass.searchType, sleepImpl, log,
      });
    } catch (e) {
      if (e instanceof SearchQuotaError) { quotaExhausted = true; log(`⚠️ ${e.message}`); break; }
      log(`⚠️ 搜尋「${q}」（${pass.searchType}）失敗：${e.message}`);
      continue;
    }
    for (const p of posts) {
      if (!p || !p.id || seen.has(p.id)) continue;
      if (!String(p.text || '').trim()) continue;
      if (ownUsername && p.username === ownUsername) { ownOnly += 1; continue; }
      seen.add(p.id);
      rows.push(toRow(p));
      if (rows.length >= limit) break;
    }
  }

  // Dev 模式的特徵：搜得到東西，但全部都是自己的貼文。
  const devModeLikely = rows.length === 0 && ownOnly > 0;

  return {
    keyword: q,
    results: rows,
    quotaUsed7d: store.countSearches7d(nowIso),
    quotaExhausted,
    devModeLikely,
    // 讓 UI 有據可說，不要假裝有觀看數
    note: 'Threads API 不提供他人貼文的觀看/按讚數，故依 Threads 自己的熱門排序（TOP）呈現。',
  };
}
