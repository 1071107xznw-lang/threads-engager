// 發布所有「到期、已核准、有排程時間」的原生貼文。
// 只發已人工核准的原生貼文（CLAUDE.md 規則 2）；回覆不排程。
// 共用於 in-process 排程器與 cron（publish_due_cli）。
//
// 🔴 minGapMinutes：兩則發布之間的最小間隔。**這是實際踩過的坑**——
// 排程時間是在「產稿當下」算的，但核准是人後來才按的。等到晚上才批次核准時，
// 白天那些時間點全部變成「已到期」，一個 tick 就把積壓的整批倒出去
// （實測：6 則在 114 秒內全部發出，正是間隔設計要防的爆量刷版）。
// 把間隔只做在「排時間」那一層是不夠的，執行這一層也要守。
// 做法：距上一次發布不足 minGap 就整個 tick 跳過；夠了也一次只發一則，
// 讓積壓的隊伍照間隔滴出去，而不是一次沖出去。
// 傳 0 代表不守門（維持舊行為）。
export async function publishDue({
  store, publish, now = Date.now(), dryRun = false, minGapMinutes = 0, log = console.log,
}) {
  const nowIso = new Date(now).toISOString();
  const due = store.listDueScheduled(nowIso);
  if (due.length === 0) return { published: 0, failed: 0, skipped: 0, deferred: 0 };

  // DRY_RUN：不實際送，也不改狀態（避免每分鐘重試刷 log）
  if (dryRun) {
    log(`[DRY_RUN] 有 ${due.length} 則排程到期，DRY_RUN 開啟暫不發送`);
    return { published: 0, failed: 0, skipped: due.length, deferred: 0 };
  }

  const gapMs = Math.max(0, Number(minGapMinutes) || 0) * 60_000;
  let batch = due;
  if (gapMs > 0) {
    const last = store.lastPublishedAt ? store.lastPublishedAt() : null;
    const lastMs = last ? new Date(last).getTime() : null;
    if (lastMs != null && Number.isFinite(lastMs) && now - lastMs < gapMs) {
      const waitMin = Math.ceil((gapMs - (now - lastMs)) / 60_000);
      log(`⏸ ${due.length} 則到期，但距上一則發布還不到 ${minGapMinutes} 分鐘，再等 ${waitMin} 分鐘`);
      return { published: 0, failed: 0, skipped: 0, deferred: due.length };
    }
    batch = due.slice(0, 1); // 一次只發一則，積壓的照間隔滴出去
  }

  let published = 0;
  let failed = 0;
  let skipped = 0;
  const deferred = due.length - batch.length;
  if (deferred > 0) log(`📤 ${due.length} 則到期，這次先發 1 則，其餘 ${deferred} 則每 ${minGapMinutes} 分鐘再發一則`);
  for (const d of batch) {
    // 原子認領：搶到才發。cron、in-process 排程器、手動「立即發布」同時搶時只有一方成功，
    // 其餘 claim=false → 跳過，避免同一則發兩次。
    if (store.claimNativeForPublish && !store.claimNativeForPublish(d.id)) {
      skipped += 1;
      continue;
    }
    const text = d.editedText || d.draftText;
    try {
      const res = await publish({ text, topic: d.topic });
      store.markNativePublished(d.id, res.id);
      published += 1;
      log(`✅ 排程發布 #${d.id}（post ${res.id}${d.topic ? `，主題：${d.topic}` : ''}）`);
    } catch (e) {
      // 失敗轉 'failed'（不自動重試；重試會因容器重建而重複發送）。
      store.markNativeFailed(d.id, String(e.message || e));
      failed += 1;
      log(`❌ 排程發布 #${d.id} 失敗（不自動重試）：${e.message || e}`);
    }
  }
  return { published, failed, skipped, deferred };
}
