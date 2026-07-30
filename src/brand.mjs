import { readFileSync } from 'node:fs';

// 品牌／內容產生設定的中性預設值。由設定精靈寫入的 config/brand.json 覆寫任一欄位。
export const DEFAULT_BRAND = {
  brandName: '',
  persona:
    '你是這個品牌帳號的社群小編。語氣自然、親切、口語，會用少量 emoji，' +
    '內容真誠、不硬推銷，使用貼文慣用語言（預設繁體中文）。',
  tags: [],
  // 站內 keyword_search：App 在 Development 模式時只會回自己帳號的貼文，
  // 拿不到別人的公開趨勢還會消耗額度，故預設關閉；App 通過審核上 Live 後改 true。
  useThreadsSearch: false,
  draftsPerRun: 3,
  perTagPosts: 8,
  searchCap7d: 400,
  newsFeeds: [],
  // 全網即時熱搜（Google Trends RSS）：搜尋量飆高的時勢主題。預設台灣，可改 geo。
  hotTrendsFeeds: ['https://trends.google.com/trending/rss?geo=TW'],
  // 回覆別人貼文——產草稿用；送出一律人工核准
  replyPersona:
    '你代表這個品牌，路過別人的公開貼文留一則回覆。語氣友善、貼題、有梗或有共鳴、' +
    '像真人隨口留言，≤120 字，不推銷、不放連結、不用 hashtag、不硬提自己。',
  replyThreshold: 0.6, // AI 相關性分數門檻，未過不產草稿
  replyDailyCap: 8, // 每日送出回覆上限
  replyPerRun: 15, // 每次搜尋最多對幾則新候選產草稿
  replyTags: [], // 回覆專用的聚焦 tag（比 tags 精簡，省額度）
};

// 依序尋找品牌設定檔：使用者的 brand.json → 舊的 argo.json（相容）→ 皆無則用預設。
export function resolveBrandPath(dir, existsSync) {
  const brandJson = `${dir}/brand.json`;
  const argoJson = `${dir}/argo.json`;
  if (existsSync(brandJson)) return brandJson;
  if (existsSync(argoJson)) return argoJson;
  return brandJson; // 尚未設定；loadBrand 會回落到 DEFAULT_BRAND
}

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
  // 額度上限不得超過官方硬上限；0 代表「關閉搜尋」而非回落預設，故只有非數字/負數才用預設。
  const n = Number(merged.searchCap7d);
  merged.searchCap7d = Number.isFinite(n) && n >= 0
    ? Math.min(n, HARD_SEARCH_CAP_7D)
    : Math.min(DEFAULT_BRAND.searchCap7d, HARD_SEARCH_CAP_7D);
  return merged;
}
