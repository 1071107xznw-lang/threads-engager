// 發布所有「到期、已核准、有排程時間」的原生貼文。
// 只發已人工核准的原生貼文（CLAUDE.md 規則 2）；回覆不排程。
// 共用於 in-process 排程器與 cron（publish_due_cli）。
export async function publishDue({ store, publish, now = Date.now(), dryRun = false, log = console.log }) {
  const nowIso = new Date(now).toISOString();
  const due = store.listDueScheduled(nowIso);
  if (due.length === 0) return { published: 0, failed: 0, skipped: 0 };

  // DRY_RUN：不實際送，也不改狀態（避免每分鐘重試刷 log）
  if (dryRun) {
    log(`[DRY_RUN] 有 ${due.length} 則排程到期，DRY_RUN 開啟暫不發送`);
    return { published: 0, failed: 0, skipped: due.length };
  }

  let published = 0;
  let failed = 0;
  for (const d of due) {
    const text = d.editedText || d.draftText;
    try {
      const res = await publish({ text, topic: d.topic });
      store.markNativePublished(d.id, res.id);
      published += 1;
      log(`✅ 排程發布 #${d.id}（post ${res.id}${d.topic ? `，主題：${d.topic}` : ''}）`);
    } catch (e) {
      store.markNativeFailed(d.id, String(e.message || e));
      failed += 1;
      log(`❌ 排程發布 #${d.id} 失敗：${e.message || e}`);
    }
  }
  return { published, failed, skipped: 0 };
}
