import { readFileSync } from 'node:fs';

// 品牌知識庫：由店家自己寫下「我們敢背書的事實」（自家做法、店內資訊、專業判斷）。
//
// 用途：AI 只能用肯定句陳述這裡有的事實；這裡沒有的一律不准當權威事實斷言，
// 必須改成「我們的做法是…／我自己偏好…」這種站得住的說法。
// 這比上網查更可靠——內容是店家親自驗證、願意用招牌擔保的。

export function resolveKnowledgePath(dir, existsSync) {
  const own = `${dir}/knowledge.md`;
  return existsSync(own) ? own : null;
}

// 讀知識庫純文字。沒有檔案就回空字串（產稿仍可運作，只是更保守）。
// 會去掉 Markdown 註解行（以 <!-- 開頭）與空行過多的情況。
export function loadKnowledge(path, { maxChars = 4000 } = {}) {
  if (!path) return '';
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  const cleaned = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}
