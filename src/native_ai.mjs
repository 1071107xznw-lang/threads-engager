import { defaultRunner } from './ai.mjs';
import { sanitizeTopic } from './threads_publish.mjs';
import { summarizeMetrics } from './insights.mjs';
import { LEGAL_RULES, humorRules } from './compliance.mjs';
import { PERSONAL_VOICE_RULES } from './brand.mjs';

// 每則草稿的任務分工。成長期要的是「被更多沒追蹤你的人看到」+「有人留言」，
// 所以預設一批裡觸及型、互動型、品牌型各一，不要三則都在講自己的店。
export const POST_GOALS = {
  reach: {
    label: '觸及型',
    brief: '蹭當下熱搜/時勢，寫給「還沒追蹤我們的人」看。'
      + '不需要提到店也沒關係，重點是讓路過的人看得懂、想轉發。',
  },
  engage: {
    label: '互動型',
    brief: '目標是「留言數」。丟一個超好回答的問題：二選一、幫我決定、你們都怎麼做、最不能接受哪一種。'
      + '問題要具體到讓人一秒有答案，不要問「你覺得呢？」這種空問題。',
  },
  brand: {
    label: '品牌型',
    brief: '講我們的專業、店裡的日常或在地觀察，建立記憶點。'
      + '要有畫面或有內行細節，不是宣傳文。',
  },
  // 分享型：追的是「✈️ 分享」而不是讚。分享是唯一會把貼文帶出演算法之外的動作
  // （進私訊、進限動），所以最值錢。但它的開關跟讚完全不同——
  // 讀的人腦中要跳出一張具體的臉，才會按下去。
  //
  // 實測對照（同一天、讚數幾乎一樣的兩則）：
  //   冷知識「今天是國際紅綠燈日」→ 206 讚、142 分享
  //   求推薦「爸爸能喝的酒」    → 197 讚、12 分享
  // 差 12 倍。差別在前者是「可以脫離貼文單獨存在的事實」，轉述它不必背書。
  share: {
    label: '分享型',
    brief: '目標是「✈️ 分享數」，不是讚。要讓讀的人想**傳給某個特定的人**。'
      + '四種寫法擇一：'
      + '(1) 冷知識——一個可以脫離貼文單獨存在的事實（典故、由來、為什麼要這樣做），'
      + '傳的人不必背書，社交成本零；'
      + '(2) 對號入座——「每群朋友都有一個…」列 3～5 種，讀的人會想到具體的臉；'
      + '(3) 懶人包——可收藏的清單，解決一個很具體的難題；'
      + '(4) 邀請函——把貼文寫成可以直接轉給朋友當邀約用的樣子。'
      + '⚠️ **不准明著叫人分享／轉發／按讚／追蹤**（例：「傳給那個每次都說自己沒醉的朋友」）。'
      + 'Meta 已確認這種明示 CTA 會被判定為 engagement bait 而降權，反效果。'
      + '正確做法是**寫得夠具體，讓讀者自己想到一張臉**——'
      + '大部分人不分享只是因為沒想到要傳給誰，而不是因為沒被叫。',
  },
  // 段子：分享率最高的形式，但也最難寫——不好笑的笑話比不發還糟。
  //
  // 為什麼跟 share 分開：share 的四種寫法都是「有用的資訊」，段子是「純娛樂」，
  // craft 完全不同（要鋪陳、要誤導、要最後一句翻轉），失敗模式也不同。
  //
  // 參考基準（實際觀察到的一則）：3,203 讚 / 326 分享 ≈ 10% 分享率。
  // 那則的結構是：高樓酒吧 → 有人示範「飛行」這杯喝了會飛 → 跟著喝的人摔死 →
  // 最後一句「超人，你喝醉之後真的很靠北」把前面全部重寫。
  //
  // ⚠️ 要學的是**那個結構**（鋪陳→誤導→最後一句翻轉），不是「酒吧題材」。
  // 這條原本寫死「素材從酒吧世界取」，是抄錯重點：範例剛好發生在酒吧，
  // 但它紅不是因為講酒。看調酒的人同時也在追 EDM／DJ／KPOP／中西洋金曲、也在吃美食，
  // 寫他們在意的事就會被轉；硬把結尾轉回酒反而暴露這是廣告，直接殺掉分享。
  story: {
    label: '段子型',
    brief: '寫一則**完整的笑話或短故事**，目標是「有人願意把它轉述給別人」。'
      + '**唯一不能動的是結構**，三段：(1) 平常的鋪陳；(2) 一個讓人以為懂了的誤導；'
      + '(3) **最後一句翻轉**——那一句要能把前面整段重寫，看完會想倒回去重看。'
      + '排版：每句一行、大量斷行，不要寫成一整塊。'
      + '**題材完全自由，不必跟酒有關**：讀者在意什麼就寫什麼——音樂、追星、電競、'
      + '美食、上班、感情、當下的熱搜都可以（上面若有讀者輪廓，優先從那裡取材）。'
      + '⚠️ **不准硬把結尾轉回酒、轉回店**。硬轉比不轉還糟：一被看出是廣告就沒人轉了。'
      + '一則完全沒提到酒的段子，照樣是這個帳號的段子。'
      + '**懂的人會多笑一層，不懂的人也看得懂**——這個雙層才是被瘋傳的關鍵。'
      + '講完就停，**絕對不要解釋笑點**，不要補「是不是很好笑」這種話。'
      + '**一個字都不要提自己的店**，沒有 hashtag、沒有 CTA、沒有地址——'
      + '零品牌提及正是它會被轉發的原因，加了就沒人轉了。',
  },
};

