import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativePrompt, parseDrafts, generateDrafts, suggestTopic,
  buildRedTeamPrompt, parseRedTeam, redTeamDraft,
  assignGoals, POST_GOALS,
} from '../src/native_ai.mjs';

// ── 成長期：拿「表現最好的」當範本 + 每批分工 + 搜尋字 ──
test('assignGoals：依配比循環指派，配比壞掉回落預設', () => {
  assert.deepEqual(assignGoals(3), ['reach', 'engage', 'brand']);
  assert.deepEqual(assignGoals(4, ['reach', 'engage']), ['reach', 'engage', 'reach', 'engage']);
  assert.deepEqual(assignGoals(2, ['亂寫', null]), ['reach', 'engage']); // 全無效 → 用全部目標
  assert.deepEqual(assignGoals(0), []);
});

test('buildNativePrompt：成效最好的貼文帶數字進 prompt，並要求歸納「為什麼有效」', () => {
  const p = buildNativePrompt({
    persona: 'x',
    topPosts: [{ text: '週五晚上最後一桌', metrics: { views: 5200, likes: 88, replies: 31 } }],
    n: 1,
  });
  assert.match(p, /成效最好的貼文/);
  assert.match(p, /週五晚上最後一桌/);
  assert.match(p, /瀏覽 5200/);
  assert.match(p, /留言 31/);
  assert.match(p, /不是照抄內容/);
});

test('buildNativePrompt：沒有成效資料時不出現該段落', () => {
  const p = buildNativePrompt({ persona: 'x', n: 1 });
  assert.doesNotMatch(p, /成效最好的貼文/);
});

test('buildNativePrompt：冠軍貼文要帶日期（才知道哪些是舊的）', () => {
  const p = buildNativePrompt({
    persona: 'x',
    topPosts: [{ text: '很久以前那則', timestamp: '2026-01-15T10:00:00+0000', metrics: { views: 900 } }],
    n: 1,
  });
  assert.match(p, /2026-01-15｜瀏覽 900/);
});

test('buildNativePrompt：最新＋冠軍並存時，明講衝突聽誰的', () => {
  const p = buildNativePrompt({
    persona: 'x',
    ownPosts: ['最近的'],
    topPosts: [{ text: '舊冠軍', metrics: { views: 900 } }],
    n: 1,
  });
  assert.match(p, /語氣聽最近的，寫法聽成效好的/);
  assert.match(p, /不要把舊主題、舊活動、舊檔期搬回來/);
});

test('buildNativePrompt：只有其中一份時不出現分工說明（沒東西可衝突）', () => {
  const onlyRecent = buildNativePrompt({ persona: 'x', ownPosts: ['最近的'], n: 1 });
  assert.doesNotMatch(onlyRecent, /語氣聽最近的/);
  const onlyTop = buildNativePrompt({ persona: 'x', topPosts: [{ text: 'a', metrics: {} }], n: 1 });
  assert.doesNotMatch(onlyTop, /語氣聽最近的/);
});

test('buildNativePrompt：分工說明（觸及/互動/品牌）逐則寫清楚', () => {
  const p = buildNativePrompt({ persona: 'x', goals: ['reach', 'engage', 'brand'], n: 3 });
  assert.match(p, /第 1 則【觸及型】/);
  assert.match(p, /第 2 則【互動型】/);
  assert.match(p, /第 3 則【品牌型】/);
  assert.match(p, /留言數/);
  assert.match(p, /"goal"/); // 輸出格式要回填 goal
});

test('buildNativePrompt：搜尋字當訊號，但明講不要寫成 SEO 文', () => {
  const p = buildNativePrompt({ persona: 'x', searchTerms: ['台北 電競酒吧', '大安區美食'], n: 1 });
  assert.match(p, /台北 電競酒吧/);
  assert.match(p, /SEO/);
});

test('parseDrafts：以指派的分工為準，AI 回填只是確認', () => {
  // 舊行為是「AI 回填優先」，但那讓 goalMix 形同虛設——模型隨口回一個別的目標
  // 就能蓋掉配比，輪替保證失效（實際踩過：指派 story、回填 share）。
  // 指派是指令，回填只是確認；不一致代表模型沒照做，不該寫進我們的帳。
  const raw = '[{"text":"一","goal":"engage"},{"text":"二"},{"text":"三","goal":"亂寫"}]';
  const out = parseDrafts(raw, { goals: ['reach', 'engage', 'brand'] });
  assert.deepEqual(out.map((d) => d.goal), ['reach', 'engage', 'brand']);
  assert.ok(out.every((d) => Object.keys(POST_GOALS).includes(d.goal)));
});

