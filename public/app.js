const $ = (s) => document.querySelector(s);
const status = (t) => { $('#status').textContent = t; };

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

async function loadAccounts() {
  const accounts = await api('/api/accounts');
  $('#account').innerHTML = accounts.map((a) => `<option>${a.name}</option>`).join('');
}

async function loadQueue() {
  const account = $('#account').value;
  const posts = await api(`/api/posts?account=${encodeURIComponent(account)}&status=drafted`);
  $('#queue').innerHTML = posts.map((p) => `
    <div class="card" data-id="${p.id}">
      <div class="meta">
        <span class="score">相關性 ${Number(p.relevanceScore).toFixed(2)}</span>
        作者 ${p.author} ・ <a href="${p.threadUrl}" target="_blank">看原貼文 ↗</a>
      </div>
      <div class="content">${p.content}</div>
      <textarea>${p.editedText || p.draftText || ''}</textarea>
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
  status('抓取中…（會開瀏覽器）');
  const r = await api('/api/scrape', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  status(`抓到 ${r.found}、保留 ${r.kept}、新增 ${r.inserted}`);
  await loadQueue();
});

$('#send').addEventListener('click', async () => {
  status('送出中…（限流節奏，請稍候）');
  const r = await api('/api/send', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  status(`送出 ${r.sent}、略過 ${r.skipped}、失敗 ${r.failed}`);
});

$('#account').addEventListener('change', loadQueue);
(async () => { await loadAccounts(); await loadQueue(); })();