// 依配比為 n 則草稿指派目標（配比不足就循環）。
//
// offset：從配比的第幾個開始輪。**每批草稿數 < 配比長度時，這個參數是必要的**——
// 否則永遠只會產出配比的前 n 個，排在後面的目標一次都輪不到。
// （實例：draftsPerRun=3、goalMix 有 4 個，share 會永遠被跳過。）
// 上層傳「目前已有幾則草稿」當 offset，跨批次就會自然輪完一圈。
export function assignGoals(n, mix = ['reach', 'engage', 'brand'], offset = 0) {
  const valid = (Array.isArray(mix) ? mix : []).filter((k) => k in POST_GOALS);
  const use = valid.length ? valid : Object.keys(POST_GOALS);
  const start = ((Math.trunc(offset) % use.length) + use.length) % use.length; // 負數也要對
  return Array.from({ length: Math.max(0, n) }, (_, i) => use[(start + i) % use.length]);
}

// 依品牌人設 + 知識庫 + 趨勢素材 + 自家成效，組出「產生原生貼文草稿」的繁中 prompt。
export function buildNativePrompt({
  persona, hotTrends = [], newsTitles = [], tagPosts = [], ownPosts = [],
  humor,              // 幽默尺度：mild／spicy／hellish
  topPosts = [],      // 自己成效最好的貼文（含 metrics）——學「什麼有效」
  searchTerms = [],   // 大家用什麼字找我們／我們想被搜到的字
  audienceInterests = [], // 讀者除了我們賣的東西以外還在意什麼
  topicPool = [],     // 排序過的 Threads 主題候選（topic_rank.rankTopics 產生）
  goals = [],         // 每則的任務分工（assignGoals 產生）
  avoid = null,       // 重新生成用：{ text, reason } —— 上一版被打回票了
  knowledge = '', n = 3,
}) {
  const lines = [];
  lines.push(`人設：${persona}`);
  lines.push('');
  // 人設是「我是誰」，這段是「我在對誰講話」。少了它，AI 會把每一則都硬轉回產品。
  if (audienceInterests.length) {
    lines.push('【讀者輪廓——他們在意的不只有我們賣的東西】');
    // 一行一項，不要用「、」串起來：項目本身就常含頓號（例「桌遊、戰鬥陀螺」），
    // 串起來會分不出邊界，讀成一堆碎詞。
    audienceInterests.slice(0, 20)
      .map((t) => String(t).trim()).filter(Boolean)
      .forEach((t) => lines.push(`- ${t}`));
    lines.push('');
    lines.push('※ 寫的時候想著這群人，不是想著「怎麼把話題轉回我的店」。');
    lines.push('  一則戳中他們、卻完全沒提到我們產品的貼文，比一則硬轉回產品的貼文有效得多。');
    lines.push('');
  }
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
    // 清單長度要跟著批次量走：一批 15 則卻只給 12 個主題，後面幾則保證撞題。
    hotTrends.slice(0, Math.max(12, n)).forEach((t, i) => {
      const traffic = t.traffic ? `（流量 ${t.traffic}）` : '';
      const ctx = t.context ? `：${String(t.context).slice(0, 60)}` : '';
      lines.push(`${i + 1}. ${t.topic}${traffic}${ctx}`);
    });
    lines.push('');
    if (n > 1) {
      lines.push(`※ 這批要產 ${n} 則，**每則蹭一個不同的主題，不准兩則蹭同一個**。`);
      lines.push('  在 angle 欄位註明這則蹭的是哪一個（例：「蹭『◯◯◯』」）。');
      lines.push('  上面的清單不夠用時，用近期新聞或讀者輪廓裡的題材補——一樣不准重複。');
      lines.push('');
    }
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
  if (topPosts.length) {
    lines.push('【我們自己成效最好的貼文——這幾則是真的有流量的，請研究它們為什麼有效】');
    topPosts.slice(0, 5).forEach((p, i) => {
      // 帶日期：冠軍可能是很久以前的，AI 要知道哪些是舊的，才不會把舊主題搬回來
      const when = p.timestamp ? `${String(p.timestamp).slice(0, 10)}｜` : '';
      lines.push(`${i + 1}.（${when}${summarizeMetrics(p.metrics || {})}）${String(p.text || '').slice(0, 200)}`);
    });
    lines.push('');
    lines.push('※ 這是「什麼有效」的實證，不是語氣範本。請歸納：第一行的鉤子怎麼下、挑什麼主題、');
    lines.push('  寫多長、有沒有丟問題、情緒是什麼——然後把這批新稿往這些方向靠。');
    lines.push('  是複製「為什麼有人看」，不是照抄內容或主題。');
    lines.push('');
  }
  // 兩份自家範本並存時，明講各自負責什麼、衝突聽誰的——否則 AI 會把舊冠軍的主題搬回來。
  if (ownPosts.length && topPosts.length) {
    lines.push('※ 上面兩份「我們自己的貼文」分工不同，不要搞混：');
    lines.push('  ·【最近的貼文】＝**現在的語氣與方向**。用字、句長、emoji 與斷行習慣、');
    lines.push('    現在在講什麼題材，一律以這份為準。');
    lines.push('  ·【成效最好的】＝**什麼寫法有效**。鉤子怎麼下、結構、要不要丟問題，學這份。');
    lines.push('  · 兩者衝突時：**語氣聽最近的，寫法聽成效好的**。');
    lines.push('  · 成效好的那幾則若日期較舊，只借它的寫法——**不要把舊主題、舊活動、舊檔期搬回來**。');
    lines.push('');
  }
  if (searchTerms.length) {
    lines.push('【大家都用這些字找我們／我們想被搜到的字】');
    lines.push(searchTerms.slice(0, 25).join('、'));
    lines.push('');
    lines.push('※ 自然用上其中 1～2 個字眼就好。不要硬塞、不要列清單、不要寫成 SEO 文。');
    lines.push('');
  }

  if (goals.length) {
    lines.push(`## 這批 ${n} 則的分工（每則任務不同，不要三則都在講自己的店）`);
    goals.slice(0, n).forEach((key, i) => {
      const g = POST_GOALS[key];
      if (g) lines.push(`- 第 ${i + 1} 則【${g.label}】：${g.brief}`);
    });
    lines.push('');
    lines.push(`※ 請照這個順序輸出，並在每則的 goal 欄位回填對應代號（${Object.keys(POST_GOALS).join('／')}）。`);
    lines.push('');
  }

  // 重新生成：使用者對某一則按了「換一則」。這段要放在分工之後——
  // 分工不變（不滿意的是「這則寫得不好」，不是「這個任務指派錯了」），變的是內容。
  if (avoid && String(avoid.text || '').trim()) {
    lines.push('## 🔄 這是「重新生成」——上一版被打回票了');
    lines.push('上一版（**不要再寫成這樣**）：');
    lines.push(String(avoid.text).trim().slice(0, 500));
    lines.push('');
    if (String(avoid.reason || '').trim()) {
      lines.push(`使用者說哪裡不滿意：${String(avoid.reason).trim().slice(0, 200)}`);
      lines.push('※ 這句是**最優先**的指示，比上面任何偏好都重要。');
      lines.push('');
    }
    lines.push('※ 不是把上一版改寫或潤飾，是**重寫一則全新的**：換題材、換角度、換開頭第一句。');
    lines.push('  只有任務分工不變。');
    lines.push('');
  }

  // 法規要在**產稿時**就進去，不能只靠後面的紅隊審稿。
  // 踩到紅線的貼文（尤其段子）是整則要重寫，不是事後改幾個字救得回來的。
  lines.push(LEGAL_RULES);
  lines.push('');
  lines.push(PERSONAL_VOICE_RULES);
  lines.push('');
  lines.push(humorRules(humor));
  lines.push('');
  lines.push('## 怎麼寫（Threads 上真的有人看的寫法）');
  lines.push('- **第一行就是鉤子**：Threads 會折疊，第一行決定別人要不要展開。');
  lines.push('  不要暖場、不要「大家好」、不要先鋪陳背景。');
  lines.push('- 短句、多斷行，手機一行不要太長。用空行分段。');
  lines.push('- 像真人在跟朋友講話：可以有語氣詞、可以不完整句、可以自嘲或碎念。');
  lines.push('- **有觀點、敢站隊**——但立場只能建立在知識庫或「我們自己的做法/偏好」上。');
  lines.push('- 具體細節 > 形容詞（「先冰 20 分鐘」勝過「口感絕佳」）。');
  lines.push('- 結尾留一個讓人想回話的東西：問題、邀戰、或沒說完的話。');
  lines.push('- **碰到我們沒把握的專業題目**（酒的適飲溫度、年份、產地、釀造工法、餐酒搭配理論）：');
  lines.push('  **不要硬給答案，把問題丟出去讓懂的人在留言區教大家。**');
  lines.push('  講自己的做法或感受 →「你們都怎麼弄？」「有沒有內行的來解釋一下？」');
  lines.push('  這樣既不會被抓語病，又會催出高品質留言——留言是最值錢的互動。');
  // 「連結會壓觸及」曾經是對的，但 Meta 2025 反向調整了排序，帶連結的貼文反而表現較好。
  // 留著舊規則等於叫 AI 主動避開一個現在有加分的東西。
  lines.push('- 連結不再被降權（Meta 2025 已調整），有需要就放，但不要為了放而放。');
  lines.push('- hashtag 0～1 個。');
  lines.push('- ⚠️ **不准明著要互動**：「按讚」「留言告訴我」「分享給朋友」「追蹤我」這類句子');
  lines.push('  會被判定為 engagement bait 而降權。要留言就丟一個真的想知道答案的問題，');
  lines.push('  要分享就把內容寫到值得分享——不要用叫的。');
  lines.push('');
  lines.push('## 絕對不要');
  lines.push('- **AI 腔**：罐頭金句、「在這個◯◯的時代」、「不僅…更是…」、排比堆疊、');
  lines.push('  萬用形容詞（完美/絕佳/獨特/難忘的體驗）、每句都工整。寧可口語、隨性、有點不完美。');
  lines.push('- **商業腔**：宣傳語、優惠推銷、「歡迎來店裡坐坐」「立即預約」這類 CTA 結尾。');
  lines.push(`  ${n} 則裡最多 1 則（就是品牌型那則）可以自然帶到店，而且店要當背景、不是主角。`);
  lines.push('- **會被抓語病的權威斷言**：酒的適飲溫度、產地年份、法規、健康營養、歷史典故等，');
  lines.push('  知識庫沒寫就不准用「就是要…」「正確做法是…」的口氣。改成自家做法或偏好。');
  lines.push('- 蹭政治、災難、意外、悲劇、八卦爭議——寧可不蹭。');
  lines.push('');
  lines.push('## 其他');
  lines.push('- 每則繁體中文、≤480 字，切入角度都不同（angle 一句話說明切入點）。');
  // 「見上面的讀者輪廓」只在真的有那一段時才寫，否則等於叫 AI 去看一個不存在的段落。
  lines.push(`- 蹭熱搜要自然：挑**讀者也會在意**的主題${audienceInterests.length ? '（見上面的讀者輪廓）' : ''}，`);
  lines.push('  不是只挑「跟我們產品有關」的。連得回自己很好，連不回去就不要連——');
  lines.push('  **硬轉回產品比不蹭還糟**，那一句轉折就是別人看出這是廣告的地方。');
  lines.push('- 為每則建議「一個」最貼切的 Threads 主題(topic)：1 個簡短詞或詞組、≤20 字、');
  lines.push('  貼近該則內容、用貼文的語言、**不含句點/&/# 等符號**；想不到合適的就給空字串。');
  if (topicPool.length) {
    lines.push('  **主題優先從下面這份清單挑**（已依聲量由高到低排序，挑得到就不要自己另外發明）：');
    topicPool.slice(0, 25).forEach((t, i) => {
      const why = [t.traffic ? `熱度 ${t.traffic}` : null, t.ownNote || null].filter(Boolean).join('、');
      lines.push(`  ${i + 1}. ${t.topic}${why ? `（${why}）` : ''}`);
    });
    lines.push('  清單裡沒有貼切的，才自己想一個——**主題不貼內容比沒有主題還糟**。');
  }
  lines.push('');
  lines.push(
    `只輸出一個 JSON 陣列，長度 ${n}，格式：`
    + '[{"text":"貼文內容","angle":"切入點","topic":"主題","goal":"reach/engage/brand/share/story"}]，不要其他文字。'
  );
  return lines.join('\n');
}

