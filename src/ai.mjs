import { spawn } from 'node:child_process';

export function buildPrompt(post, persona) {
  return [
    `人設：${persona}`,
    '',
    '以下是一則 Threads 貼文，請你：',
    '1. 評估這則貼文與上述人設/主題的相關性，給 0 到 1 的分數（score）。',
    '2. 以人設的口吻寫一則繁體中文回覆草稿（draft），針對貼文內容、自然、有價值、不推銷。',
    '',
    `貼文作者：${post.author}`,
    `貼文讚數：${post.likes}`,
    `貼文內容：${post.content}`,
    '',
    '只輸出一個 JSON 物件，格式：{"score": 數字, "draft": "字串"}，不要其他文字。',
  ].join('\n');
}

export function parseResult(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 輸出找不到 JSON');
  const obj = JSON.parse(raw.slice(start, end + 1));
  if (typeof obj.score !== 'number' || typeof obj.draft !== 'string') {
    throw new Error('AI 輸出 JSON 缺 score 或 draft');
  }
  return { score: obj.score, draft: obj.draft };
}

export function defaultRunner(prompt) {
  return new Promise((resolve, reject) => {
    // stdin 設 ignore：避免 claude -p 等待標準輸入而卡住。
    const child = spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`claude -p 失敗（exit ${code}）：${err.trim() || out.trim() || '無輸出'}`));
    });
  });
}

export async function scoreAndDraft({ post, persona, threshold, runner = defaultRunner }) {
  const raw = await runner(buildPrompt(post, persona));
  const { score, draft } = parseResult(raw);
  return { score, draft: score >= threshold ? draft : null };
}
