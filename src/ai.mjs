import { spawn, spawnSync } from 'node:child_process';
import { PERSONAL_VOICE_RULES } from './brand.mjs';
import { voiceSamplesBlock } from './voice.mjs';

// 偵測本機是否有可用的 `claude` CLI（AI 產稿唯一的外部相依）。
// 偵測結果快取一次，避免每次 /api/config 都 spawn。傳 force=true 可重驗。
let _claudeAvailable = null;
export function isClaudeAvailable(force = false) {
  if (_claudeAvailable !== null && !force) return _claudeAvailable;
  try {
    const r = spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 4000 });
    _claudeAvailable = !r.error && r.status === 0;
  } catch {
    _claudeAvailable = false;
  }
  return _claudeAvailable;
}

// 判斷 claude CLI 的錯誤是不是「登入失效」。
// 這類錯誤跟一般失敗要分開處理：使用者要做的是重新登入，不是改內容或重試。
export function isAuthFailure(message) {
  return /Failed to authenticate|OAuth|401|token has been revoked|not logged in|Invalid API key|please run .?claude/i
    .test(String(message ?? ''));
}

export function buildPrompt(post, persona, { avoid = [], voiceSamples = [] } = {}) {
  const avoidBlock = avoid.length ? [
    '',
    '## 🔄 這是重新生成——前面的版本使用者不滿意',
    ...avoid.slice(0, 3).map((t, i) => `✗ 第 ${i + 1} 版：${String(t).slice(0, 200)}`),
    '',
    '通常代表太 AI、太乖、太無聊。**換一個完全不同的切入角度**，不是換句話說。',
    '可以換：接不同的點、換情緒（吐槽↔共鳴↔自嘲）、換長度、改成反問。',
  ] : [];
  const voice = voiceSamplesBlock(voiceSamples);
  return [
    `人設：${persona}`,
    '',
    ...(voice ? [voice, ''] : []),
    '以下是一則 Threads 貼文，請你：',
    '1. 評估這則貼文與上述人設/主題的相關性，給 0 到 1 的分數（score）。',
    '2. 以人設的口吻寫一則繁體中文回覆草稿（draft），針對貼文內容、自然、有價值、不推銷。',
    '',
    `貼文作者：${post.author}`,
    `貼文讚數：${post.likes}`,
    `貼文內容：${post.content}`,
    ...avoidBlock,
    '',
    PERSONAL_VOICE_RULES,
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
    // ⚠️ 一定要先收集 Buffer、最後才一次 toString('utf8')。
    // 若用 out += chunk，每個 chunk 會各自解碼；中文（3 bytes）與 emoji（4 bytes）
    // 只要被切在 chunk 邊界，兩半就會各自變成 U+FFFD（�）——產出的貼文裡會出現壞字元。
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => { outChunks.push(d); });
    child.stderr.on('data', (d) => { errChunks.push(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(outChunks).toString('utf8');
      const err = Buffer.concat(errChunks).toString('utf8');
      if (code === 0) { resolve(out); return; }
      const detail = err.trim() || out.trim() || '無輸出';
      // 登入失效跟一般錯誤要分開講：`claude --version` 在 token 被撤銷時仍會成功，
      // 所以偵測不到，只有真的呼叫才會爆。訊息要直接告訴使用者怎麼修。
      const e = new Error(
        isAuthFailure(detail)
          ? `claude CLI 需要重新登入（token 已失效）。在終端機執行 \`claude\` 登入後再試一次。\n原始錯誤：${detail}`
          : `claude -p 失敗（exit ${code}）：${detail}`
      );
      if (isAuthFailure(detail)) e.authError = true;
      reject(e);
    });
  });
}

export async function scoreAndDraft({
  post, persona, threshold, avoid = [], voiceSamples = [], runner = defaultRunner,
}) {
  const raw = await runner(buildPrompt(post, persona, { avoid, voiceSamples }));
  const { score, draft } = parseResult(raw);
  return { score, draft: score >= threshold ? draft : null };
}
