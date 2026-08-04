// ✨ 優化「你自己寫的」一則貼文：找鉤子、緊縮內容、建議主題、自然搭上熱度、去 AI 腔。
//
// 跟「AI 從零產稿」不同的地方：**這是你的文,不是 AI 的文**。
// 所以第一條規則是保留你的原意、資訊與立場——只把它變得更容易被看到、被回應。
// 改到讓你認不出來，就算失敗。

import { defaultRunner } from './ai.mjs';
import { sanitizeTopic } from './threads_publish.mjs';
import { summarizeMetrics } from './insights.mjs';
import { redTeamDraft } from './native_ai.mjs';

export function buildPolishPrompt({
  text, persona = '', hotTrends = [], ownPosts = [], topPosts = [], knowledge = '',
}) {
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  lines.push('下面是**這個品牌的人自己寫的**一則 Threads 貼文草稿。');
  lines.push('你的工作不是重寫，是**讓它更容易被看到、被回應**。');
  lines.push('');
  lines.push('【原稿】');
  lines.push(String(text).trim());
  lines.push('');

  if (knowledge) {
    lines.push('【我們敢背書的事實（知識庫）】');
    lines.push(knowledge);
    lines.push('');
    lines.push('※ 只有知識庫寫到的事實才可以用肯定句陳述。');
    lines.push('  **不准替原稿補上知識庫沒有的營業細節**（時間、價格、人名、分鐘數）——寧可不寫。');
    lines.push('');
  }
  if (ownPosts.length) {
    lines.push('【我們最近的貼文——語氣範本】');
    ownPosts.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${String(t).slice(0, 150)}`));
    lines.push('');
  }
  if (topPosts.length) {
    lines.push('【我們自己成效最好的貼文——這幾則是真的有流量的】');
    topPosts.slice(0, 5).forEach((p, i) => {
      const when = p.timestamp ? `${String(p.timestamp).slice(0, 10)}｜` : '';
      lines.push(`${i + 1}.（${when}${summarizeMetrics(p.metrics || {})}）${String(p.text || '').slice(0, 150)}`);
    });
    lines.push('');
    lines.push('※ 學它們「為什麼有人看」：鉤子怎麼下、多長、有沒有丟問題。不是照抄內容。');
    lines.push('');
  }
  if (hotTrends.length) {
    lines.push('【現在的熱搜（搭得上才搭）】');
    hotTrends.slice(0, 10).forEach((t, i) => {
      const traffic = t.traffic ? `（流量 ${t.traffic}）` : '';
      lines.push(`${i + 1}. ${t.topic}${traffic}`);
    });
    lines.push('');
  }

  lines.push('## 要做的事');
  lines.push('1. **鉤子**：第一行決定別人展不展開。改成一句就想看下去的話——');
  lines.push('   具體的畫面、反常識的說法、或直接丟衝突。不要暖場、不要「大家好」。');
  lines.push('2. **緊縮**：砍掉廢話與形容詞堆疊，短句、多斷行，手機一行不要太長。');
  lines.push('3. **結尾留互動**：一個很好回答的問題或邀戰（二選一、幫我決定、你們都怎麼做）。');
  lines.push('4. **去 AI 腔**：罐頭金句、「在這個◯◯的時代」、「不僅…更是…」、排比、');
  lines.push('   萬用形容詞（完美/絕佳/獨特/難忘）一律拿掉。寧可口語、隨性、有點不完美。');
  lines.push('5. **熱度**：只有**自然接得上**才把原稿連到某個熱搜；硬凹會很尷尬，接不上就不要接，');
  lines.push('   並在 trend 欄位回空字串。政治、災難、意外、悲劇、八卦一律不蹭。');
  lines.push('6. **主題**：建議一個 Threads 主題（≤20 字、不含句點/&/#；想不到就空字串）。');
  lines.push('');
  lines.push('## 絕對不要');
  lines.push('- **改掉作者的原意、立場或他想講的資訊**。這是他的文，你只是幫他磨。');
  lines.push('- 加入原稿沒有、知識庫也沒有的事實或承諾。');
  lines.push('- 推銷腔與 CTA（「立即預約」「歡迎來店裡坐坐」）。');
  lines.push('- 放連結；hashtag 0～1 個。');
  lines.push('- 寫超過 480 字。');
  lines.push('');
  lines.push('只輸出一個 JSON 物件，不要其他文字：');
  lines.push('{"text":"優化後全文","hook":"第一行為什麼抓得住人，一句話","topic":"建議主題",');
  lines.push(' "trend":"搭上的熱搜名稱，沒搭就空字串","changes":["改了什麼，每項一句話"]}');
  return lines.join('\n');
}

export function parsePolish(raw, { fallbackText }) {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no json');
    const obj = JSON.parse(raw.slice(start, end + 1));
    const text = typeof obj.text === 'string' && obj.text.trim() ? obj.text.trim() : fallbackText;
    return {
      text,
      hook: typeof obj.hook === 'string' ? obj.hook.trim() : '',
      topic: sanitizeTopic(obj.topic),
      trend: typeof obj.trend === 'string' ? obj.trend.trim() : '',
      changes: Array.isArray(obj.changes)
        ? obj.changes.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim()).slice(0, 8)
        : [],
      ok: text !== fallbackText,
    };
  } catch {
    // 解析失敗不能把使用者的原稿弄丟——原文原樣回去
    return { text: fallbackText, hook: '', topic: null, trend: '', changes: [], ok: false };
  }
}

// 優化一則自己寫的貼文。回傳原文與優化後版本，讓使用者自己決定要不要採用。
// 失敗一律 fail-open：回原文 + ok:false，絕不弄丟使用者寫的東西。
export async function polishDraft({
  text,
  persona = '',
  hotTrends = [],
  ownPosts = [],
  topPosts = [],
  knowledge = '',
  runner = defaultRunner,
  redTeam = true, // 優化完再過一次紅隊（把會被抓語病的斷言改成站得住的說法）
  log = () => {},
}) {
  const original = String(text ?? '').trim();
  if (!original) throw new Error('沒有內容可以優化');

  let raw;
  try {
    raw = await runner(buildPolishPrompt({ text: original, persona, hotTrends, ownPosts, topPosts, knowledge }));
  } catch (e) {
    log(`⚠️ 優化失敗（保留原稿）：${e.message}`);
    return { original, text: original, hook: '', topic: null, trend: '', changes: [], reviewNote: '', ok: false };
  }

  const p = parsePolish(String(raw), { fallbackText: original });
  let reviewNote = '';
  if (p.ok && redTeam) {
    const r = await redTeamDraft({ text: p.text, knowledge, runner });
    if (r.changed) {
      p.text = r.text;
      reviewNote = r.note;
      log(`🛡 已改寫可能被戰的說法：${r.note || '(未說明)'}`);
    }
  }
  return { original, ...p, reviewNote };
}
