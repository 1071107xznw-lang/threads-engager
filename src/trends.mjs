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
