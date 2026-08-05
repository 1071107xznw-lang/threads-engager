// 「我平常怎麼講話」的語氣樣本——取自使用者自己回過別人的留言。
//
// 為什麼不用貼文當樣本：貼文是「發表」的語氣（有標題、有 hashtag、有公告感），
// 留言是「對話」的語氣（短、直接、接話）。要回得像本人，樣本就得取自本人真的在對話時
// 怎麼講話。這也是「不要小編腔」最有效的一味——與其叫模型「不要客服」，
// 不如直接給它看本人隨口回別人的樣子。

// 去掉 emoji / 標點 / 空白之後還剩幾個字。用來判斷「這則有沒有內容」。
function coreLength(text) {
  const stripped = String(text ?? '')
    .replace(/@[\w.]+/g, '') // 純 tag 別人的不算內容
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\p{M}‍️\u{1f3fb}-\u{1f3ff}]/gu, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
  return [...stripped].length;
}

// 從自己的留言裡挑出能當範本的。
//
// 刻意**不是**把短的全丟掉——「先到先先享受😂」只有七個字，但那正是要學的語感。
// 濾掉的是「短到沒有句子」的：單一 emoji、單一名詞、只 tag 人。
export function pickVoiceSamples(rows, { limit = 12, minChars = 4, maxChars = 120 } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const text = String(r?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const n = coreLength(text);
    if (n < minChars) continue; // 「🤣」「生蠔」教不了東西
    if (text.length > maxChars) continue; // 太長的通常是貼文不是留言
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

// 語氣樣本在 prompt 裡的區塊。三條產出路徑共用同一份寫法。
export function voiceSamplesBlock(samples) {
  if (!samples?.length) return '';
  return [
    '【我平常怎麼回別人的——真實樣本】',
    ...samples.map((t, i) => `${i + 1}. ${t}`),
    '',
    '※ 這是**語氣**範本，不是內容範本。要學的是：句子多短、標點怎麼用、emoji 放哪幾個、',
    '  接話的角度（吐槽？附和？反問？裝傻？）。',
    '※ **不要照抄裡面的字**，也**不要把裡面提到的事當成事實**——那是回別的貼文時講的。',
  ].join('\n');
}

// 抓自己回過別人的留言並挑成樣本。拿不到就回空陣列——語氣樣本是加分項，
// 少一個訊號而已，不該擋掉產稿。
export async function fetchVoiceSamples({
  api, accessToken, userId, limit = 12, fetchLimit = 40, log = () => {},
}) {
  try {
    const res = await api.listOwnReplies({ accessToken, userId, limit: fetchLimit });
    const samples = pickVoiceSamples(res.data || [], { limit });
    log(`語氣樣本：從自己回過的留言挑了 ${samples.length} 則`);
    return samples;
  } catch (e) {
    log(`⚠️ 拿不到自己的留言當語氣樣本（不擋產稿）：${e.message}`);
    return [];
  }
}
