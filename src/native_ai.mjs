import { defaultRunner } from './ai.mjs';
import { sanitizeTopic } from './threads_publish.mjs';

// 依品牌人設 + 趨勢素材，組出「產生原生貼文草稿」的繁中 prompt。
export function buildNativePrompt({ persona, hotTrends = [], newsTitles = [], tagPosts = [], ownPosts = [], n = 3 }) {
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  lines.push(`請以上述品牌口吻，產生 ${n} 則適合發在 Threads 的原生貼文草稿。`);
  lines.push('可參考以下素材找靈感，但**不得照抄任何一句原文**：');
  lines.push('');
  if (hotTrends.length) {
    lines.push('【全網即時熱搜（現在搜尋量飆高的時勢主題，蹭得上就蹭）】');
    hotTrends.slice(0, 12).forEach((t, i) => {
      const traffic = t.traffic ? `（流量 ${t.traffic}）` : '';
      const ctx = t.context ? `：${String(t.context).slice(0, 60)}` : '';
      lines.push(`${i + 1}. ${t.topic}${traffic}${ctx}`);
    });
    lines.push('');
  }
  if (newsTitles.length) {
    lines.push('【近期新聞／話題】');
    newsTitles.slice(0, 12).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }
  if (tagPosts.length) {
    lines.push('【Threads 站內近期相關貼文（看大家在聊什麼）】');
    tagPosts.slice(0, 10).forEach((p, i) => lines.push(`${i + 1}. ${String(p.text).slice(0, 80)}`));
    lines.push('');
  }
  if (ownPosts.length) {
    lines.push('【我們自己最近的貼文（維持語氣、避免重複主題）】');
    ownPosts.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${String(t).slice(0, 80)}`));
    lines.push('');
  }
  lines.push('規則：');
  lines.push('- 每則繁體中文、≤480 字、自然口語、有價值或有畫面感。');
  lines.push('- 不硬推銷、不誇大、不鼓勵過量飲酒、避免爭議話題。');
  lines.push('- 蹭熱搜要自然：只挑能跟店（喝酒聚會、觀賽、活動、美食）合理連結的主題；');
  lines.push('  政治、災難、意外、悲劇、八卦爭議一律跳過，寧可不蹭。');
  lines.push('- hashtag 最多 1 個，可不用。');
  lines.push('- 每則切入角度不同（angle 用一句話說明這則的切入點）。');
  lines.push('- 為每則建議「一個」最貼切的 Threads 主題(topic)：1 個簡短詞或詞組、≤20 字、');
  lines.push('  貼近該則內容、用貼文的語言、**不含句點/&/# 等符號**；想不到合適的就給空字串。');
  lines.push('');
  lines.push(`只輸出一個 JSON 陣列，長度 ${n}，格式：[{"text":"貼文內容","angle":"切入點","topic":"主題"}]，不要其他文字。`);
  return lines.join('\n');
}

// 解析 AI 輸出的 JSON 陣列，過濾無效/超長草稿。
export function parseDrafts(raw, { maxLen = 500 } = {}) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('AI 輸出找不到 JSON 陣列');
  const arr = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('AI 輸出不是 JSON 陣列');
  const out = [];
  for (const item of arr) {
    if (!item || typeof item.text !== 'string') continue;
    const text = item.text.trim();
    if (!text || [...text].length > maxLen) continue;
    out.push({
      text,
      angle: typeof item.angle === 'string' ? item.angle.trim() : null,
      topic: sanitizeTopic(item.topic), // AI 建議的主題（整理過；無效則 null）
    });
  }
  if (!out.length) throw new Error('AI 未產出有效草稿');
  return out;
}

// 為單一則貼文內容建議一個主題（給 dashboard 的「建議主題」按鈕用；也涵蓋手寫草稿）。
export async function suggestTopic({ text, persona = '', runner = defaultRunner }) {
  if (!text || !String(text).trim()) return null;
  const prompt = [
    persona ? `品牌人設：${persona}` : '',
    '為下面這則 Threads 貼文，建議「一個」最貼切的 Threads 主題(topic)。',
    '規則：1 個簡短詞或詞組、≤20 字、貼近內容、用貼文的語言、不含句點/&/# 等符號。',
    '',
    `貼文：${String(text).trim()}`,
    '',
    '只輸出主題本身這一行文字，不要引號、不要解釋、不要其他內容。',
  ].filter(Boolean).join('\n');
  const raw = await runner(prompt);
  return sanitizeTopic(String(raw).trim().split('\n')[0]);
}

export async function generateDrafts({
  persona,
  hotTrends,
  newsTitles,
  tagPosts,
  ownPosts,
  n = 3,
  runner = defaultRunner,
}) {
  const prompt = buildNativePrompt({ persona, hotTrends, newsTitles, tagPosts, ownPosts, n });
  const raw = await runner(prompt);
  return parseDrafts(raw); // 每則含 { text, angle, topic }
}
