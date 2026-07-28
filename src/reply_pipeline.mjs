import { gatherTagPosts } from './threads_search.mjs';
import { scoreAndDraft } from './ai.mjs';

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
  nowIso = new Date().toISOString(),
  log = console.log,
}) {
  // 取自己 username，從候選中濾掉自家貼文
  if (!ownUsername) {
    try {
      const me = await api.getProfile({ accessToken, userId: settings.userId, fields: 'id,username' });
      ownUsername = me.username || null;
    } catch {
      /* 拿不到就不濾 */
    }
  }

  // 1) 官方 keyword_search 找候選（含 7 天額度守門、濾掉自己）
  //    用聚焦的 replyTags（回落到 tags），避免搜太發散＋省額度
  const candidates = await gatherTagPosts({
    api, store, accessToken,
    tags: brand.replyTags || brand.tags, perTag: brand.perTagPosts, cap: brand.searchCap7d,
    ownUsername, nowIso, log,
  });

  // 2) 存進 posts（targetId = 對方貼文 id，供 reply_to_id）
  let inserted = 0;
  for (const c of candidates) {
    if (store.upsertPost({
      account, threadUrl: c.permalink, author: c.username, content: c.text, targetId: c.id,
    }).inserted) inserted += 1;
  }

  // 3) 對新進候選逐則評分 + 產回覆草稿（限 replyPerRun 則，控 AI 呼叫與額度）
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

  log(`候選 ${candidates.length}（新增 ${inserted}）→ 產草稿 ${drafted}、略過 ${skipped}；額度 ${store.countSearches7d(nowIso)}/${brand.searchCap7d}`);
  return { candidates: candidates.length, inserted, drafted, skipped, quotaUsed7d: store.countSearches7d(nowIso) };
}
