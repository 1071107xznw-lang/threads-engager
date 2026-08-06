const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));
const fmt = (iso) => {
  try { return new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

// 每則草稿的任務分工（成長期：觸及 / 互動 / 品牌各一則）
const GOALS = {
  reach: { label: '🚀 觸及', title: '蹭熱搜、寫給還沒追蹤你的人看' },
  engage: { label: '💬 互動', title: '目標是留言數：丟一個超好回答的問題' },
  brand: { label: '🏠 品牌', title: '講專業或店裡日常，建立記憶點' },
  share: { label: '✈️ 分享', title: '目標是分享數：冷知識／對號入座／懶人包／邀請函——讓人想傳給某個特定的人' },
  story: { label: '😂 段子', title: '完整的笑話：鋪陳→誤導→最後一句翻轉。零品牌提及，才有人轉' },
};
const goalBadge = (g) => (GOALS[g]
  ? `<span class="goal ${g}" title="${esc(GOALS[g].title)}">${esc(GOALS[g].label)}</span>`
  : '');

// ── 分頁切換 ──
// 分頁狀態放在網址的 #hash 裡：重新整理不會跳回第一頁、可以把某個分頁加書籤或傳給人，
// 也讓「用網址直接指定分頁」變得可能（例如截圖或做文件時）。
let insightsLoaded = false; // 成效要打不少 API，改成「切到那頁才讀」

function tabFromHash(hash, valid) {
  const name = String(hash || '').replace(/^#/, '');
  return valid.includes(name) ? name : null;
}

function showTab(name, { updateHash = true } = {}) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  const section = $('#' + name);
  if (!tab || !section) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('section').forEach((x) => x.classList.remove('active'));
  tab.classList.add('active');
  section.classList.add('active');
  if (updateHash && location.hash !== '#' + name) location.hash = name;
  if (name === 'insights' && !insightsLoaded) {
    insightsLoaded = true;
    loadInsights();
  }
}

const TAB_NAMES = [...document.querySelectorAll('.tab')].map((t) => t.dataset.tab);
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showTab(t.dataset.tab));
});
// 開頁時、以及上一頁/下一頁時，都以網址為準
window.addEventListener('hashchange', () => {
  const name = tabFromHash(location.hash, TAB_NAMES);
  if (name) showTab(name, { updateHash: false });
});
{
  const initial = tabFromHash(location.hash, TAB_NAMES);
  if (initial) showTab(initial, { updateHash: false });
}

// ── 狀態列 + DRY_RUN 切換 ──
let liveMode = false;
let aiAvailable = false;
async function loadConfig() {
  const c = await api('/api/config');
  if (!c.setupComplete) { location.href = '/setup.html'; return; }
  liveMode = Boolean(c.liveMode);
  aiAvailable = Boolean(c.aiAvailable);
  // 沒有 claude CLI → 隱藏「產生草稿」、顯示提示（仍可手動撰寫）
  $('#gen').style.display = aiAvailable ? '' : 'none';
  $('#polish').style.display = aiAvailable ? '' : 'none'; // 優化也要靠 AI
  $('#aiHint').style.display = aiAvailable ? 'none' : '';
  const title = (c.brandName ? c.brandName + ' ' : '') + '內容中心';
  document.title = title;
  $('#brandTitle').textContent = title;

  const el = $('#dryrun');
  el.dataset.dry = c.dryRun ? '1' : '0';
  el.textContent = c.dryRun ? 'DRY_RUN 乾跑中（點此切換）' : '正式模式・點此切回乾跑';
  el.className = c.dryRun ? 'on' : 'off';

  const bits = [];
  if (c.username) bits.push(`@${esc(c.username)}`);
  if (c.tokenExpiresInDays != null) bits.push(`Token 剩 ${c.tokenExpiresInDays} 天`);
  bits.push(liveMode ? '站內搜尋：開' : '站內搜尋：關（App 未 Live）');
  $('#statusbar').innerHTML = bits.join('　·　');
}

