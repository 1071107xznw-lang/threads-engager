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
