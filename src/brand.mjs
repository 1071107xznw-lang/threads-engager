import { readFileSync } from 'node:fs';

// Argo 品牌／內容產生設定的預設值。config/argo.json 可覆寫任一欄位。
export const DEFAULT_BRAND = {
  brandName: 'Argo',
  persona:
    '你是台北大安區餐酒吧「Argo」的社群小編。語氣親切、輕鬆、帶點俏皮，會用少量 emoji，' +
    '內容自然口語、不硬推銷、不鼓勵過量飲酒，全程繁體中文。',
  tags: ['調酒', '台北酒吧'],
  // 站內 keyword_search：App 在 Development 模式時只會回自己帳號的貼文，
  // 拿不到別人的公開趨勢還會消耗額度，故預設關閉；App 通過審核上 Live 後改 true。
  useThreadsSearch: false,
  draftsPerRun: 3,
  perTagPosts: 8,
  searchCap7d: 400,
  newsFeeds: [],
  // 全網即時熱搜（Google Trends RSS 等）：搜尋量飆高的時勢主題，不限酒吧相關
  hotTrendsFeeds: [],
  // 回覆別人貼文（Phase 3）——產草稿用；送出一律人工核准
  replyPersona:
    '你代表台北餐酒吧 Argo，路過別人的公開貼文留一則回覆。語氣友善、貼題、有梗或有共鳴、' +
    '像真人隨口留言，繁體中文、≤120 字，不推銷、不放連結、不用 hashtag、不要硬提自己的店。',
  replyThreshold: 0.6, // AI 相關性分數門檻，未過不產草稿
  replyDailyCap: 8, // 每日送出回覆上限
  replyPerRun: 15, // 每次搜尋最多對幾則新候選產草稿
  // 回覆專用的聚焦 tag（比原生貼文趨勢的 tags 精簡，避免搜太發散＋省額度）
  replyTags: ['調酒', '台北酒吧', '餐酒館', '微醺'],
};

// 官方硬上限：滾動 7 天內 keyword_search 查詢數不得超過此值（CLAUDE.md 規則 6）。
export const HARD_SEARCH_CAP_7D = 500;

export function loadBrand(path) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // 沒有設定檔就用預設
  }
  const merged = { ...DEFAULT_BRAND, ...raw };
  // 額度上限不得超過官方硬上限
  merged.searchCap7d = Math.min(Number(merged.searchCap7d) || DEFAULT_BRAND.searchCap7d, HARD_SEARCH_CAP_7D);
  return merged;
}
