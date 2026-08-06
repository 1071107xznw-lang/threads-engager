import { readFileSync } from 'node:fs';

// 「不要小編腔」的共用硬規則。三條產出路徑（原生貼文／主動回覆／💬 留言區）都吃這一份，
// 免得改了一處、另外兩處還在發客服罐頭。
//
// 為什麼要獨立成一條禁令、而不是只寫在人設裡：產稿時會把「自己過去的貼文」當語氣樣本餵進去，
// 而過去的貼文裡本來就有小編口吻——光改人設壓不住，樣本會把它拉回去。要有明確的禁止句。
export const PERSONAL_VOICE_RULES = [
  '## 🙅 不要小編腔',
  '- **不准自稱「小編」**，一次都不行。這是個人自媒體帳號，不是官方客服窗口。',
  '- 用「我」。不要用「我們」把自己講成一個機構——只有在講店裡的實際做法時才用「我們」。',
  '- 禁止客服罐頭：「感謝您的支持」「歡迎蒞臨」「我們會持續努力」「很高興為您服務」。',
  '- 不要塞地址、營業時間、官方公告語、hashtag——除非對方就是在問這個。',
  '- 標準是：像一個真的人滑手機看到順手回，不是一個品牌在發聲明。',
].join('\n');

// 品牌／內容產生設定的中性預設值。由設定精靈寫入的 config/brand.json 覆寫任一欄位。
export const DEFAULT_BRAND = {
  brandName: '',
  persona:
    '你是這個帳號背後的那個人，用個人自媒體的方式講話——第一人稱、口語、有自己的觀點，' +
    '不是官方客服。少量 emoji，內容真誠、不硬推銷，使用貼文慣用語言（預設繁體中文）。',
  tags: [],
  // 站內 keyword_search：App 在 Development 模式時只會回自己帳號的貼文，
  // 拿不到別人的公開趨勢還會消耗額度，故預設關閉；App 通過審核上 Live 後改 true。
  useThreadsSearch: false,
  // 成效回饋：讀自己貼文的數據，拿「表現最好的」當產稿範本（而不是拿「最新的」）。
  // 需要 token 具備 threads_manage_insights；沒有權限會自動略過、不擋產稿。
  useInsights: true,
  // 顧客實際用什麼字找到你（例：Google 商家檔案「成效 → 搜尋字詞」抄過來）。
  // 成長期資料少很正常，先留空也可以；有幾個就填幾個。
  localSearchTerms: [],
  // 每批草稿的任務分工，依序循環套用。成長期建議「觸及 → 互動 → 品牌 → 分享」各一，
  // 不要三則都在講自己的店。可選值：reach（蹭熱搜衝觸及）、engage（誘留言）、
  // brand（品牌記憶點）、share（衝 ✈️ 分享——會把貼文帶出演算法之外，進私訊與限動）、
  // story（段子——分享率最高，但最難寫；不好笑的笑話比不發還糟）。
  goalMix: ['reach', 'engage', 'brand', 'share', 'story'],
  // 幽默尺度：mild（溫和）/ spicy（有梗，預設）/ hellish（地獄梗）。
  // 跟法規紅線是兩回事——法規任何尺度都不能碰，這個純粹是品牌個性。
  humor: 'spicy',
  draftsPerRun: 3,
  perTagPosts: 8,
  searchCap7d: 400,
  newsFeeds: [],
  // 全網即時熱搜（Google Trends RSS）：搜尋量飆高的時勢主題。預設台灣，可改 geo。
  hotTrendsFeeds: ['https://trends.google.com/trending/rss?geo=TW'],
  // 回覆別人貼文——產草稿用；送出一律人工核准
  replyPersona:
    '你路過別人的公開貼文，順手留一則回覆。語氣像真人隨口留言——貼題、有梗或有共鳴，' +
    '≤120 字，不推銷、不放連結、不用 hashtag、不自我介紹、不硬提自己的店。',
  // 語氣樣本：拿「自己回過別人的留言」當範本（不是拿貼文）。
  // 為什麼分開：貼文是「發表」的語氣，留言是「對話」的語氣，兩者差很多。
  // 要回得像本人，樣本就要取自本人真的在對話時怎麼講話。
  useOwnReplies: true,
  ownReplySamples: 12, // 餵幾則進 prompt
  replyThreshold: 0.6, // AI 相關性分數門檻，未過不產草稿
  replyDailyCap: 8, // 每日「主動去別人串下留言」上限
  // 💬 留言區（別人在你自己貼文底下留言）：回客人是主人的常態行為，
  // 不套同作者去重，上限也比 outreach 寬。
  inboxDailyCap: 20,
  inboxPerRun: 15, // 一輪最多為幾則未回留言產草稿
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
