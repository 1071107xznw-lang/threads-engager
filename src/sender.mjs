import { chromium } from 'playwright';

export const SAME_AUTHOR_WINDOW_HOURS = 168;

export function pickSendable({ approved, sentToday, dailyCap, recentAuthors }) {
  const budget = Math.max(0, dailyCap - sentToday);
  const seen = new Set(recentAuthors);
  const out = [];
  for (const row of approved) {
    if (out.length >= budget) break;
    if (seen.has(row.author)) continue;
    seen.add(row.author);
    out.push(row);
  }
  return out;
}

export function humanDelay(minMs, maxMs, rng = Math.random) {
  return Math.round(minMs + (maxMs - minMs) * rng());
}

export async function defaultOpenContext(profilePath) {
  const context = await chromium.launchPersistentContext(profilePath, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// 最佳猜測選擇器 — 執行階段需人工驗證/修正
export async function defaultPostReply(page, threadUrl, text) {
  await page.goto(threadUrl, { waitUntil: 'networkidle' });
  await page.click('svg[aria-label="回覆"], svg[aria-label="Reply"]');
  await page.fill('textarea, [contenteditable="true"]', text);
  await page.click('div[role="button"]:has-text("發布"), div[role="button"]:has-text("Post")');
  await page.waitForTimeout(2000);
}

export async function sendReplies(
  account,
  {
    store,
    openContext = defaultOpenContext,
    postReply = defaultPostReply,
    dryRun = false,
    rng = Math.random,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    nowIso = new Date().toISOString(),
  }
) {
  const approved = store.listByStatus(account.name, 'approved');
  const sentToday = store.countSentToday(account.name, nowIso);
  const sinceIso = new Date(Date.parse(nowIso) - SAME_AUTHOR_WINDOW_HOURS * 3600 * 1000).toISOString();
  const recentAuthors = store.recentAuthors(account.name, sinceIso);
  const sendable = pickSendable({ approved, sentToday, dailyCap: account.dailyCap, recentAuthors });

  let sent = 0;
  let failed = 0;
  if (sendable.length === 0) return { attempted: 0, sent: 0, skipped: approved.length, failed: 0 };

  const { context, page } = await openContext(account.profilePath);
  try {
    for (const row of sendable) {
      const text = row.editedText || row.draftText;
      try {
        if (!dryRun) {
          await postReply(page, row.threadUrl, text);
          store.markSent(row.id, new Date().toISOString());
        }
        sent += 1;
      } catch (e) {
        store.markFailed(row.id, String(e.message || e));
        failed += 1;
      }
      await sleep(humanDelay(30000, 120000, rng));
    }
  } finally {
    await context.close();
  }
  return { attempted: sendable.length, sent, skipped: approved.length - sendable.length, failed };
}