// 解析 AI 輸出的 JSON 陣列，過濾無效/超長草稿。
// goals：這批指派的分工，用來在 AI 沒回填 goal 時依位置補上。
export function parseDrafts(raw, { maxLen = 500, goals = [] } = {}) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('AI 輸出找不到 JSON 陣列');
  const arr = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('AI 輸出不是 JSON 陣列');
  const out = [];
  arr.forEach((item, i) => {
    if (!item || typeof item.text !== 'string') return;
    const text = item.text.trim();
    if (!text || [...text].length > maxLen) return;
    const echoed = typeof item.goal === 'string' ? item.goal.trim().toLowerCase() : '';
    out.push({
      text,
      angle: typeof item.angle === 'string' ? item.angle.trim() : null,
      topic: sanitizeTopic(item.topic), // AI 建議的主題（整理過；無效則 null）
      // 分工以**我們指派的**為準。AI 回填只在沒有指派時當備援——
      // 反過來的話，模型隨口回一個別的目標就會蓋掉配比，goalMix 的輪替保證會失效
      // （實際踩過：指派 story、模型回填 share，徽章標錯、輪替也算錯）。
      goal: goals[i] || ((echoed in POST_GOALS) ? echoed : null),
    });
  });
  if (!out.length) throw new Error('AI 未產出有效草稿');
  return out;
}

