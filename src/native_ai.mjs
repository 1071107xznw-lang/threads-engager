import { defaultRunner } from './ai.mjs';
import { sanitizeTopic } from './threads_publish.mjs';

// 依品牌人設 + 知識庫 + 趨勢素材，組出「產生原生貼文草稿」的繁中 prompt。
export function buildNativePrompt({
  persona, hotTrends = [], newsTitles = [], tagPosts = [], ownPosts = [], knowledge = '', n = 3,
}) {
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  lines.push(`請以上述品牌口吻，產生 ${n} 則適合發在 Threads 的原生貼文草稿。`);
  lines.push('可參考以下素材找靈感，但**不得照抄任何一句原文**：');
  lines.push('');
  if (knowledge) {
    lines.push('【我們敢背書的事實（知識庫）】');
    lines.push(knowledge);
    lines.push('');
    lines.push('※ 只有上面知識庫寫到的事實，才可以用肯定句陳述。');
    lines.push('  知識庫沒有的，一律不准當權威事實斷言——改成「我們的做法是…／我自己偏好…」或不要寫。');
    lines.push('');
  }
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
    lines.push('【我們自己最近的貼文——這就是我們的說話方式，請模仿】');
    ownPosts.slice(0, 15).forEach((t, i) => lines.push(`${i + 1}. ${String(t).slice(0, 200)}`));
    lines.push('');
    lines.push('※ 從上面學：句子長短、慣用詞、標點與 emoji 習慣、斷行節奏、怎麼稱呼讀者。');
    lines.push('  目標是「同一個人寫的」，不是「寫得很好」。也要避免重複已經發過的主題。');
    lines.push('');
  }

  lines.push('## 怎麼寫（Threads 上真的有人看的寫法）');
  lines.push('- **第一行就是鉤子**：Threads 會折疊，第一行決定別人要不要展開。');
  lines.push('  不要暖場、不要「大家好」、不要先鋪陳背景。');
  lines.push('- 短句、多斷行，手機一行不要太長。用空行分段。');
  lines.push('- 像真人在跟朋友講話：可以有語氣詞、可以不完整句、可以自嘲或碎念。');
  lines.push('- **有觀點、敢站隊**——但立場只能建立在知識庫或「我們自己的做法/偏好」上。');
  lines.push('- 具體細節 > 形容詞（「先冰 20 分鐘」勝過「口感絕佳」）。');
  lines.push('- 結尾留一個讓人想回話的東西：問題、邀戰、或沒說完的話。');
  lines.push('- 不放連結（會壓觸及）；hashtag 0～1 個。');
  lines.push('');
  lines.push('## 絕對不要');
  lines.push('- **AI 腔**：罐頭金句、「在這個◯◯的時代」、「不僅…更是…」、排比堆疊、');
  lines.push('  萬用形容詞（完美/絕佳/獨特/難忘的體驗）、每句都工整。寧可口語、隨性、有點不完美。');
  lines.push('- **商業腔**：宣傳語、優惠推銷、「歡迎來店裡坐坐」「立即預約」這類 CTA 結尾。');
  lines.push(`  ${n} 則裡最多 1 則可以自然帶到店，而且店要當背景、不是主角。`);
  lines.push('- **會被抓語病的權威斷言**：酒的適飲溫度、產地年份、法規、健康營養、歷史典故等，');
  lines.push('  知識庫沒寫就不准用「就是要…」「正確做法是…」的口氣。改成自家做法或偏好。');
  lines.push('- 蹭政治、災難、意外、悲劇、八卦爭議——寧可不蹭。');
  lines.push('');
  lines.push('## 其他');
  lines.push('- 每則繁體中文、≤480 字，切入角度都不同（angle 一句話說明切入點）。');
  lines.push('- 蹭熱搜要自然：只挑能跟店（喝酒聚會、觀賽、活動、美食）合理連結的主題。');
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

