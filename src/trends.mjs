// 網路趨勢素材：抓公開的 Google News RSS（台灣中文），取近期新聞標題當靈感。
// 走公開 feed、非爬蟲（符合 CLAUDE.md 規則 4）。趨勢是「加分素材」，取用失敗不阻斷生產線。

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => ENTITIES[m] || m);
}

// 從 RSS XML 抽出 <item> 的標題（處理 CDATA 與基本 entity）。
export function parseRssTitles(xml, limit = 15) {
  const titles = [];
  const items = String(xml).split(/<item[>\s]/i).slice(1);
  for (const item of items) {
    const m = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) continue;
    let t = m[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    t = decodeEntities(t).trim();
    if (t) titles.push(t);
    if (titles.length >= limit) break;
  }
  return titles;
}

// 解析 Google Trends 即時熱搜 RSS（新版 /trending/rss 格式）：
// <item><title>熱搜詞</title><ht:approx_traffic>10000+</ht:approx_traffic>
//       <ht:news_item><ht:news_item_title>背景新聞</ht:news_item_title>…
// 回 [{ topic, traffic, context }]，代表「當下搜尋量突然飆高」的時勢主題。
export function parseTrendingTopics(xml, limit = 12) {
  const out = [];
  const items = String(xml).split(/<item>/i).slice(1);
  for (const item of items) {
    const t = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!t) continue;
    const topic = decodeEntities(t[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).trim();
    if (!topic) continue;
    const traffic = item.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1]?.trim() || null;
    const newsTitle = item.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/i)?.[1];
    const context = newsTitle
      ? decodeEntities(newsTitle.trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).trim()
      : null;
    out.push({ topic, traffic, context });
    if (out.length >= limit) break;
  }
  return out;
}

// 抓即時熱搜主題（Google Trends 台灣）。與 fetchNewsTitles 同樣失敗容忍。
export async function fetchTrendingTopics({ fetchImpl = fetch, feeds = [], limit = 12, log = console.log }) {
  const all = [];
  for (const url of feeds) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArgoContentBot/1.0)' },
      });
      if (!res.ok) {
        log(`⚠️ 熱搜 RSS 回應 ${res.status}：${url}`);
        continue;
      }
      all.push(...parseTrendingTopics(await res.text(), limit));
    } catch (e) {
      log(`⚠️ 熱搜 RSS 取用失敗（略過）：${e.message}`);
    }
  }
  // 依 topic 去重，保留先出現者（feed 本身已按熱度排序）
  const seen = new Set();
  return all.filter((t) => (seen.has(t.topic) ? false : (seen.add(t.topic), true))).slice(0, limit);
}

export async function fetchNewsTitles({ fetchImpl = fetch, feeds = [], limit = 15, log = console.log }) {
  const all = [];
  for (const url of feeds) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArgoContentBot/1.0)' },
      });
      if (!res.ok) {
        log(`⚠️ RSS 回應 ${res.status}：${url}`);
        continue;
      }
      const xml = await res.text();
      all.push(...parseRssTitles(xml, limit));
    } catch (e) {
      log(`⚠️ RSS 取用失敗（略過）：${e.message}`);
    }
  }
  return [...new Set(all)].slice(0, limit);
}
