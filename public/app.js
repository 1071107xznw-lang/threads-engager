const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

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

// ── DRY_RUN 標示 ──
async function loadConfig() {
  const { dryRun } = await api('/api/config');
  const el = $('#dryrun');
  el.textContent = dryRun ? 'DRY_RUN 乾跑中（不會真的發文）' : '正式模式（發布會真的送出）';
  el.className = dryRun ? 'on' : 'off';
}

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
      <div class="actions">
        <button class="primary approve">核准</button>
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || '<p>目前沒有待審草稿。按「產生草稿」。</p>';
  updateCounts();
}

async function loadNativeApproved() {
  const drafts = await api('/api/native/drafts?status=approved');
  $('#napproved').innerHTML = drafts.map((d) => `
    <div class="card" data-id="${d.id}">
      <div class="meta">#${d.id} ・ 已核准</div>
      <div class="content">${esc(d.editedText || d.draftText)}</div>
      <div class="actions">
        <button class="danger publish">發布</button>
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
    else { $('#nstatus').textContent = `產生 ${r.generated} 則（站內 ${r.tagPosts}、新聞 ${r.newsTitles}；額度 ${r.quotaUsed7d}）`; }
    await loadNativeDrafted();
  } finally {
    $('#gen').disabled = false;
  }
});

$('#ndrafted').addEventListener('input', updateCounts);
$('#ndrafted').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  if (e.target.classList.contains('approve')) {
    if ([...text].length > 500) { alert('超過 500 字，請縮短再核准'); return; }
    await api(`/api/native/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    await api(`/api/native/${id}/approve`, { method: 'POST' });
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
  $('#queue').innerHTML = posts.map((p) => `
    <div class="card" data-id="${p.id}">
      <div class="meta">
        <span>相關性 ${Number(p.relevanceScore).toFixed(2)}</span> ・
        作者 ${esc(p.author)} ・ <a href="${esc(p.threadUrl)}" target="_blank">看原貼文 ↗</a>
      </div>
      <div class="content">${esc(p.content)}</div>
      <textarea>${esc(p.editedText || p.draftText || '')}</textarea>
      <div class="actions">
        <button class="primary approve">核准</button>
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || '<p>目前沒有待審草稿。按「開始抓取」。</p>';
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
  $('#rstatus').textContent = '抓取中…';
  const r = await api('/api/scrape', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  $('#rstatus').textContent = r.error ? ('失敗：' + r.error) : `抓到 ${r.found}、保留 ${r.kept}、新增 ${r.inserted}`;
  await loadQueue();
});

$('#send').addEventListener('click', async () => {
  $('#rstatus').textContent = '送出中…';
  const r = await api('/api/send', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  $('#rstatus').textContent = r.error ? ('失敗：' + r.error) : `送出 ${r.sent}、略過 ${r.skipped}、失敗 ${r.failed}`;
});

$('#account').addEventListener('change', loadQueue);

// ── 初始化 ──
(async () => {
  await loadConfig();
  await loadNativeDrafted();
  await loadNativeApproved();
  await loadAccounts();
  await loadQueue();
})();