// ── 紅隊審稿：發出去之前，先讓「最愛抓語病的知識型網友」挑一遍 ──
//
// 目標不是把話講軟，而是「一樣有態度，但戰不倒」：
// 有知識庫背書的照講；沒把握的改寫成自家做法/偏好，而不是加一堆「可能、也許」。
export function buildRedTeamPrompt({ text, knowledge = '' }) {
  const lines = [];
  lines.push('你是 Threads 上最愛抓語病的知識型網友。以下是一則準備發出的貼文。');
  lines.push('請逐句找出「會被留言戰、或被抓語病」的地方，特別是：');
  lines.push('- 把有爭議的說法當成唯一正解');
  lines.push('  （例：「紅酒就是要常溫喝」——台灣室溫 30° 和歐洲酒窖 16–18° 差很多，必被戰）');
  lines.push('- 需要專業或查證才敢講的事實斷言（產地、年份、法規、健康營養、歷史典故）');
  lines.push('- 過度概括（「所有人都」「一定」「最好的」「就是要」）');
  lines.push('- 明顯的事實錯誤');
  lines.push('');
  if (knowledge) {
    lines.push('【這家店敢背書的事實（知識庫）】');
    lines.push(knowledge);
    lines.push('');
  }
  lines.push('改寫規則：');
  lines.push('- 知識庫裡有的事實，可以放心用肯定句，**不要改**。');
  lines.push('- 有問題的句子 → 改寫成「我們的做法是…／我自己偏好…」這種站得住的說法，或直接刪掉。');
  lines.push('- ⚠️ **改寫後不可以比原本更無聊、更軟弱、更沒觀點。**');
  lines.push('  不准加「可能、也許、因人而異、建議可依個人喜好」這種和稀泥的詞來閃避。');
  lines.push('  目標是「一樣敢講、但戰不倒」——把沒把握的斷言換成有立場的自家說法。');
  lines.push('- 語氣、長度、斷行排版維持原樣，不要改成 AI 腔或公關稿。');
  lines.push('- 沒問題就原文照回、changed=false。');
  lines.push('');
  lines.push(`貼文：\n${text}`);
  lines.push('');
  lines.push('只輸出一個 JSON 物件：{"text":"最終全文","changed":true/false,"note":"一句話說明改了什麼；沒改就空字串"}，不要其他文字。');
  return lines.join('\n');
}

export function parseRedTeam(raw, { fallbackText }) {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no json');
    const obj = JSON.parse(raw.slice(start, end + 1));
    const text = typeof obj.text === 'string' && obj.text.trim() ? obj.text.trim() : fallbackText;
    return {
      text,
      changed: Boolean(obj.changed) && text !== fallbackText,
      note: typeof obj.note === 'string' ? obj.note.trim() : '',
    };
  } catch {
    // 審稿失敗不擋流程：保留原稿，讓人在 dashboard 自己判斷
    return { text: fallbackText, changed: false, note: '' };
  }
}

// 對單則草稿跑紅隊審稿。失敗時原文放行（不因為審稿掛掉就少一則稿）。
export async function redTeamDraft({ text, knowledge = '', runner = defaultRunner }) {
  if (!text || !String(text).trim()) return { text, changed: false, note: '' };
  try {
    const raw = await runner(buildRedTeamPrompt({ text, knowledge }));
    return parseRedTeam(String(raw), { fallbackText: text });
  } catch {
    return { text, changed: false, note: '' };
  }
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
  knowledge = '',
  n = 3,
  runner = defaultRunner,
  redTeam = true, // 產完再跑一次紅隊審稿（可關閉以省一次 AI 呼叫）
  log = () => {},
}) {
  const prompt = buildNativePrompt({ persona, hotTrends, newsTitles, tagPosts, ownPosts, knowledge, n });
  const raw = await runner(prompt);
  const drafts = parseDrafts(raw); // 每則含 { text, angle, topic }
  if (!redTeam) return drafts.map((d) => ({ ...d, reviewNote: '' }));

  const reviewed = [];
  for (const d of drafts) {
    const r = await redTeamDraft({ text: d.text, knowledge, runner });
    if (r.changed) log(`🛡 已改寫可能被戰的說法：${r.note || '(未說明)'}`);
    reviewed.push({ ...d, text: r.text, reviewNote: r.changed ? r.note : '' });
  }
  return reviewed;
}
