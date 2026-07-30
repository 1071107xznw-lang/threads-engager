import { HARD_SEARCH_CAP_7D } from './brand.mjs';

// 額度感知與退避：讓自動化在「官方允許的上限附近穩定跑滿」，而不是撞頂後整批失敗。
// 這裡處理的是官方公開的 rate limit（吞吐天花板），不是任何規避偵測的手段。

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 把 cap 夾到 [0, 硬上限]。cap=0 代表「關閉搜尋」而非「無上限」，
// 所以不能用 `Number(cap) || HARD`（那會把 0 翻成最大值）；非數字/負數才回落預設。
export function clampCap(cap) {
  const n = Number(cap);
  if (!Number.isFinite(n) || n < 0) return HARD_SEARCH_CAP_7D;
  return Math.min(n, HARD_SEARCH_CAP_7D);
}

// 近 7 天滾動窗的 keyword_search 用量／剩餘。
export function remainingSearchQuota({ store, cap, nowIso = new Date().toISOString() }) {
  const effectiveCap = clampCap(cap);
  const used = store.countSearches7d(nowIso);
  return { used, cap: effectiveCap, remaining: Math.max(0, effectiveCap - used) };
}

// 依「剩餘額度」決定這一輪要搜幾個 tag（一個 tag = 一次 keyword_search）。
//
// 自適應原理：把剩餘額度平均分配給 7 天內預期的剩餘輪次。額度充裕 → 每輪多搜；
// 用得快 → remaining 變小 → 下一輪自動降頻。不需要人工調參，也不會在週期前段燒光。
// reserveRatio 保留一小部分額度給白天手動操作用。
export function planRun({
  remaining,
  tagCount,
  runsPer7d = 28, // 預設每 6 小時一輪 → 7 天 28 輪
  reserveRatio = 0.1,
  maxTagsPerRun = Infinity,
}) {
  const rem = Math.max(0, Number(remaining) || 0);
  const runs = Math.max(1, Number(runsPer7d) || 1);
  const ratio = Number.isFinite(Number(reserveRatio)) ? Number(reserveRatio) : 0.1;
  const usable = Math.floor(rem * (1 - Math.min(Math.max(ratio, 0), 1)));
  const perRun = Math.floor(usable / runs);
  const tags = Math.max(0, Math.min(Number(tagCount) || 0, perRun, maxTagsPerRun));
  return {
    tags,
    perRunBudget: perRun,
    usable,
    // 額度太少、這輪不值得跑（呼叫端應直接跳過並記 log，而不是硬搜到撞頂）
    skip: tags === 0,
  };
}

// 判斷錯誤是否值得重試：限流(429)、伺服器端(5xx)、暫時性網路錯誤。
// 4xx（權限、參數、額度政策）不重試——重試只會再撞一次。
export function isRetryableError(e) {
  const status = e?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  const code = e?.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  return false;
}

// 指數退避重試。
//
// ⚠️ 只可用於「唯讀」呼叫（keyword_search、getProfile 等）。
// 絕不可包住發文／回覆的送出流程：容器已建立但發布失敗時重試整段，
// 會建出第二個容器而重複對外發送。送出失敗一律回報給人，由人決定。
export async function withRetry(fn, {
  retries = 3,
  baseMs = 1000,
  maxMs = 30000,
  sleepImpl = defaultSleep,
  isRetryable = isRetryableError,
  log = () => {},
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      attempt += 1;
      if (attempt > retries || !isRetryable(e)) throw e;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      log(`⏳ 第 ${attempt}/${retries} 次重試（等 ${delay}ms）：${e.message}`);
      await sleepImpl(delay);
    }
  }
}
