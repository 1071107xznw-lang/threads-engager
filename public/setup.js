const $ = (s) => document.querySelector(s);

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function show(step) {
  document.querySelectorAll('section').forEach((s) => s.classList.remove('active'));
  $('#step' + step).classList.add('active');
  [1, 2, 3].forEach((n) => {
    const el = $('#s' + n);
    el.style.color = n === step ? '#1c1c1e' : '#999';
    el.style.fontWeight = n === step ? '700' : '400';
  });
}

$('#go2').addEventListener('click', () => show(2));

$('#connect').addEventListener('click', async () => {
  const appSecret = $('#appSecret').value.trim();
  const accessToken = $('#accessToken').value.trim();
  const msg = $('#msg2');
  if (!appSecret || !accessToken) { msg.className = 'msg err'; msg.textContent = '兩個欄位都要填。'; return; }
  $('#connect').disabled = true;
  msg.className = 'msg'; msg.textContent = '連接中…（換發長期 token、讀取帳號）';
  const r = await api('/api/setup/connect', { appSecret, accessToken });
  $('#connect').disabled = false;
  if (r.error) { msg.className = 'msg err'; msg.textContent = '失敗：' + r.error; return; }
  // 這個帳號之前設定過風格 → 已自動還原，直接進內容中心，不用重設。
  if (r.brandExists) {
    msg.className = 'msg ok';
    msg.textContent = `✅ 已連接 @${r.username}，並還原這個帳號先前的風格設定，前往內容中心…`;
    setTimeout(() => { location.href = '/'; }, 900);
    return;
  }
  $('#connected').textContent = `✅ 已連接 @${r.username}（${r.name || ''}）`;
  $('#brandName').value = r.name || '';
  show(3);
});

$('#finish').addEventListener('click', async () => {
  const msg = $('#msg3');
  const brandName = $('#brandName').value.trim();
  if (!brandName) { msg.className = 'msg err'; msg.textContent = '請填品牌名稱。'; return; }
  const tags = $('#tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  const brand = {
    brandName,
    persona: $('#persona').value.trim() || undefined,
    tags,
    replyTags: tags,
    replyPersona: $('#replyPersona').value.trim() || undefined,
    replyDailyCap: Number($('#replyDailyCap').value) || 8,
  };
  $('#finish').disabled = true;
  msg.className = 'msg'; msg.textContent = '儲存中…';
  const r = await api('/api/setup/brand', brand);
  if (r.error) { $('#finish').disabled = false; msg.className = 'msg err'; msg.textContent = '失敗：' + r.error; return; }
  msg.className = 'msg ok'; msg.textContent = '完成！前往內容中心…';
  location.href = '/';
});

show(1);