test('generateDrafts：把 topPosts/searchTerms/分工 都送進 prompt，草稿帶回 goal', async () => {
  let seen = '';
  const runner = async (prompt) => {
    seen = prompt;
    return '[{"text":"稿一","angle":"a","topic":"t"},{"text":"稿二","angle":"b","topic":"t"}]';
  };
  const out = await generateDrafts({
    persona: 'p',
    topPosts: [{ text: '爆過的那則', metrics: { views: 900, replies: 12 } }],
    searchTerms: ['台北酒吧'],
    goalMix: ['reach', 'engage'],
    n: 2,
    runner,
    redTeam: false,
  });
  assert.match(seen, /爆過的那則/);
  assert.match(seen, /台北酒吧/);
  assert.match(seen, /第 1 則【觸及型】/);
  assert.equal(out[0].goal, 'reach');
  assert.equal(out[1].goal, 'engage');
});

// ── 語氣人化 + 反商業 + 知識庫接地 ──
test('buildNativePrompt：含人化寫法、反 AI 腔、反商業腔規則', () => {
  const p = buildNativePrompt({ persona: 'x', n: 3 });
  assert.match(p, /第一行就是鉤子/);
  assert.match(p, /AI 腔/);
  assert.match(p, /在這個◯◯的時代/);
  assert.match(p, /商業腔/);
  assert.match(p, /立即預約|歡迎來店裡坐坐/);
  assert.match(p, /不放連結/);
  assert.match(p, /會被抓語病的權威斷言/);
});

test('buildNativePrompt：有知識庫時要求只用它做肯定陳述', () => {
  const p = buildNativePrompt({ persona: 'x', knowledge: '- 紅酒先冰 20 分鐘', n: 1 });
  assert.match(p, /知識庫/);
  assert.match(p, /紅酒先冰 20 分鐘/);
  assert.match(p, /不准當權威事實斷言/);
});

test('buildNativePrompt：自己的貼文當語氣範本（模仿說話方式）', () => {
  const p = buildNativePrompt({ persona: 'x', ownPosts: ['小編今天又忘記關冰箱🙇‍♀️'], n: 1 });
  assert.match(p, /這就是我們的說話方式/);
  assert.match(p, /小編今天又忘記關冰箱/);
});

// ── 紅隊審稿 ──
test('buildRedTeamPrompt：知識型網友視角 + 不准改得更無聊', () => {
  const p = buildRedTeamPrompt({ text: '紅酒就是要常溫喝', knowledge: '- 我們先冰 20 分鐘' });
  assert.match(p, /抓語病/);
  assert.match(p, /紅酒就是要常溫喝/);
  assert.match(p, /不可以比原本更無聊/);
  assert.match(p, /不准加「可能、也許/);
  assert.match(p, /我們先冰 20 分鐘/); // 知識庫有帶進去
});

test('parseRedTeam：解析改寫結果', () => {
  const r = parseRedTeam('前綴 {"text":"改好的稿","changed":true,"note":"把常溫斷言改成自家做法"} 後綴', { fallbackText: '原稿' });
  assert.equal(r.text, '改好的稿');
  assert.equal(r.changed, true);
  assert.match(r.note, /自家做法/);
});

test('parseRedTeam：壞輸出 → 保留原稿、不擋流程', () => {
  const r = parseRedTeam('AI 講了一堆廢話沒有 JSON', { fallbackText: '原稿' });
  assert.equal(r.text, '原稿');
  assert.equal(r.changed, false);
});

test('redTeamDraft：AI 掛掉也不擋流程（原文放行）', async () => {
  const runner = async () => { throw new Error('claude 掛了'); };
  const r = await redTeamDraft({ text: '原稿', runner });
  assert.equal(r.text, '原稿');
  assert.equal(r.changed, false);
});