// ── 紅隊審稿：發出去之前，先讓「最愛抓語病的知識型網友」挑一遍 ──
//
// 目標不是把話講軟，而是「一樣有態度，但戰不倒」：
// 有知識庫背書的照講；沒把握的改寫成自家做法/偏好，而不是加一堆「可能、也許」。
export function buildRedTeamPrompt({ text, knowledge = '', humor }) {
  const lines = [];
  lines.push('你是 Threads 上最愛抓語病的知識型網友，同時也熟台灣的食品廣告法規。');
  lines.push('以下是一則準備發出的貼文。請逐句找出問題，兩個層次：');
  lines.push('');
  lines.push(LEGAL_RULES);
  lines.push('');
  lines.push(PERSONAL_VOICE_RULES);
  lines.push('');
  lines.push('然後才是「會被留言戰、或被抓語病」的地方，特別是：');
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
  lines.push(humorRules(humor));
  lines.push('');
  lines.push('改寫規則：');
  lines.push('- **法規紅線一律照改、沒有討價還價**——那不是風格問題，是會被開罰。');
  lines.push('- ⚠️ 但**不要把梗改掉**。玩笑、黃腔、地獄梗只要沒踩法規紅線就留著——');
  lines.push('  那是品牌個性，不是問題。你的工作是拆彈，不是消毒。');
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
export async function redTeamDraft({ text, knowledge = '', humor, runner = defaultRunner }) {
  if (!text || !String(text).trim()) return { text, changed: false, note: '' };
  try {
    const raw = await runner(buildRedTeamPrompt({ text, knowledge, humor }));
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
  topPosts = [],    // 自己成效最好的貼文（學「什麼有效」）
  searchTerms = [], // 在地／品牌搜尋字
  audienceInterests = [], // 讀者輪廓（讓題材不必每則都繞回產品）
  topicPool = [],   // 排序過的主題候選（優先挑聲量大的）
  goalMix,          // 這批的分工配比，如 ['reach','engage','brand','share']
  goalOffset = 0,   // 從配比第幾個開始輪（每批數量 < 配比長度時，靠它跨批次輪完一圈）
  humor,            // 幽默尺度
  knowledge = '',
  n = 3,
  runner = defaultRunner,
  redTeam = true, // 產完再跑一次紅隊審稿（可關閉以省一次 AI 呼叫）
  log = () => {},
}) {
  const goals = assignGoals(n, goalMix, goalOffset);
  const prompt = buildNativePrompt({
    persona, hotTrends, newsTitles, tagPosts, ownPosts,
    topPosts, searchTerms, audienceInterests, topicPool, goals, knowledge, humor, n,
  });
  const raw = await runner(prompt);
  const drafts = parseDrafts(raw, { goals }); // 每則含 { text, angle, topic, goal }
  if (!redTeam) return drafts.map((d) => ({ ...d, reviewNote: '' }));

  const reviewed = [];
  for (const [i, d] of drafts.entries()) {
    // 一批 15 則時紅隊要跑 15 次、數分鐘起跳。沒有逐則回報的話畫面會像當掉。
    log(`🛡 紅隊審稿 ${i + 1}/${drafts.length}…`);
    const r = await redTeamDraft({ text: d.text, knowledge, humor, runner });
    if (r.changed) log(`   已改寫可能被戰的說法：${r.note || '(未說明)'}`);
    reviewed.push({ ...d, text: r.text, reviewNote: r.changed ? r.note : '' });
  }
  return reviewed;
}

// 單則重新生成：使用者對某一則不滿意，換一則新的。
//
// 沿用同一個 goal——不滿意的是「這則寫得不好」，不是「這個任務分工指派錯了」。
// 換 goal 的話，goalMix 跨批次輪替的保證就破了。
export async function regenerateDraft({
  persona,
  goal = null,        // 原本的分工，原封不動沿用
  previousText,       // 被打回票的那一版
  reason = '',        // 使用者填的「哪裡不滿意」（選填）
  hotTrends, newsTitles, tagPosts, ownPosts,
  topPosts = [], searchTerms = [], audienceInterests = [], topicPool = [],
  humor, knowledge = '', runner = defaultRunner, redTeam = true, log = () => {},
}) {
  const goals = goal ? [goal] : [];
  const prompt = buildNativePrompt({
    persona, hotTrends, newsTitles, tagPosts, ownPosts,
    topPosts, searchTerms, audienceInterests, topicPool, goals,
    avoid: { text: previousText, reason },
    knowledge, humor, n: 1,
  });
  const raw = await runner(prompt);
  const [draft] = parseDrafts(raw, { goals });
  if (!redTeam) return { ...draft, reviewNote: '' };
  const r = await redTeamDraft({ text: draft.text, knowledge, humor, runner });
  if (r.changed) log(`🛡 已改寫可能被戰的說法：${r.note || '(未說明)'}`);
  return { ...draft, text: r.text, reviewNote: r.changed ? r.note : '' };
}