$('#dryrun').addEventListener('click', async () => {
  const currentlyDry = $('#dryrun').dataset.dry === '1';
  if (currentlyDry && !confirm('關閉 DRY_RUN 後，發布與送出回覆會「真的」公開送到 Threads。\n確定切到正式模式？')) return;
  await api('/api/config/dryrun', { method: 'POST', body: JSON.stringify({ dryRun: !currentlyDry }) });
  await loadConfig();
});

// ── 原生貼文 ──
async function loadNativeDrafted() {
  const drafts = await api('/api/native/drafts?status=drafted');
  $('#ndrafted').innerHTML = drafts.map((d) => `
    <div class="card" data-id="${d.id}">
      <div class="meta">
        ${d.angle ? `<span class="angle">${esc(d.angle)}</span> ・ ` : ''}
        <span>#${d.id} ・ 素材：${esc(d.sourceSummary || '')}</span>${goalBadge(d.goal)}
        ${d.reviewNote ? `<div class="review">🛡 已改寫可能被抓語病的說法：${esc(d.reviewNote)}</div>` : ''}
        ${d.compliance ? `<div class="legal">⚖️ 法規風險，核准前請確認：${esc(d.compliance)}</div>` : ''}
      </div>
      <textarea maxlength="500">${esc(d.editedText || d.draftText)}</textarea>
      <div class="count"></div>
      <div class="sched">
        <input class="topic" placeholder="主題（選填，如：調酒）" maxlength="50" value="${esc(d.topic || '')}" title="${d.topic ? 'AI 建議的主題，可自行修改' : ''}" />
        ${aiAvailable ? '<button class="suggest-topic" title="讓 AI 依內容建議主題">🎯 建議</button>' : ''}
        <input class="when" type="datetime-local" title="排程時間（選填）" />
      </div>
      <div class="actions">
        <button class="primary approve">核准（可立即發）</button>
        <button class="schedule">排程</button>
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || (aiAvailable
      ? '<p>目前沒有待審草稿。按「產生草稿」，或用上方「自己寫一則」新增。</p>'
      : '<p>目前沒有待審草稿。用上方「自己寫一則」新增。</p>');
  updateCounts();
}

async function loadNativeApproved() {
  const drafts = await api('/api/native/drafts?status=approved');
  $('#napproved').innerHTML = drafts.map((d) => `
    <div class="card" data-id="${d.id}">
      <div class="meta">#${d.id} ・ ${d.scheduledAt ? '⏰ 排程 ' + esc(fmt(d.scheduledAt)) : '已核准'}${d.topic ? ' ・ 主題：' + esc(d.topic) : ''}${goalBadge(d.goal)}</div>
      <div class="content">${esc(d.editedText || d.draftText)}</div>
      ${d.compliance ? `<div class="legal">⚖️ 法規風險：${esc(d.compliance)}</div>` : ''}
      <div class="actions">
        <button class="danger publish">${d.scheduledAt ? '立即發布' : '發布'}</button>
        <button class="del" title="不想發了，直接刪掉">🗑 刪除</button>
      </div>
    </div>`).join('') || '<p>沒有待發布的貼文。核准後會出現在這裡。</p>';
}

function updateCounts() {
  document.querySelectorAll('#ndrafted .card').forEach((card) => {
    const ta = card.querySelector('textarea');
    const c = card.querySelector('.count');
    const n = [...ta.value].length;
    c.textContent = `${n}/500`;
    c.style.color = n > 500 ? '#b3261e' : '#999';
  });
}

$('#gen').addEventListener('click', async () => {
  $('#gen').disabled = true;
  $('#nstatus').textContent = '產生中…（AI 撰稿，可能數十秒）';
  try {
    const r = await api('/api/native/generate', { method: 'POST' });
    if (r.error) { $('#nstatus').textContent = '失敗：' + r.error; }
    else {
      const bits = [`熱搜 ${r.hotTrends}`, `新聞 ${r.newsTitles}`, `站內 ${r.tagPosts}`];
      bits.push(r.insightsAvailable ? `成效範本 ${r.topPosts}` : '成效範本 ✗');
      $('#nstatus').textContent = `產生 ${r.generated} 則（${bits.join('、')}；額度 ${r.quotaUsed7d}）`;
    }
    await loadNativeDrafted();
  } finally {
    $('#gen').disabled = false;
  }
});

// ── 手動撰寫一則（不需 AI）──
const manualText = $('#manualText');
manualText.addEventListener('input', () => {
  const n = [...manualText.value].length;
  const c = $('#manualCount');
  c.textContent = `${n}/500`;
  c.style.color = n > 500 ? '#b3261e' : '#999';
});
$('#manualAdd').addEventListener('click', async () => {
  const text = manualText.value.trim();
  if (!text) { alert('請先輸入貼文內容'); return; }
  if ([...text].length > 500) { alert('超過 500 字，請縮短'); return; }
  $('#manualAdd').disabled = true;
  try {
    const r = await api('/api/native/manual', { method: 'POST', body: JSON.stringify({ text }) });
    if (r.error) { alert(r.error); return; }
    manualText.value = '';
    $('#manualCount').textContent = '0/500';
    $('#mstatus').textContent = `已加入待審核 #${r.id}`;
    await loadNativeDrafted();
  } finally {
    $('#manualAdd').disabled = false;
  }
});