test('generateDrafts：跑紅隊審稿，改寫後的文字進草稿並附 reviewNote', async () => {
  // 用「知識型網友」判斷是不是紅隊 prompt（只有紅隊 prompt 有這個角色設定）
  const runner = async (prompt) => (
    prompt.includes('知識型網友')
      ? '{"text":"台灣的常溫對紅酒太熱，我們一律先冰 20 分鐘","changed":true,"note":"把常溫斷言改成自家做法"}'
      : '[{"text":"紅酒就是要常溫喝","angle":"a","topic":"紅酒"}]'
  );
  const out = await generateDrafts({ persona: 'p', n: 1, runner, knowledge: '- 先冰 20 分鐘' });
  assert.match(out[0].text, /先冰 20 分鐘/);
  assert.match(out[0].reviewNote, /自家做法/);
  assert.equal(out[0].topic, '紅酒'); // 主題保留
});

test('generateDrafts：redTeam=false 時不跑審稿（省一次呼叫）', async () => {
  let calls = 0;
  const runner = async () => { calls += 1; return '[{"text":"稿","angle":"a","topic":"t"}]'; };
  const out = await generateDrafts({ persona: 'p', n: 1, runner, redTeam: false });
  assert.equal(calls, 1);
  assert.equal(out[0].reviewNote, '');
});

test('buildNativePrompt 含 persona/熱搜/新聞/站內/自己貼文', () => {
  const p = buildNativePrompt({
    persona: 'ARGO人設',
    hotTrends: [{ topic: '大樂透', traffic: '10000+', context: '頭獎9億' }],
    newsTitles: ['新聞A'],
    tagPosts: [{ text: '站內貼文X' }],
    ownPosts: ['自己Y'],
    n: 3,
  });
  assert.match(p, /ARGO人設/);
  assert.match(p, /即時熱搜/);
  assert.match(p, /大樂透（流量 10000\+）：頭獎9億/);
  assert.match(p, /政治、災難/);
  assert.match(p, /新聞A/);
  assert.match(p, /站內貼文X/);
  assert.match(p, /自己Y/);
  assert.match(p, /JSON 陣列/);
});

test('無熱搜素材時不出現熱搜段落', () => {
  const p = buildNativePrompt({ persona: 'x', newsTitles: [], tagPosts: [], ownPosts: [], n: 1 });
  assert.doesNotMatch(p, /即時熱搜/);
});

test('parseDrafts 解析並擋超長/缺欄位', () => {
  const raw = '亂碼前 [{"text":"稿一","angle":"角度"},{"nope":1},{"text":"' + '字'.repeat(501) + '"}] 後綴';
  const out = parseDrafts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, '稿一');
  assert.equal(out[0].angle, '角度');
});

test('parseDrafts 找不到陣列拋錯', () => {
  assert.throws(() => parseDrafts('沒有 JSON'), /找不到/);
});

test('parseDrafts 全部無效拋錯', () => {
  assert.throws(() => parseDrafts('[{"nope":1}]'), /未產出/);
});

test('buildNativePrompt 要求 AI 一併建議主題', () => {
  const p = buildNativePrompt({ persona: 'x', n: 2 });
  assert.match(p, /主題\(topic\)/);
  assert.match(p, /"topic":"主題"/);
});

test('parseDrafts 解析並整理 AI 建議的主題（去符號/截長/無效回 null）', () => {
  const raw = '[{"text":"稿一","angle":"a","topic":"調酒.吧"},{"text":"稿二","angle":"b","topic":"' + '長'.repeat(60) + '"},{"text":"稿三","topic":"  "}]';
  const out = parseDrafts(raw);
  assert.equal(out[0].topic, '調酒吧'); // 句點被去掉
  assert.equal([...out[1].topic].length, 50); // 截到 50 字
  assert.equal(out[2].topic, null); // 空白 → null
});

test('generateDrafts 用注入 runner，回傳含 topic', async () => {
  const runner = async () => '[{"text":"嗨","angle":"a","topic":"派對"}]';
  const out = await generateDrafts({ persona: 'p', newsTitles: [], tagPosts: [], ownPosts: [], n: 1, runner });
  assert.equal(out[0].text, '嗨');
  assert.equal(out[0].topic, '派對');
});

