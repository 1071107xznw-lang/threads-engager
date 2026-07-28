import { defaultRunner } from './ai.mjs';

// 依品牌人設 + 趨勢素材，組出「產生原生貼文草稿」的繁中 prompt。
export function buildNativePrompt({ persona, newsTitles = [], tagPosts = [], ownPosts = [], n = 3 }) {
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  lines.push(`請以上述品牌口吻，產生 ${n} 則適合發在 Threads 的原生貼文草稿。`);
  lines.push('可參考以下素材找靈感，但**不得照抄任何一句原文**：');
  lines.push('');
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
  lines.push('- hashtag 最多 1 個，可不用。');
  lines.push('- 每則切入角度不同（angle 用一句話說明這則的切入點）。');
  lines.push('');
  lines.push(`只輸出一個 JSON 陣列，長度 ${n}，格式：[{"text":"貼文內容","angle":"切入點"}]，不要其他文字。`);
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
    out.push({ text, angle: typeof item.angle === 'string' ? item.angle.trim() : null });
  }
  if (!out.length) throw new Error('AI 未產出有效草稿');
  return out;
}

export async function generateDrafts({
  persona,
  newsTitles,
  tagPosts,
  ownPosts,
  n = 3,
  runner = defaultRunner,
}) {
  const prompt = buildNativePrompt({ persona, newsTitles, tagPosts, ownPosts, n });
  const raw = await runner(prompt);
  return parseDrafts(raw);
}