// ── ✨ 優化自己寫的貼文（只給建議，採不採用你決定）──
$('#polish').addEventListener('click', async () => {
  const text = manualText.value.trim();
  if (!text) { alert('先寫點東西再優化'); return; }
  const btn = $('#polish');
  btn.disabled = true;
  $('#mstatus').textContent = '優化中…（找鉤子＋蹭熱度＋紅隊審稿，可能數十秒）';
  try {
    const r = await api('/api/native/polish', { method: 'POST', body: JSON.stringify({ text }) });
    if (r.error) { $('#mstatus').textContent = '失敗：' + r.error; return; }
    if (!r.ok) { $('#mstatus').textContent = 'AI 沒能給出更好的版本，維持你的原稿'; return; }
    $('#mstatus').textContent = '';
    const box = $('#polishResult');
    box.style.display = '';
    box.className = 'polish';
    box.innerHTML = `
      <h4>✨ 優化後（採用前請自己看一遍）</h4>
      <div class="after">${esc(r.text)}</div>
      <ul>
        ${r.hook ? `<li><strong>鉤子</strong>：${esc(r.hook)}</li>` : ''}
        ${r.topic ? `<li><strong>建議主題</strong>：${esc(r.topic)}</li>` : ''}
        <li><strong>熱度</strong>：${r.trend ? esc(r.trend) : '沒有自然接得上的熱搜，沒硬蹭'}</li>
        ${(r.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}
        ${r.reviewNote ? `<li>🛡 ${esc(r.reviewNote)}</li>` : ''}
      </ul>
      <div class="actions">
        <button class="primary usePolish">採用這版</button>
        <button class="dropPolish">保留我的原稿</button>
      </div>`;
    box.querySelector('.usePolish').addEventListener('click', () => {
      manualText.value = r.text;
      manualText.dispatchEvent(new Event('input'));
      if (r.topic) $('#mstatus').textContent = `已採用。建議主題「${r.topic}」，核准時可填入。`;
      else $('#mstatus').textContent = '已採用。';
      box.style.display = 'none';
    });
    box.querySelector('.dropPolish').addEventListener('click', () => { box.style.display = 'none'; });
  } finally {
    btn.disabled = false;
  }
});

