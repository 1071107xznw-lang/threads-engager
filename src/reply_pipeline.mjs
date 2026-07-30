import { gatherTagPosts } from './threads_search.mjs';
import { scoreAndDraft } from './ai.mjs';
import { remainingSearchQuota, planRun, withRetry } from './quota.mjs';

// 聆聽→評分→產草稿：找別人的 tag 候選串 → 存入 posts → 逐則 AI 評分+產有梗回覆草稿。
// 全自動只到「產草稿」（status=drafted）；送出仍需 dashboard 人工核准（見 threads_reply）。
export async function findAndDraft({
  settings,
  brand,
  store,
  accessToken,
  account,
  api,
  runner, // 注入式 AI runner；預設由 scoreAndDraft 用 claude -p
  ownUsername = null,
  runsPer7d, // 額度感知：預期 7 天內跑幾輪（cron 頻率），用來平均分配額度
  reserveRatio,
  sleepImpl,
  nowIso = new Date().toISOString(),
  log = console.log,
}) {
  // 取自己 username，從候選中濾掉自家貼文（唯讀呼叫，可安全退避重試）
  if (!ownUsername) {
    try {
      const me = await withRetry(
        () => api.getProfile({ accessToken, userId: settings.userId, fields: 'id,username' }),
        { retries: 2, sleepImpl, log },
      );
      ownUsername = me.username || null;
    } catch {
      /* 拿不到就不濾 */
    }
  }

  // 1) 額度感知配額：依近 7 天剩餘額度決定這輪搜幾個 tag。
  //    額度用得快 → 自動降頻；剩很多 → 多搜一些。撞頂前就先收手。
  const tags = brand.replyTags || brand.tags || [];
  const quota = remainingSearchQuota({ store, cap: brand.searchCap7d, nowIso });
  const plan = planRun({
    remaining: quota.remaining,
    tagCount: tags.length,
    runsPer7d: runsPer7d ?? brand.replyRunsPer7d ?? 28,
    reserveRatio: reserveRatio ?? brand.searchReserveRatio ?? 0.1,
  });
  if (plan.skip) {
    log(`⏸ 額度不足（剩 ${quota.remaining}/${quota.cap}），這輪跳過搜尋以保額度`);
    return {
      candidates: 0, inserted: 0, drafted: 0, skipped: 0,
      quotaUsed7d: quota.used, quotaRemaining: quota.remaining, plannedTags: 0, skippedForQuota: true,
    };
  }

  // 2) 官方 keyword_search 找候選（含 7 天額度守門、濾掉自己）
  //    用聚焦的 replyTags（回落到 tags），避免搜太發散＋省額度
  const candidates = await gatherTagPosts({
    api, store, accessToken,
    tags, perTag: brand.perTagPosts, cap: brand.searchCap7d,
    ownUsername, maxTags: plan.tags, sleepImpl, nowIso, log,
  });

  // 3) 存進 posts（targetId = 對方貼文 id，供 reply_to_id）
  let inserted = 0;
  for (const c of candidates) {
    if (store.upsertPost({
      account, threadUrl: c.permalink, author: c.username, content: c.text, targetId: c.id,
    }).inserted) inserted += 1;
  }

  // 4) 對新進候選逐則評分 + 產回覆草稿（限 replyPerRun 則，控 AI 呼叫與額度）
  //    ⚠️ 全自動只到這裡：草稿 status=drafted，送出仍需人工核准（CLAUDE.md 規則 1）
  const fresh = store.listByStatus(account, 'new').slice(0, brand.replyPerRun ?? 15);
  let drafted = 0;
  let skipped = 0;
  for (const row of fresh) {
    const r = await scoreAndDraft({
      post: { author: row.author, content: row.content, likes: row.likes },
      persona: brand.replyPersona,
      threshold: brand.replyThreshold,
      runner,
    });
    store.setRelevance(row.id, r.score);
    if (r.draft) { store.saveDraft(row.id, r.draft); drafted += 1; }
    else { store.setStatus(row.id, 'skipped'); skipped += 1; }
  }

  const usedAfter = store.countSearches7d(nowIso);
  log(`候選 ${candidates.length}（新增 ${inserted}）→ 產草稿 ${drafted}、略過 ${skipped}；本輪 tag ${plan.tags}／額度 ${usedAfter}/${quota.cap}`);
  return {
    candidates: candidates.length, inserted, drafted, skipped,
    quotaUsed7d: usedAfter,
    quotaRemaining: Math.max(0, quota.cap - usedAfter),
    plannedTags: plan.tags,
    skippedForQuota: false,
  };
}
