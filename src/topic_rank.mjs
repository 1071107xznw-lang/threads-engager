import { parseInsights } from './insights.mjs';

// 主題排序：建議 topic 時，優先挑「聲量大」的。
//
// ⚠️ 先講清楚這個模組做不到什麼：
// **Threads API 沒有「這個主題底下有幾則貼文」這個欄位。**
// 你在 App 趨勢頁看到的「N 則貼文」拿不到，官方沒開。所以這裡排的是兩個**代理指標**：
//
//   1. Google Trends 的 approx_traffic —— 那是**搜尋量**，不是 Threads 貼文數。
//      兩者通常同向（大家在搜的事，Threads 上也在聊），但不是同一件事。
//   2. 自家歷史 —— 我們用過這個主題的貼文，平均帶來多少瀏覽。這個最準，
//      因為它量的是「這個主題對**我們的**受眾有沒有用」，但只涵蓋用過的主題。
//
// App 上 Live 之後，keyword_search 才能回傳真實的 Threads 筆數，那時才換得掉第 1 項。
// 在那之前，UI 必須標明這是搜尋熱度，不要讓人誤以為是實測則數。

// Google Trends 的流量字串 → 數字。格式很雜：'20K+'、'200,000+'、'2萬+'、'1M+'、'1000+'。
export function parseTraffic(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const m = /^([\d.,]+)\s*([KMkm萬千億]?)/.exec(s.replace(/\+$/, ''));
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const mult = { K: 1e3, k: 1e3, M: 1e6, m: 1e6, 千: 1e3, 萬: 1e4, 億: 1e8 }[m[2]] ?? 1;
  return n * mult;
}

// 把「自己用過的主題」整理成 { topic, avgViews, n }。
// posts：listOwnPosts 的結果，每則需帶 topic（或 topic_tag）與 insights。
export function ownTopicStats(posts = []) {
  const byTopic = new Map();
  for (const p of posts) {
    const topic = String(p?.topic ?? p?.topic_tag ?? '').trim();
    if (!topic) continue;
    // metrics 可能已解析好，也可能還是原始 insights 回應
    const metrics = p.metrics || (p.insights ? parseInsights(p.insights) : null);
    const views = Number(metrics?.views);
    if (!Number.isFinite(views)) continue;
    const cur = byTopic.get(topic) || { topic, total: 0, n: 0 };
    cur.total += views;
    cur.n += 1;
    byTopic.set(topic, cur);
  }
  return [...byTopic.values()]
    .map(({ topic, total, n }) => ({ topic, avgViews: Math.round(total / n), n }))
    .sort((a, b) => b.avgViews - a.avgViews);
}

// 合併排序。回傳 [{ topic, traffic, avgViews, score, source, ownNote }]，分數由高到低。
//
// 為什麼自家成效要乘以權重而不是直接相加：兩個指標的量級差好幾個數量級
// （搜尋熱度動輒幾十萬，自家貼文瀏覽是幾百幾千）。直接加的話自家那項等於沒作用。
// 所以各自正規化到 0～1 再加權，自家成效權重較高——它量的是「對我們的受眾有沒有用」。
export function rankTopics({ hotTrends = [], ownHistory = [], limit = 25, ownWeight = 1.5 } = {}) {
  const own = new Map(ownTopicStats(ownHistory).map((s) => [s.topic, s]));
  const rows = new Map();

  for (const t of hotTrends) {
    const topic = String(t?.topic ?? '').trim();
    if (!topic) continue;
    rows.set(topic, { topic, traffic: t.traffic || null, trafficN: parseTraffic(t.traffic), avgViews: 0, n: 0 });
  }
  // 自家用過但不在熱搜清單裡的，也要進候選——它們對我們的受眾已經被驗證過了
  for (const s of own.values()) {
    const cur = rows.get(s.topic) || { topic: s.topic, traffic: null, trafficN: 0, avgViews: 0, n: 0 };
    cur.avgViews = s.avgViews;
    cur.n = s.n;
    rows.set(s.topic, cur);
  }

  const all = [...rows.values()];
  const maxTraffic = Math.max(1, ...all.map((r) => r.trafficN));
  const maxViews = Math.max(1, ...all.map((r) => r.avgViews));

  return all
    .map((r) => ({
      topic: r.topic,
      traffic: r.traffic,
      avgViews: r.avgViews,
      score: (r.trafficN / maxTraffic) + ownWeight * (r.avgViews / maxViews),
      source: r.trafficN && r.avgViews ? 'both' : (r.avgViews ? 'own' : 'trends'),
      ownNote: r.n ? `自家用過 ${r.n} 次，平均 ${r.avgViews} 瀏覽` : null,
    }))
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    .slice(0, Math.max(0, limit));
}