test('suggestTopic：注入 runner，整理輸出（取第一行、去符號）', async () => {
  const runner = async () => '#微醺週五\n（這是說明，不該被採用）';
  const t = await suggestTopic({ text: '週五來喝一杯', persona: 'p', runner });
  assert.equal(t, '微醺週五');
});

test('suggestTopic：空內容回 null、不呼叫 AI', async () => {
  let called = false;
  const runner = async () => { called = true; return 'x'; };
  const t = await suggestTopic({ text: '   ', runner });
  assert.equal(t, null);
  assert.equal(called, false);
});

test('buildNativePrompt：沒把握的專業題目 → 丟問題請內行人回答，不硬給答案', () => {
  const p = buildNativePrompt({ persona: 'x', n: 1 });
  assert.match(p, /沒把握的專業題目/);
  assert.match(p, /不要硬給答案/);
  assert.match(p, /讓懂的人在留言區教大家/);
  assert.match(p, /催出高品質留言/);
});

// ── share 目標 + 配比輪替 ──────────────────────────────
test('POST_GOALS 有 share，且講的是分享不是讚', async () => {
  const { POST_GOALS } = await import('../src/native_ai.mjs');
  assert.ok(POST_GOALS.share, 'share 目標要存在');
  assert.match(POST_GOALS.share.brief, /分享數/);
  assert.match(POST_GOALS.share.brief, /傳給.*特定的人/);
  // 四種寫法都要在，否則 AI 只會寫其中一種
  for (const kw of ['冷知識', '對號入座', '懶人包', '邀請函']) {
    assert.match(POST_GOALS.share.brief, new RegExp(kw), `缺少寫法：${kw}`);
  }
  // 不可以退化成推銷
  assert.match(POST_GOALS.share.brief, /不是推銷 CTA/);
});

test('assignGoals：每批數量 < 配比長度時，靠 offset 跨批次輪完一圈', async () => {
  const { assignGoals } = await import('../src/native_ai.mjs');
  const mix = ['reach', 'engage', 'brand', 'share'];
  // 這是實際會踩到的組合：draftsPerRun=3、四種目標。
  // 沒有 offset 的話 share 永遠輪不到。
  assert.deepEqual(assignGoals(3, mix, 0), ['reach', 'engage', 'brand']);
  assert.deepEqual(assignGoals(3, mix, 3), ['share', 'reach', 'engage']);
  const seen = new Set();
  for (let off = 0; off < 12; off += 3) assignGoals(3, mix, off).forEach((g) => seen.add(g));
  assert.deepEqual([...seen].sort(), ['brand', 'engage', 'reach', 'share'], '四批之內每個目標都要輪到');
});

test('assignGoals：offset 超過長度或為負都要正常繞回', async () => {
  const { assignGoals } = await import('../src/native_ai.mjs');
  const mix = ['reach', 'engage', 'brand', 'share'];
  assert.deepEqual(assignGoals(2, mix, 4), ['reach', 'engage']);
  assert.deepEqual(assignGoals(2, mix, 9), ['engage', 'brand']);
  assert.deepEqual(assignGoals(2, mix, -1), ['share', 'reach']);
});

test('assignGoals：不認得的目標代號要濾掉', async () => {
  const { assignGoals } = await import('../src/native_ai.mjs');
  assert.deepEqual(assignGoals(2, ['share', '亂打的'], 0), ['share', 'share']);
});

// ── 段子型 ─────────────────────────────────────────────
test('POST_GOALS.story 帶齊三段結構與「不要提自己的店」', async () => {
  const { POST_GOALS } = await import('../src/native_ai.mjs');
  const b = POST_GOALS.story.brief;
  assert.match(b, /鋪陳/);
  assert.match(b, /誤導/);
  assert.match(b, /最後一句翻轉/);
  // 零品牌提及是它會被轉發的原因，加了就沒人轉
  assert.match(b, /一個字都不要提自己的店/);
  assert.match(b, /沒有 hashtag/);
  // 講完就停——AI 最愛在笑話後面補一句解釋，那會直接殺死笑點
  assert.match(b, /不要解釋笑點/);
});

