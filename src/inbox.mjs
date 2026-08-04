// 💬 留言區：把「別人在你自己貼文底下的留言」變成待回覆草稿。
//
// 為什麼要這個：主動去別人的熱門串下留言需要 App 上 Live（Development 模式下
// keyword_search 只回自己的貼文）。但「回自己貼文底下的留言」今天就能做，
// 而且 ROI 更高——這些人已經對你有興趣，回覆還會拉高該則的對話深度。
//
// 合規：這裡全自動只到「產草稿」。送出一律走既有的人工核准佇列（CLAUDE.md 規則 1）。

import { defaultRunner } from './ai.mjs';
import { LEGAL_RULES, scanCompliance, summarizeCompliance } from './compliance.mjs';

// 從一串 conversation 裡挑出「別人留的、而且我還沒回」的留言。純函式，好測。
// rows：/{media-id}/conversation 的 data（攤平的整串，每筆可能有 replied_to）。
export function pickUnanswered({ rows = [], me }) {
  const answered = new Set();
  for (const r of rows) {
    if (r && r.username === me && r.replied_to && r.replied_to.id) {
      answered.add(String(r.replied_to.id));
    }
  }
  return rows.filter((r) => (
    r && r.id && r.username && r.username !== me
    && String(r.text || '').trim()
    && !answered.has(String(r.id))
  ));
}

// 判斷一則留言是不是「幾乎沒有內容」——只有表情或一兩個字（🤤 / 好 / 推推）。
// 這種留言沒有東西可回應，AI 若照一般規則寫，就會為了湊字數去補營業資訊
// （幾點開門、DJ 是誰、幾分鐘出餐）——那些通常是編的。
export function isLowContentReply(text) {
  const stripped = String(text ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\p{M}‍️\u{1f3fb}-\u{1f3ff}]/gu, '') // 變體選擇器、膚色、ZWJ
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
  return [...stripped].length <= 3;
}

// 回自家留言的 prompt。跟「主動去別人串下留言」是完全不同的情境：
// 這裡你是主人，對方是上門的客人——該具體回應他講的點，不是發罐頭感謝。
export function buildInboxPrompt({ rootPostText = '', reply, persona = '', knowledge = '' }) {
  const lowContent = isLowContentReply(reply?.text);
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  lines.push('情境：**這是你自己的貼文，有人在底下留言**。你是主人，要回應這位客人。');
  lines.push('');
  if (knowledge) {
    lines.push('【我們敢背書的事實（知識庫）】');
    lines.push(knowledge);
    lines.push('');
    lines.push('※ 只有知識庫寫到的事實才可以用肯定句陳述；沒寫的改成「我們的做法是…」或不要講。');
    lines.push('');
  }
  if (rootPostText) {
    lines.push('【你原本的貼文】');
    lines.push(String(rootPostText).slice(0, 400));
    lines.push('');
  }
  lines.push('【對方的留言】');
  lines.push(`@${reply.username}：${String(reply.text).slice(0, 400)}`);
  lines.push('');
  if (lowContent) {
    lines.push('## ⚠️ 這則留言幾乎沒有內容（只有表情或一兩個字）');
    lines.push('- 沒有東西可以回應，就**只回一句**、輕鬆帶過。接他的情緒、或丟一個很短的問題。');
    lines.push('- 要提到細節（時間、活動、品項、人名）**只能用上面那則原貼文裡真的寫到的**，');
    lines.push('  或知識庫裡有的。原貼文沒寫、知識庫也沒有的，一個字都不要加。');
    lines.push('- 寧可短到只有一行，也不要為了湊字數去編。');
    lines.push('');
  }
  lines.push('## 怎麼回');
  lines.push('- **具體回應他講的那個點**。罐頭回覆（「謝謝支持！」「歡迎再來」）直接算失敗。');
  lines.push('- 對方講得有道理 → 認同，並補一個自家的做法或觀察，讓對話能再接下去。');
  lines.push('- **對方在糾正你、挑語病、或講得比你內行** → 不要道歉式退讓（「您說的是，是我們疏忽」），');
  lines.push('  也不要硬碰硬。用知識庫裡「我們的做法」回應，承認對方那套也成立，守住自己的立場。');
  lines.push('- 對方在開玩笑或吐槽 → 接梗，別一本正經。');
  lines.push('- **對方講的是我們沒把握的專業題目**（適飲溫度、年份、產地、釀造）→ 不要裝專家、');
  lines.push('  也不要硬掰。大方承認他懂，講我們自己的做法，再把話丟回去讓他多說一點。');
  lines.push('  懂的人被請教會很樂意回，那串會愈滾愈長——這比我們假裝知道有價值得多。');
  lines.push('- 對方問資訊（營業時間、價格、能不能包場）→ 知識庫有就直接答；沒有就說可以私訊/來電問，不要瞎掰。');
  lines.push('');
  lines.push(LEGAL_RULES);
  lines.push('');
  lines.push('## 絕對不要');
  lines.push('- 推銷、CTA（「歡迎來店裡坐坐」「立即預約」）、放連結、hashtag。');
  lines.push('- AI 腔與罐頭句型：「感謝您的分享」「這真是一個很棒的觀點」。');
  lines.push('- 講知識庫沒有的權威事實（會被再抓一次語病）。');
  lines.push('- **編造營業細節**：營業/開始時間、價格、DJ 或工作人員名字、出餐分鐘數、');
  lines.push('  低消規則、活動檔期。');
  lines.push('  ✅ 原貼文或知識庫**真的寫到**的可以用——那是我們自己公告過的。');
  lines.push('  ❌ 兩邊都沒有的一個字都不要編，改說「這個可以直接私訊或現場問我們」。');
  lines.push('- **承諾原貼文沒答應過的事**：例如原貼文沒說可以留位，就不要說幫他留位。');
  lines.push('');
  lines.push('繁體中文、≤120 字、像真人隨口回，可用少量 emoji。');
  lines.push('');
  lines.push('只輸出回覆本文，不要引號、不要解釋、不要其他內容。');
  return lines.join('\n');
}

