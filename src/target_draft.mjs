import { scoreAndDraft } from './ai.mjs';

// 手動指定一則貼文 → AI 產回覆草稿 → 進審核佇列。
//
// 🔴 只到「產草稿」為止。送出仍然只有一條路：人在 dashboard 逐則核准 → /api/send。
// 這個模組不碰任何送出邏輯（CLAUDE.md 規則 1）。
//
// 為什麼要獨立一支：`/api/reply/manual` 是「使用者自己寫好內容」，這支是
// 「使用者只給一個貼文 ID，內容交給 AI」。兩者的失敗模式完全不同——
// 這支會卡在「拿不到那則貼文的內文」，那是它唯一真正的難點。

// 取得目標貼文的內文。順序：使用者貼的 > 官方 API 讀的。
//
// 為什麼使用者貼的優先：他看得到那則貼文，API 不一定讀得到
// （App 權限狀態、貼文可見性都可能擋）。使用者手上的資料比較新也比較確定。
export async function fetchTargetPost({ api, accessToken, targetId, postText = '', log = () => {} }) {
  if (postText.trim()) {
    return { text: postText.trim(), author: null, permalink: null, source: 'manual' };
  }
  try {
    const m = await api.getMedia({ accessToken, mediaId: targetId });
    const text = String(m?.text ?? '').trim();
    if (!text) {
      // 讀得到物件但沒有文字（純圖片/影片貼文）——AI 沒東西可回，不要讓它硬掰
      return { text: '', author: m?.username || null, permalink: m?.permalink || null, source: 'api-empty' };
    }
    return {
      text,
      author: m?.username || null,
      permalink: m?.permalink || null,
      source: 'api',
    };
  } catch (e) {
    log(`讀不到目標貼文（${e.message || e}）`);
    return { text: '', author: null, permalink: null, source: 'error', error: String(e.message || e) };
  }
}

// 產草稿並寫入佇列。回傳給前端顯示用的結果。
export async function draftReplyForTarget({
  api, accessToken, store, account,
  targetId,
  postText = '',
  persona,
  threshold = 0,   // 手動指定＝人已經挑過了，預設不再用分數擋掉
  voiceSamples = [],
  runner,
  log = () => {},
}) {
  const post = await fetchTargetPost({ api, accessToken, targetId, postText, log });

  if (!post.text) {
    // 拿不到內文就明講、並告訴使用者怎麼繼續，不要產一則憑空想像的回覆
    const why = post.source === 'api-empty'
      ? '這則貼文沒有文字內容（可能是純圖片或影片）'
      : `讀不到這則貼文的內容${post.error ? `（${post.error}）` : ''}`;
    const e = new Error(`${why}。請把貼文內容複製貼到「貼文內容」欄位，我再幫你寫。`);
    e.status = 422;
    throw e;
  }

  const { score, draft } = await scoreAndDraft({
    post: { author: post.author || '（未知作者）', likes: 0, content: post.text },
    persona,
    threshold,
    voiceSamples,
    runner,
  });
  if (!draft) {
    const e = new Error(`AI 判斷相關性只有 ${score.toFixed(2)}，低於門檻 ${threshold}，沒有產草稿`);
    e.status = 422;
    throw e;
  }

  const { id } = store.upsertPost({
    account,
    threadUrl: post.permalink || `https://www.threads.com/t/${targetId}`,
    author: post.author,
    content: post.text,
    targetId,
  });
  store.setRelevance(id, score);
  store.saveDraft(id, draft); // status → drafted，等人工核准
  return {
    ok: true,
    id,
    targetId,
    score,
    draft,
    author: post.author,
    postText: post.text,
    source: post.source, // 'api' = 系統自己讀到的；'manual' = 你貼的
  };
}
