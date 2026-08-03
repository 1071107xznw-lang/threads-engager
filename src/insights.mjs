// 自己貼文的成效（Threads Insights）：讀數據 → 算互動分數 → 排出「哪幾則真的有流量」。
//
// 為什麼要這個：產稿時如果只拿「最新」的貼文當語氣範本，等於每次都在複製自己的平均值，
// 流量池永遠放大不了。拿「表現最好」的當範本，才會愈寫愈準。
//
// 權限：需要 token 具備 threads_manage_insights。沒有的話全部 fail-open——
// 回傳 available:false，產稿照跑（只是少了這個訊號），絕不因為讀不到數據就少一則稿。

// 各指標在「值不值得模仿」上的權重。
//
// 留言最貴：Threads 演算法吃互動，而且留言是真人關係的起點。
// 轉發/引用次之（把你推到別人的同溫層外）；讚最便宜。
//
// ⚠️ 瀏覽數權重刻意壓很低：一般互動率只有幾 %，瀏覽數量級遠大於互動數，
//    權重給高一點就會整個蓋掉互動訊號——變成「5000 瀏覽 2 個讚」排在
//    「800 瀏覽 30 則留言」前面。但觸及是結果不是原因，那種貼文不值得模仿。
//    所以瀏覽只當微弱加分（同樣有互動時，觸及大的排前面）。
export const DEFAULT_WEIGHTS = {
  views: 0.1,
  likes: 3,
  replies: 25,
  reposts: 15,
  quotes: 15,
  shares: 10,
};

const METRIC_KEYS = Object.keys(DEFAULT_WEIGHTS);

// 從 Insights API 回應取出各指標數字。
// media 版用 values:[{value}]，user 版用 total_value:{value}——兩種都吃，缺的算 0。
export function parseInsights(json) {
  const out = {};
  for (const k of METRIC_KEYS) out[k] = 0;
  const rows = Array.isArray(json?.data) ? json.data : [];
  for (const row of rows) {
    const name = row?.name;
    if (!name || !(name in out)) continue;
    let v = null;
    if (row.total_value && typeof row.total_value.value === 'number') {
      v = row.total_value.value;
    } else if (Array.isArray(row.values) && row.values.length) {
      // 時間序列（如 views）取總和；lifetime 只有一筆，總和即該值
      v = row.values.reduce((sum, item) => sum + (Number(item?.value) || 0), 0);
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[name] = v;
  }
  return out;
}

// 互動總數（不含瀏覽）：給人看的「這則有多少人真的動手」。
export function interactionCount(m = {}) {
  return (Number(m.likes) || 0) + (Number(m.replies) || 0)
    + (Number(m.reposts) || 0) + (Number(m.quotes) || 0) + (Number(m.shares) || 0);
}

// 加權分數：用來排名「值得模仿的程度」。
export function engagementScore(m = {}, weights = DEFAULT_WEIGHTS) {
  let score = 0;
  for (const k of METRIC_KEYS) score += (Number(m[k]) || 0) * (weights[k] || 0);
  return score;
}

// 一句話成效摘要，直接塞進 prompt 給 AI 看（有數字才學得到「什麼有效」）。
export function summarizeMetrics(m = {}) {
  const parts = [];
  if (m.views) parts.push(`瀏覽 ${m.views}`);
  if (m.likes) parts.push(`讚 ${m.likes}`);
  if (m.replies) parts.push(`留言 ${m.replies}`);
  const spread = (Number(m.reposts) || 0) + (Number(m.quotes) || 0) + (Number(m.shares) || 0);
  if (spread) parts.push(`轉發/引用 ${spread}`);
  return parts.join('、') || '無數據';
}

// 抓一批自己貼文的成效並排名。
// posts：listOwnPosts 回來的陣列（需含 id、text）。
// 回 { available, top, scored, reason }：available=false 代表沒權限或整批讀不到。
export async function rankOwnPosts({
  api,
  accessToken,
  posts = [],
  limit = 5,        // 回傳前幾名
  maxFetch = 15,    // 最多讀幾則的數據（每則一次 API 呼叫）
  minViews = 0,     // 低於此瀏覽數不列入「冠軍」（避免剛發還沒跑的貼文佔位）
  log = () => {},
}) {
  const candidates = posts.filter((p) => p && p.id && p.text).slice(0, maxFetch);
  if (!candidates.length) return { available: false, top: [], scored: 0, reason: '沒有可讀的貼文' };

  const scored = [];
  let consecutiveFailures = 0;
  let firstError = '';

  for (const p of candidates) {
    try {
      const json = await api.getMediaInsights({ accessToken, mediaId: p.id });
      const metrics = parseInsights(json);
      consecutiveFailures = 0;
      scored.push({
        id: p.id,
        text: p.text,
        permalink: p.permalink || null,
        timestamp: p.timestamp || null,
        metrics,
        interactions: interactionCount(metrics),
        score: engagementScore(metrics),
      });
    } catch (e) {
      consecutiveFailures += 1;
      if (!firstError) firstError = e.message || String(e);
      // 前 3 則就全掛 → 大概是沒權限或 token 有問題，不用再打 12 次白費
      if (consecutiveFailures >= 3 && scored.length === 0) {
        log(`⚠️ 讀不到貼文成效（略過成效訊號）：${firstError}`);
        log('   👉 多半是 token 少了 threads_manage_insights 權限，重新產一次 token 即可。');
        return { available: false, top: [], scored: 0, reason: firstError };
      }
    }
  }

  if (!scored.length) {
    log(`⚠️ 讀不到任何貼文成效（略過）：${firstError || '未知原因'}`);
    return { available: false, top: [], scored: 0, reason: firstError };
  }

  const ranked = scored
    .filter((s) => s.metrics.views >= minViews)
    .sort((a, b) => b.score - a.score);

  return { available: true, top: ranked.slice(0, limit), all: ranked, scored: scored.length, reason: '' };
}