// 產一則回覆草稿。失敗回 null（該則留在佇列，你可以自己手寫）。
export async function draftInboxReply({
  rootPostText, reply, persona, knowledge = '', runner = defaultRunner, log = () => {},
}) {
  try {
    const raw = await runner(buildInboxPrompt({ rootPostText, reply, persona, knowledge }));
    const text = String(raw ?? '').trim().replace(/^["「『]|["」』]$/g, '').trim();
    if (!text) return null;
    // 產完再掃一次法規紅線。不擋（人工核准才會送出），但要讓人看得到。
    const hits = scanCompliance(text);
    if (hits.length) log(`⚖️ 這則回覆踩到法規紅線，核准前請看：${summarizeCompliance(hits)}`);
    return text;
  } catch {
    return null;
  }
}

// 掃自己近期貼文的留言區 → 未回覆的存進 posts（kind='inbox'）→ 逐則產回覆草稿。
// 全部相依可注入以利測試；不做任何送出。
export async function scanInbox({
  api,
  accessToken,
  userId,
  store,
  account,
  brand = {},
  knowledge = '',
  ownUsername = null,
  postLimit = 20,      // 掃自己最近幾則貼文
  draftLimit = brand.inboxPerRun ?? 15, // 一輪最多產幾則草稿（控 AI 呼叫）
  runner,
  log = console.log,
}) {
  if (!ownUsername) {
    try {
      const me = await api.getProfile({ accessToken, userId, fields: 'id,username' });
      ownUsername = me.username || null;
    } catch (e) {
      log(`⚠️ 取得自己 username 失敗：${e.message}`);
    }
  }
  if (!ownUsername) {
    return { posts: 0, found: 0, inserted: 0, drafted: 0, failed: 0, reason: '拿不到自己的 username，無法分辨誰是別人' };
  }

  let ownPosts = [];
  try {
    const res = await api.listOwnPosts({ accessToken, userId, limit: postLimit, fields: 'id,text,timestamp' });
    ownPosts = (res.data || []).filter((p) => p && p.id);
  } catch (e) {
    return { posts: 0, found: 0, inserted: 0, drafted: 0, failed: 0, reason: `讀取自己貼文失敗：${e.message}` };
  }

  // 1) 逐則貼文抓整串對話，挑出「別人留的、我還沒回的」
  const pending = [];
  for (const p of ownPosts) {
    try {
      const conv = await api.getConversation({ accessToken, mediaId: p.id });
      for (const r of pickUnanswered({ rows: conv.data || [], me: ownUsername })) {
        pending.push({ ...r, rootPostId: p.id, rootPostText: p.text || '' });
      }
    } catch {
      /* 單則抓不到就跳過，不擋整輪 */
    }
  }
  log(`留言區：掃了 ${ownPosts.length} 則貼文，找到 ${pending.length} 則還沒回的留言`);

  // 2) 存進待回覆佇列（targetId = 該留言的 media id，送出時當 reply_to_id）
  //    upsertPost 以 targetId 去重 → 重複掃不會排成兩列
  let inserted = 0;
  for (const r of pending) {
    if (store.upsertPost({
      account,
      threadUrl: r.permalink || `https://www.threads.com/t/${r.id}`,
      author: r.username,
      content: r.text,
      targetId: r.id,
      kind: 'inbox',
    }).inserted) inserted += 1;
  }

  // 3) 對新進的逐則產草稿（⚠️ 只到 drafted，送出仍需人工核准）
  const rootTextById = new Map(pending.map((r) => [String(r.id), r.rootPostText]));
  const fresh = store.listByStatus(account, 'new')
    .filter((row) => row.kind === 'inbox')
    .slice(0, draftLimit);

  let drafted = 0;
  let failed = 0;
  for (const row of fresh) {
    const draft = await draftInboxReply({
      rootPostText: rootTextById.get(String(row.targetId)) || '',
      reply: { username: row.author, text: row.content },
      persona: brand.replyPersona,
      knowledge,
      runner,
      log,
    });
    if (draft) { store.saveDraft(row.id, draft); drafted += 1; }
    else { failed += 1; }
  }

  log(`留言區：新增 ${inserted} 則待回、產出 ${drafted} 則草稿${failed ? `（${failed} 則產稿失敗，可自己手寫）` : ''}`);
  return { posts: ownPosts.length, found: pending.length, inserted, drafted, failed, reason: '' };
}
