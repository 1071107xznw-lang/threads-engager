import { createApi } from './threads_api.mjs';

// 同一作者回覆去重窗口（小時）。
export const SAME_AUTHOR_WINDOW_HOURS = 168;
const MAX_TEXT_LEN = 500;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 從已核准清單挑出可送的。兩種來源、兩套限制：
//
// · outreach（主動去別人串下留言）：受每日上限 + 同作者一週去重。
//   這些限制是為了「不要看起來像騷擾機器人」。
// · inbox（別人在你自己貼文底下留言）：你是主人，回客人是常態行為，
//   不套同作者去重（同一人留言兩次本來就該回兩次），改用較寬的 inboxDailyCap。
//
// 純函式，自舊 sender.mjs 搬入。
export function pickSendable({
  approved, sentToday, dailyCap, recentAuthors,
  inboxSentToday = 0, inboxDailyCap = 20,
}) {
  const budget = Math.max(0, dailyCap - sentToday);
  const inboxBudget = Math.max(0, inboxDailyCap - inboxSentToday);
  const seen = new Set(recentAuthors);
  const out = [];
  let used = 0;
  let inboxUsed = 0;
  for (const row of approved) {
    if (row.kind === 'inbox') {
      if (inboxUsed >= inboxBudget) continue;
      inboxUsed += 1;
      out.push(row);
      continue;
    }
    if (used >= budget) continue; // 額度用完只跳過這則，讓後面的 inbox 仍可送
    if (row.author && seen.has(row.author)) continue;
    if (row.author) seen.add(row.author);
    used += 1;
    out.push(row);
  }
  return out;
}

// 解析手動輸入的目標貼文 ID。reply_to_id 要的是貼文的 media ID（數字字串），
// 不是貼文網址——網址裡的短碼無法直接當 reply_to_id，所以貼網址時給明確指引。
export function parseTargetId(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('請填入目標貼文的 media ID');
  if (/^https?:\/\//i.test(s) || s.includes('threads.com/') || s.includes('threads.net/')) {
    throw new Error('請填入貼文的 media ID（純數字），不是貼文網址；網址短碼無法當 reply_to_id');
  }
  return s;
}

export function validateReply(text) {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('回覆內容不可為空');
  if ([...text].length > MAX_TEXT_LEN) throw new Error(`回覆超過 ${MAX_TEXT_LEN} 字上限`);
  return text;
}

// 送出單則回覆：建立回覆容器(reply_to_id)→等待→發布。DRY_RUN 不打任何寫入 API。
export async function postReply({
  settings,
  accessToken,
  text,
  replyToId,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  dryRun = settings.dryRun,
  waitMs = 30000,
  sleepImpl = defaultSleep,
  log = console.log,
}) {
  validateReply(text);
  if (!replyToId) throw new Error('缺少 reply_to_id（要回覆的貼文 id）');
  if (dryRun) {
    log(`[DRY_RUN] 不實際回覆 ${replyToId}：${text}`);
    return { dryRun: true, id: null, replyToId };
  }
  const container = await api.createReplyContainer({ accessToken, userId: settings.userId, text, replyToId });
  await sleepImpl(waitMs);
  const published = await api.publishContainer({ accessToken, userId: settings.userId, creationId: container.id });
  return { dryRun: false, id: published.id, replyToId };
}

// 送出所有「已核准」的回覆。這是唯一對外送出點，且只讀 status='approved'——
// 沒有任何自動送出未核准內容的路徑（CLAUDE.md 規則 1）。
export async function sendApprovedReplies({
  settings,
  store,
  accessToken,
  account,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  dailyCap,
  inboxDailyCap = 20, // 回自家留言區的每日上限（比 outreach 寬）
  dryRun = settings.dryRun,
  nowIso = new Date().toISOString(),
  sleep = defaultSleep,
  spacingMs = 0,
  waitMs = 30000,
  sleepImpl = defaultSleep,
  log = console.log,
}) {
  const approved = store.listByStatus(account, 'approved');
  const sentToday = store.countSentToday(account, nowIso, 'outreach');
  const inboxSentToday = store.countSentToday(account, nowIso, 'inbox');
  const sinceIso = new Date(Date.parse(nowIso) - SAME_AUTHOR_WINDOW_HOURS * 3600 * 1000).toISOString();
  const recentAuthors = store.recentAuthors(account, sinceIso, 'outreach');
  const sendable = pickSendable({
    approved, sentToday, dailyCap, recentAuthors, inboxSentToday, inboxDailyCap,
  });

  let sent = 0;
  let failed = 0;
  for (const row of sendable) {
    const text = row.editedText || row.draftText;
    try {
      await postReply({ settings, accessToken, text, replyToId: row.targetId, api, dryRun, waitMs, sleepImpl, log });
      if (!dryRun) store.markSent(row.id, new Date().toISOString());
      sent += 1;
    } catch (e) {
      store.markFailed(row.id, String(e.message || e));
      failed += 1;
    }
    if (spacingMs) await sleep(spacingMs);
  }
  return { attempted: sendable.length, sent, skipped: approved.length - sendable.length, failed, dryRun };
}
