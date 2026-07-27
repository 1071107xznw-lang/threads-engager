import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { scrapeAccount } from './scraper.mjs';
import { sendReplies } from './sender.mjs';
import { scoreAndDraft } from './ai.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer({ store, accounts, runScrape, runSend }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  app.get('/api/accounts', (req, res) => res.json(accounts.map((a) => ({ name: a.name }))));

  app.get('/api/posts', (req, res) => {
    const { account, status = 'drafted' } = req.query;
    res.json(store.listByStatus(account, status));
  });

  app.post('/api/scrape', async (req, res) => {
    try { res.json(await runScrape(req.body.account)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post('/api/send', async (req, res) => {
    try { res.json(await runSend(req.body.account)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post('/api/posts/:id/draft', (req, res) => {
    store.editDraft(Number(req.params.id), req.body.editedText);
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/approve', (req, res) => {
    store.setStatus(Number(req.params.id), 'approved');
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/skip', (req, res) => {
    store.setStatus(Number(req.params.id), 'skipped');
    res.json({ ok: true });
  });

  return app;
}

// 直接啟動時：組裝真實依賴並監聽
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accounts = loadConfig(join(__dirname, '..', 'config', 'accounts.json'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  const byName = (name) => accounts.find((a) => a.name === name);

  const runScrape = async (name) => {
    const account = byName(name);
    const result = await scrapeAccount(account, { store });
    // 對新抓進來的貼文做 AI 評分與草稿
    for (const row of store.listByStatus(name, 'new')) {
      const r = await scoreAndDraft({
        post: { author: row.author, content: row.content, likes: row.likes },
        persona: account.persona,
        threshold: account.relevanceThreshold,
      });
      store.setRelevance(row.id, r.score);
      if (r.draft) store.saveDraft(row.id, r.draft);
      else store.setStatus(row.id, 'skipped');
    }
    return result;
  };
  const runSend = async (name) => sendReplies(byName(name), { store });

  const app = createServer({ store, accounts, runScrape, runSend });
  app.listen(4321, () => console.log('Dashboard: http://localhost:4321'));
}