// ── 🔍 找熱門串（只給連結，留言你自己去 Threads 手動做）──
$('#hotSearch').addEventListener('click', async () => {
  const keyword = $('#hotKeyword').value.trim();
  if (!keyword) { alert('請輸入關鍵字'); return; }
  const btn = $('#hotSearch');
  btn.disabled = true;
  $('#hotStatus').textContent = '搜尋中…';
  try {
    const r = await api('/api/search/hot', { method: 'POST', body: JSON.stringify({ keyword }) });
    const box = $('#hotResults');
    if (r.error) { $('#hotStatus').textContent = '失敗：' + r.error; box.innerHTML = ''; return; }
    $('#hotStatus').textContent = `${r.results.length} 則・近7天額度 ${r.quotaUsed7d}`;
    if (r.quotaExhausted) {
      box.innerHTML = '<p>⚠️ keyword_search 近 7 天額度已用完，暫停搜尋以保護帳號額度。</p>';
      return;
    }
    if (!r.results.length) {
      box.innerHTML = r.devModeLikely
        ? '<p>只搜到你自己的貼文——這是 App 還在 <strong>Development 模式</strong>的典型徵狀。上 Live 後才搜得到別人的公開串。</p>'
        : '<p>沒搜到結果，換個關鍵字試試。</p>';
      return;
    }
    box.innerHTML = r.results.map((p, i) => `
      <div class="hot-item">
        <div class="who">
          ${i + 1}. @${esc(p.username || '?')}${p.timestamp ? ' ・ ' + esc(fmt(p.timestamp)) : ''}
          ${p.permalink ? ` ・ <a href="${esc(p.permalink)}" target="_blank" rel="noopener">開啟去留言 ↗</a>` : ''}
        </div>
        <div>${esc(p.text.slice(0, 160))}</div>
      </div>`).join('');
  } finally {
    btn.disabled = false;
  }
});
$('#hotKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#hotSearch').click(); });

