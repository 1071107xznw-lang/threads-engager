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
//
// 會整塊拿掉 HTML/Markdown 註解 <!-- ... -->，包含跨行的。
// ⚠️ 這裡一定要處理跨行：範本檔開頭就是一段多行註解（給店家看的填寫說明），
//    若只濾「開頭是 <!-- 的那一行」，說明文字與收尾的 --> 會整包漏進 prompt，
//    AI 會把「請改成你們真實的做法」之類的句子當成品牌事實在讀。
export function loadKnowledge(path, { maxChars = 4000 } = {}) {
  if (!path) return '';
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '') // 完整註解區塊（含跨行）
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      // 未收尾的註解殘骸：孤立的 <!-- 開頭行、或孤立的 -->
      return !t.startsWith('<!--') && t !== '-->';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}
