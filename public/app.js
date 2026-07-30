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

// ── 分頁切換 ──
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('section').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#' + t.dataset.tab).classList.add('active');
  });
});

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
        <span>#${d.id} ・ 素材：${esc(d.sourceSummary || '')}</span>
      </div>
      <textarea maxlength="500">${esc(d.editedText || d.draftText)}</textarea>
      <div class="count"></div>
      <div class="sched">
        <input class="topic" placeholder="主題（選填，如：調酒）" maxlength="50" value="${esc(d.topic || '')}" />
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
      <div class="meta">#${d.id} ・ ${d.scheduledAt ? '⏰ 排程 ' + esc(fmt(d.scheduledAt)) : '已核准'}${d.topic ? ' ・ 主題：' + esc(d.topic) : ''}</div>
      <div class="content">${esc(d.editedText || d.draftText)}</div>
      <div class="actions">
        <button class="danger publish">${d.scheduledAt ? '立即發布' : '發布'}</button>
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
    else { $('#nstatus').textContent = `產生 ${r.generated} 則（熱搜 ${r.hotTrends}、新聞 ${r.newsTitles}、站內 ${r.tagPosts}；額度 ${r.quotaUsed7d}）`; }
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

$('#ndrafted').addEventListener('input', updateCounts);
$('#ndrafted').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  const topic = (card.querySelector('.topic')?.value || '').trim();
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
  if (!e.target.classList.contains('publish')) return;
  const card = e.target.closest('.card');
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
        <span>相關性 ${p.relevanceScore == null ? '—' : Number(p.relevanceScore).toFixed(2)}</span> ・
        作者 ${esc(p.author || '（手動指定）')} ・ <a href="${esc(p.threadUrl)}" target="_blank">看原貼文 ↗</a>
      </div>
      <div class="content">${esc(p.content)}</div>
      <textarea>${esc(p.editedText || p.draftText || '')}</textarea>
      <div class="actions">
        <button class="primary approve">核准</button>
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || (liveMode
      ? '<p>目前沒有待審草稿。按「搜尋候選串」。</p>'
      : '<div class="hint">App 目前在 Development 模式，keyword_search 只會回你自己的貼文、搜不到別人的公開串。<br>把 App 送審上 Live 後即可運作（見 README「上 Live」）。</div>');
}

$('#queue').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  if (e.target.classList.contains('approve')) {
    await api(`/api/posts/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    await api(`/api/posts/${id}/approve`, { method: 'POST' });
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

// ── 切換帳號（一次一帳號：登出目前帳號 → 回設定精靈連下一個）──
$('#switchAccount').addEventListener('click', async () => {
  if (!confirm('切換帳號會登出目前帳號（清除本機憑證），並回到設定精靈連接另一個帳號。\n草稿與紀錄會留在本機資料庫。確定切換？')) return;
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