$('#ndrafted').addEventListener('input', updateCounts);
$('#ndrafted').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  const topic = (card.querySelector('.topic')?.value || '').trim();
  if (e.target.classList.contains('suggest-topic')) {
    const btn = e.target;
    if (!text.trim()) { alert('先有內容才能建議主題'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '想主題中…';
    try {
      const r = await api('/api/native/suggest-topic', { method: 'POST', body: JSON.stringify({ text }) });
      if (r.error) { alert(r.error); return; }
      const input = card.querySelector('.topic');
      if (r.topic) { input.value = r.topic; input.title = 'AI 建議的主題，可自行修改'; }
      else alert('AI 想不到合適的主題，維持原樣');
    } finally { btn.disabled = false; btn.textContent = old; }
    return;
  }
  if (e.target.classList.contains('approve')) {
    if ([...text].length > 500) { alert('超過 500 字，請縮短再核准'); return; }
    await api(`/api/native/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    const r = await api(`/api/native/${id}/approve`, { method: 'POST', body: JSON.stringify({ topic }) });
    if (r.error) { alert(r.error); return; }
    card.remove();
    await loadNativeApproved();
  } else if (e.target.classList.contains('schedule')) {
    const when = card.querySelector('.when')?.value;
    if (!when) { alert('請先選一個排程時間'); return; }
    if ([...text].length > 500) { alert('超過 500 字，請縮短再排程'); return; }
    await api(`/api/native/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    const r = await api(`/api/native/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: when, topic }) });
    if (r.error) { alert(r.error); return; }
    card.remove();
    await loadNativeApproved();
  } else if (e.target.classList.contains('skip')) {
    await api(`/api/native/${id}/skip`, { method: 'POST' });
    card.remove();
  }
});

$('#napproved').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  // 🗑 刪除：核准之後才發現不想發，不用先發再刪。刪掉就沒了，所以要二次確認。
  if (e.target.classList.contains('del')) {
    if (!confirm('確定刪掉這則？刪掉就找不回來了。')) return;
    e.target.disabled = true;
    const r = await api(`/api/native/${card.dataset.id}`, { method: 'DELETE' });
    if (r.error) { $('#nstatus').textContent = '刪不掉：' + r.error; e.target.disabled = false; return; }
    $('#nstatus').textContent = `🗑 已刪除 #${card.dataset.id}`;
    card.remove();
    return;
  }
  if (!e.target.classList.contains('publish')) return;
  const id = card.dataset.id;
  if (!confirm('確定要發布這則到 Threads？（正式模式會真的公開送出）')) return;
  e.target.disabled = true;
  $('#nstatus').textContent = '發布中…（建立容器後約等 30 秒）';
  const r = await api(`/api/native/${id}/publish`, { method: 'POST' });
  if (r.error) { $('#nstatus').textContent = '發布失敗：' + r.error; e.target.disabled = false; return; }
  if (r.dryRun) { $('#nstatus').textContent = `🧪 DRY_RUN：未實際發布 #${id}`; }
  else { $('#nstatus').textContent = `✅ 已發布 #${id}（post ${r.id}）`; card.remove(); }
});

// ── 回覆審核（既有流程）──
async function loadAccounts() {
  const accounts = await api('/api/accounts');
  $('#account').innerHTML = accounts.map((a) => `<option>${esc(a.name)}</option>`).join('')
    || '<option value="">（無帳號設定）</option>';
}

async function loadQueue() {
  const account = $('#account').value;
  if (!account) { $('#queue').innerHTML = ''; return; }
  const posts = await api(`/api/posts?account=${encodeURIComponent(account)}&status=drafted`);
  $('#bulkBar').style.display = posts.length ? '' : 'none';
  $('#selectAll').checked = false;
  $('#queue').innerHTML = posts.map((p) => `
    <div class="card" data-id="${p.id}">
      <div class="meta">
        <label><input type="checkbox" class="pick" /> 選取</label> ・
        ${p.kind === 'inbox'
          ? '<span class="goal engage" title="別人在你自己貼文底下的留言">💬 我的留言區</span> ・'
          : `<span>相關性 ${p.relevanceScore == null ? '—' : Number(p.relevanceScore).toFixed(2)}</span> ・`}
        作者 ${esc(p.author || '（手動指定）')} ・ <a href="${esc(p.threadUrl)}" target="_blank">看原貼文 ↗</a>
      </div>
      <div class="content">${esc(p.content)}</div>
      ${p.compliance ? `<div class="legal">⚖️ 法規風險，核准前請確認：${esc(p.compliance)}</div>` : ''}
      <textarea>${esc(p.editedText || p.draftText || '')}</textarea>
      <div class="actions">
        <button class="primary approve">核准</button>
        ${aiAvailable ? '<button class="regen" title="太 AI／不夠有趣？換個角度重寫（會避開這一版）">🔄 重新生成</button>' : ''}
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || (liveMode
      ? '<p>目前沒有待審草稿。按「搜尋候選串」或「掃我的留言區」。</p>'
      : '<div class="hint">目前沒有待審草稿。<br><br>'
        + '💬 先按「<strong>掃我的留言區</strong>」——回自己貼文底下的留言<strong>現在就能用</strong>，'
        + '而且這些人已經對你有興趣。<br><br>'
        + '🔍「搜尋候選串」（主動去別人的熱門串留言）需要 App 上 Live：'
        + 'Development 模式下 keyword_search 只會回你自己的貼文（見 README「上 Live」）。</div>');
}

$('#queue').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  if (e.target.classList.contains('regen')) {
    const btn = e.target;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '重寫中…';
    try {
      const r = await api(`/api/posts/${id}/regenerate`, { method: 'POST' });
      if (r.error) { alert(r.error); return; }
      card.querySelector('textarea').value = r.draftText;
      const legal = card.querySelector('.legal');
      if (legal) legal.remove();
      if (r.compliance) {
        card.querySelector('.content').insertAdjacentHTML('afterend',
          `<div class="legal">⚖️ 法規風險，核准前請確認：${esc(r.compliance)}</div>`);
      }
    } finally { btn.disabled = false; btn.textContent = old; }
    return;
  }
  if (e.target.classList.contains('approve')) {
    if (!text.trim()) { alert('回覆內容不可為空'); return; }
    if ([...text].length > 500) { alert('回覆超過 500 字，請縮短'); return; }
    await api(`/api/posts/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    const r = await api(`/api/posts/${id}/approve`, { method: 'POST' });
    if (r.error) { alert(r.error); return; }
    card.remove();
  } else if (e.target.classList.contains('skip')) {
    await api(`/api/posts/${id}/skip`, { method: 'POST' });
    card.remove();
  }
});

$('#scrape').addEventListener('click', async () => {
  $('#scrape').disabled = true;
  $('#rstatus').textContent = '搜尋候選串中…（官方 API＋AI 產稿，可能數十秒）';
  try {
    const r = await api('/api/scrape', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
    $('#rstatus').textContent = r.error
      ? ('失敗：' + r.error)
      : `候選 ${r.candidates}、新增 ${r.inserted}、產草稿 ${r.drafted}、略過 ${r.skipped}`;
    await loadQueue();
  } finally {
    $('#scrape').disabled = false;
  }
});

$('#inboxScan').addEventListener('click', async () => {
  $('#inboxScan').disabled = true;
  $('#rstatus').textContent = '掃留言區中…（讀自己貼文的對話＋AI 產稿，可能數十秒）';
  try {
    const r = await api('/api/inbox/scan', { method: 'POST' });
    if (r.error) { $('#rstatus').textContent = '失敗：' + r.error; }
    else if (r.reason) { $('#rstatus').textContent = '略過：' + r.reason; }
    else {
      $('#rstatus').textContent = `掃了 ${r.posts} 則貼文，找到 ${r.found} 則還沒回的留言`
        + `（新增 ${r.inserted}、產草稿 ${r.drafted}${r.failed ? `、產稿失敗 ${r.failed}` : ''}）`;
    }
    await loadQueue();
  } finally {
    $('#inboxScan').disabled = false;
  }
});

$('#send').addEventListener('click', async () => {
  if (!confirm('確定要送出所有「已核准」的回覆？（正式模式會真的公開送出）')) return;
  $('#rstatus').textContent = '送出已核准中…';
  const r = await api('/api/send', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  if (r.error) { $('#rstatus').textContent = '失敗：' + r.error; return; }
  $('#rstatus').textContent = (r.dryRun ? '🧪 DRY_RUN ' : '') + `送出 ${r.sent}、略過 ${r.skipped}、失敗 ${r.failed}`;
  await loadQueue();
});

$('#account').addEventListener('change', loadQueue);

// ── 手動指定貼文回覆（仍須人工核准才送出）──
const manualReply = $('#manualReplyText');
manualReply.addEventListener('input', () => {
  const n = [...manualReply.value].length;
  const c = $('#manualReplyCount');
  c.textContent = `${n}/500`;
  c.style.color = n > 500 ? '#b3261e' : '#999';
});
$('#manualReplyAdd').addEventListener('click', async () => {
  const targetId = $('#manualTargetId').value.trim();
  const text = manualReply.value.trim();
  if (!targetId) { alert('請填入目標貼文的 media ID'); return; }
  if (!text) { alert('請填入回覆內容'); return; }
  $('#manualReplyAdd').disabled = true;
  try {
    const r = await api('/api/reply/manual', { method: 'POST', body: JSON.stringify({ targetId, text }) });
    if (r.error) { alert(r.error); return; }
    $('#manualTargetId').value = '';
    manualReply.value = '';
    $('#manualReplyCount').textContent = '0/500';
    $('#mrstatus').textContent = `已加入待審核 #${r.id}（核准後才會送出）`;
    await loadQueue();
  } finally {
    $('#manualReplyAdd').disabled = false;
  }
});

// ── 批次核准：一次核准勾選的多則（把每天的人工時間壓到一組點擊）──
$('#selectAll').addEventListener('change', () => {
  const on = $('#selectAll').checked;
  document.querySelectorAll('#queue .pick').forEach((cb) => { cb.checked = on; });
});
$('#approveSelected').addEventListener('click', async () => {
  const items = [];
  document.querySelectorAll('#queue .card').forEach((card) => {
    if (!card.querySelector('.pick')?.checked) return;
    items.push({ id: Number(card.dataset.id), editedText: card.querySelector('textarea').value });
  });
  if (!items.length) { alert('請先勾選要核准的回覆'); return; }
  if (!confirm(`確定核准 ${items.length} 則？（核准後仍需按「送出已核准」才會真的送出）`)) return;
  $('#approveSelected').disabled = true;
  try {
    const r = await api('/api/posts/approve-bulk', { method: 'POST', body: JSON.stringify({ items }) });
    if (r.error) { alert(r.error); return; }
    $('#bulkStatus').textContent = `已核准 ${r.approved} 則${r.skipped ? `、略過 ${r.skipped}` : ''}`;
    await loadQueue();
  } finally {
    $('#approveSelected').disabled = false;
  }
});

// ── 成效：自己哪幾則貼文真的有流量 ──
const metricRow = (m = {}) => {
  const spread = (m.reposts || 0) + (m.quotes || 0) + (m.shares || 0);
  return [
    `瀏覽 <b>${m.views || 0}</b>`,
    `讚 <b>${m.likes || 0}</b>`,
    `留言 <b>${m.replies || 0}</b>`,
    `轉發/引用 <b>${spread}</b>`,
  ].join('　·　');
};

async function loadInsights() {
  const box = $('#insightsList');
  box.innerHTML = '<p>讀取中…</p>';
  const r = await api('/api/insights/top');
  if (r.error) { box.innerHTML = `<p>讀取失敗：${esc(r.error)}</p>`; return; }
  if (!r.available) {
    box.innerHTML = `
      <div class="hint">
        <strong>讀不到成效數據。</strong>最常見的原因是 token 缺少
        <code>threads_manage_insights</code> 權限——到 Meta 開發者後台重新產一組
        （多勾這一項），再用「切換帳號」重新連接即可。<br>
        ${r.reason ? `<br><span class="status">API 回應：${esc(r.reason)}</span>` : ''}
      </div>`;
    return;
  }
  if (!r.top.length) { box.innerHTML = '<p>還沒有可排名的貼文。發幾則之後再回來看。</p>'; return; }
  box.innerHTML = r.top.map((p, i) => `
    <div class="card">
      <div class="meta">
        <span class="rank">#${i + 1}</span>
        ${p.timestamp ? esc(fmt(p.timestamp)) : ''}
        ${p.permalink ? ` ・ <a href="${esc(p.permalink)}" target="_blank" rel="noopener">看貼文</a>` : ''}
      </div>
      <div class="content">${esc(String(p.text).slice(0, 300))}</div>
      <div class="metrics">${metricRow(p.metrics)}</div>
    </div>`).join('');
}

$('#refreshInsights').addEventListener('click', async () => {
  const btn = $('#refreshInsights');
  btn.disabled = true;
  $('#istatus').textContent = '讀取中…（每則貼文一次 API 呼叫）';
  try { await loadInsights(); $('#istatus').textContent = ''; }
  finally { btn.disabled = false; }
});

// ── 切換帳號（一次一帳號：登出目前帳號 → 回設定精靈連下一個）──
$('#switchAccount').addEventListener('click', async () => {
  if (!confirm(
    '切換帳號會登出目前帳號（清除本機憑證），並回到設定精靈連接另一個帳號。\n\n'
    + '· 未送出的草稿與紀錄會留在本機資料庫。\n'
    + '· 但「已核准／已排程待發」的內容會退回草稿——避免用新帳號的身分自動發出。\n\n'
    + '確定切換？',
  )) return;
  const r = await api('/api/setup/disconnect', { method: 'POST' });
  if (r.error) { alert(r.error); return; }
  location.href = '/setup.html';
});

// ── 初始化 ──
(async () => {
  await loadConfig();
  await loadNativeDrafted();
  await loadNativeApproved();
  await loadAccounts();
  await loadQueue();
})();
