import { chromium } from 'playwright';

export function filterPosts(posts, { recencyHours, minLikes, nowMs }) {
  const cutoff = nowMs - recencyHours * 3600 * 1000;
  return posts.filter(
    (p) => p.likes >= minLikes && Date.parse(p.postedAt) >= cutoff
  );
}

export async function defaultOpenContext(profilePath) {
  const context = await chromium.launchPersistentContext(profilePath, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// 選擇器已於 2026-06-19 對 threads.com 真實頁面驗證校準
// 注意：搜尋頁 DOM 不暴露讚數，likes 一律 0；過濾請靠 AI 相關性評分（見 ai.mjs）
export async function defaultExtractPosts(page, tag) {
  const q = encodeURIComponent(tag.replace(/^#/, ''));
  await page.goto(`https://www.threads.com/search?q=${q}&serp_type=default`, {
    waitUntil: 'networkidle',
  });
  return page.$$eval('[data-pressable-container] a[href*="/post/"]', (anchors) => {
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      // 正規化：去掉 query/hash 與 /media 後綴，避免同篇重複
      const url = a.href.split('?')[0].split('#')[0].replace(/\/media$/, '');
      const m = url.match(/\/@([^/]+)\/post\//);
      if (!m || seen.has(url)) continue;
      seen.add(url);
      const container = a.closest('[data-pressable-container]');
      out.push({
        threadUrl: url,
        author: m[1], // 從 URL 解析作者帳號，比 DOM 選擇器可靠
        content: container?.innerText?.trim() || '',
        likes: 0,
        postedAt: container?.querySelector('time')?.getAttribute('datetime') || new Date().toISOString(),
      });
    }
    return out;
  });
}

export async function scrapeAccount(
  account,
  { store, openContext = defaultOpenContext, extractPosts = defaultExtractPosts, dryRun = false, nowMs = Date.now() }
) {
  const { context, page } = await openContext(account.profilePath);
  let found = 0;
  let kept = 0;
  let inserted = 0;
  try {
    for (const tag of account.tags) {
      const raw = await extractPosts(page, tag);
      found += raw.length;
      const filtered = filterPosts(raw, { ...account.filters, nowMs });
      kept += filtered.length;
      if (!dryRun) {
        for (const p of filtered) {
          if (store.upsertPost({ account: account.name, ...p }).inserted) inserted += 1;
        }
      }
    }
  } finally {
    await context.close();
  }
  return { found, kept, inserted };
}