test('POST_GOALS.story：要學的是結構，題材不綁酒', async () => {
  const { POST_GOALS } = await import('../src/native_ai.mjs');
  const b = POST_GOALS.story.brief;
  // 這條原本寫死「素材從酒吧世界取」，等於把範例的「場景」誤當成它會紅的原因。
  // 範例紅是因為結構，不是因為講酒——寫死題材反而砍掉最會被轉的那些題目。
  assert.doesNotMatch(b, /素材從酒吧世界取/);
  assert.match(b, /題材完全自由，不必跟酒有關/);
  // 硬轉回酒是「這是廣告」的破綻，分享數會直接歸零
  assert.match(b, /不准硬把結尾轉回酒/);
  // 雙層笑點的說法要對所有題材成立，不能只寫「懂酒的人」
  assert.match(b, /懂的人會多笑一層/);
  assert.doesNotMatch(b, /懂酒的人會多笑一層/);
});

test('buildNativePrompt：有讀者輪廓就帶進去，並明講不要硬轉回產品', async () => {
  const { buildNativePrompt } = await import('../src/native_ai.mjs');
  const p = buildNativePrompt({
    persona: 'x',
    audienceInterests: ['EDM 與電音場', 'K-POP 追星', '美食踩點'],
    n: 1,
  });
  assert.match(p, /讀者輪廓/);
  assert.match(p, /EDM 與電音場/);
  assert.match(p, /K-POP 追星/);
  assert.match(p, /硬轉回產品的貼文/);
});

test('buildNativePrompt：沒有讀者輪廓時不出現該段落', async () => {
  const { buildNativePrompt } = await import('../src/native_ai.mjs');
  const p = buildNativePrompt({ persona: 'x', n: 1 });
  assert.doesNotMatch(p, /讀者輪廓/);
});

test('buildNativePrompt：蹭熱搜不再要求「只挑跟店有關的」', async () => {
  const { buildNativePrompt } = await import('../src/native_ai.mjs');
  const p = buildNativePrompt({ persona: 'x', n: 1 });
  assert.doesNotMatch(p, /只挑能跟店/);
  assert.match(p, /硬轉回產品比不蹭還糟/);
});

test('generateDrafts：讀者輪廓要傳到 prompt 裡（不能在中間掉包）', async () => {
  const { generateDrafts } = await import('../src/native_ai.mjs');
  let seen = '';
  await generateDrafts({
    persona: 'x',
    audienceInterests: ['戰鬥陀螺'],
    n: 1,
    redTeam: false,
    runner: async (prompt) => {
      seen = prompt;
      return '[{"text":"甲"}]';
    },
  });
  assert.match(seen, /戰鬥陀螺/);
});

test('assignGoals：五種目標都輪得到', async () => {
  const { assignGoals } = await import('../src/native_ai.mjs');
  const mix = ['reach', 'engage', 'brand', 'share', 'story'];
  const seen = new Set();
  for (let off = 0; off < 15; off += 3) assignGoals(3, mix, off).forEach((g) => seen.add(g));
  assert.deepEqual([...seen].sort(), ['brand', 'engage', 'reach', 'share', 'story']);
});

test('parseDrafts：指派的 goal 說了算，AI 回填不能蓋掉配比', async () => {
  const { parseDrafts } = await import('../src/native_ai.mjs');
  // 模型常常自作主張回填別的目標——蓋掉的話 goalMix 的輪替保證就失效了
  const raw = '[{"text":"甲","goal":"share"},{"text":"乙","goal":"reach"}]';
  const out = parseDrafts(raw, { goals: ['story', 'brand'] });
  assert.deepEqual(out.map((d) => d.goal), ['story', 'brand']);
});

test('parseDrafts：沒有指派時才用 AI 回填的，且只收認得的代號', async () => {
  const { parseDrafts } = await import('../src/native_ai.mjs');
  const out = parseDrafts('[{"text":"甲","goal":"story"},{"text":"乙","goal":"亂打的"}]', { goals: [] });
  assert.deepEqual(out.map((d) => d.goal), ['story', null]);
});

test('buildNativePrompt：產稿時就帶法規紅線（不能只靠紅隊事後補救）', async () => {
  const { buildNativePrompt } = await import('../src/native_ai.mjs');
  const p = buildNativePrompt({ persona: 'x', goals: ['story'], n: 1 });
  assert.match(p, /食品安全衛生管理法/);
  assert.match(p, /菸酒管理法/);
  assert.match(p, /段子型/);
});
