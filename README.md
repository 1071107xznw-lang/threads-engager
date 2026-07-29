# Argo Threads 工具

單一品牌帳號（**BAR ARGO TAIPEI** / [@argotaipei](https://www.threads.com/@argotaipei)）的 Threads
發文與互動輔助工具。走 **Meta 官方 Threads API**、**全程保留人工審核**。

> 前身是多帳號 + 瀏覽器自動化的舊工具，已重構為單帳號、純官方 API 版。
> 動工前請先讀 [`CLAUDE.md`](CLAUDE.md)。

---

## 🚦 合規紅線（不可違反）

1. **對外回覆一律人工核准。** 自動只到「產草稿」；送出別人貼文的回覆，永遠要人在 dashboard 逐則按核准。
   程式裡沒有任何自動送出未核准內容的路徑。
2. **自動發布只限 Argo 自己、已人工核准的原生貼文。**
3. **不用瀏覽器自動化**（無 Playwright、無擬人延遲、無指紋/代理規避）。全走官方 API。
4. **Secrets 不進 repo**：`THREADS_*` 走 `.env`（已 gitignore），只 commit `.env.example`。
5. **遵守額度**：keyword_search 滾動 7 天 ≤ 500；回覆有每日上限與同作者去重。

`DRY_RUN=1` 時任何「對外送出/發布」都只記 log、不真的送。

---

## 快速開始

```bash
npm install
cp .env.example .env      # 填入你的三個憑證（見下）
```

`.env` 需要三個值（在 Meta App Dashboard 取得）：

| 變數 | 哪裡拿 |
|---|---|
| `THREADS_APP_SECRET` | App settings → Basic → App secret（32 碼） |
| `THREADS_ACCESS_TOKEN` | Use cases → Access the Threads API → User Token Generator（短期，1–2 小時） |
| `THREADS_USER_ID` | 用 `npm run exchange` 自動取得（見下） |

`DRY_RUN=1` 先保留，確認流程無誤再改 `0`。

### 換長期 token + 取得 user id

User Token Generator 給的是**短期** token（1–2 小時）。跑一次 exchange 換成 **60 天長期** token 並抓出 user id：

```bash
npm run exchange
```

它會印出 `THREADS_USER_ID`（填回 `.env`），並把長期 token 存進 `data.db`（程式優先使用，`.env` 的短期 token 留著沒關係）。

### 驗證 token（唯讀、安全）

```bash
npm run verify      # 印出帳號名稱 + 最近 5 篇貼文 → 代表 token 有效
```

---

## 指令總覽

| 指令 | 作用 | 對外動作？ |
|---|---|---|
| `npm run verify` | 唯讀驗證 token（讀 profile + 自己貼文） | 否 |
| `npm run exchange` | 短期→60天長期 token + 取 user id | 否（僅換發） |
| `npm run refresh-token` | 近到期才 refresh 長期 token（可交 cron 每日跑） | 否 |
| `npm run generate` | 抓趨勢→AI 產**原生貼文**草稿進佇列 | 否（只產草稿） |
| `npm run publish -- "內容"` | 發一則 Argo 原生貼文（受 DRY_RUN 保護） | **是**（發文） |
| `npm run dashboard` | 開審核台 http://localhost:4321 | 送出鈕才會 |
| `npm test` | 跑測試 | 否 |

---

## 兩條主要流程

### A. 原生貼文（Argo 自己發）

```
即時熱搜(Google Trends TW) + 主題新聞(RSS) + 自己近期貼文
      → AI 產 3 則草稿 → dashboard「原生貼文」分頁 → 你編輯/核准 → 【發布】
```

```bash
npm run generate            # 產草稿
npm run dashboard           # 審核 → 發布（DRY_RUN=1 為乾跑）
```

### B. 聆聽回覆（回別人的公開貼文）

```
keyword_search 找候選串(濾掉自己, 額度守門) → AI 評分+產有梗回覆草稿
      → dashboard「回覆審核」分頁 → 你逐則【核准】 → 【送出已核准】(官方回覆端點)
```

在 dashboard「回覆審核」分頁按「搜尋候選串」→ 審核 → 「送出已核准」。
**送出只讀 `approved`；未核准的永遠不送。** 每日上限 `replyDailyCap`、同作者 168 小時去重。

> ⚠️ 目前「搜尋候選串」在 Development 模式會是空的——見下方「上 Live」。

---

## ⭐ 讓功能真的運作：把 App 從 Development 切到 Live

Threads API 在 **Development（開發）模式**下有兩個限制，實測確認：

- `keyword_search` **只回你自己帳號的貼文**（撈不到別人的公開串）→ 所以「回覆別人」與「站內趨勢」在 Live 前無資料。
- App 只能對開發者/測試者帳號運作。

**原生發文（流程 A）在 Development 模式就能用**；**聆聽回覆（流程 B）與站內趨勢需要 Live。**

### 上 Live 步驟（在 [developers.facebook.com](https://developers.facebook.com) 你的 App）

1. **確認權限**：Use cases → Access the Threads API → Customize，加入並在 App Review 送審這些權限：
   - `threads_basic`（必備）
   - `threads_content_publish`（發文/回覆）
   - `threads_keyword_search`（搜尋別人的公開貼文）
   - `threads_manage_replies`（回覆管理，若用到）
2. **填 App Review**：每個進階權限要說明用途、附操作截圖/螢幕錄影，示範你**如何、為何**呼叫它
   （重點強調：搜尋→AI 產草稿→**人工審核**→才送出，符合平台政策）。
3. **補齊 App 基本資料**：隱私權政策 URL、App 圖示、類別等（Basic settings 沒填會擋審核）。
4. **送出審核**，通過後在 App Dashboard 把 App **切換為 Live 模式**。
5. Live 後：把 [`config/argo.json`](config/argo.json) 的 `useThreadsSearch` 改為 `true`（啟用站內趨勢），
   「回覆審核」的「搜尋候選串」也會開始撈到別人的公開串。

> 權限名稱與審核介面 Meta 常改，以 App Dashboard 當下顯示為準。

---

## 設定檔 `config/argo.json`

| 欄位 | 說明 |
|---|---|
| `persona` | 原生貼文的品牌口吻 |
| `tags` | 站內趨勢搜尋關鍵字（受眾興趣全譜，供 Live 後用） |
| `useThreadsSearch` | 是否啟用站內趨勢搜尋（Live 前建議 `false`，避免空搜耗額度） |
| `newsFeeds` / `hotTrendsFeeds` | 主題新聞 RSS / 即時熱搜（Google Trends TW） |
| `draftsPerRun` | 每次 `generate` 產幾則原生草稿 |
| `replyPersona` | 回覆別人的口吻（貼題、有梗、不推銷、≤120字） |
| `replyTags` | 回覆用的聚焦搜尋 tag（比 `tags` 精簡，省額度） |
| `replyThreshold` | 回覆相關性門檻，未過不產草稿 |
| `replyDailyCap` | 每日送出回覆上限 |
| `searchCap7d` | keyword_search 滾動 7 天上限（硬上限 500） |

改口吻/主題/上限只要編這個檔，不用動程式。

---

## Token 生命週期

- 長期 token 存於 `data.db`（`auth_token` 表），60 天效期。
- `npm run refresh-token`：token ≥24h 且剩餘 <10 天才換發，換得新的 60 天。建議交 cron 每日跑一次：
  ```bash
  0 4 * * *  cd /path/to/repo && npm run refresh-token >> refresh.log 2>&1
  ```
- 閒置 60 天會永久失效，屆時需重新 `npm run exchange`。

---

## 疑難排解

- **`claude -p 失敗… 401 OAuth access token has expired`**：AI 產草稿透過本機 `claude` CLI。
  請在**你自己的終端機**執行 `claude auth login` 後再跑 `npm run generate`
  （在別的 Claude Code session 內跑會繼承到過期 token）。
- **`generate`/「搜尋候選串」撈到 0 筆別人的貼文**：App 還在 Development 模式，見「上 Live」。
- **token 過期（`Session has expired`）**：短期 token 只活 1–2 小時，重新產一顆後盡快 `npm run exchange`。
- **缺環境變數**：`.env` 三個值沒填齊，照錯誤訊息補。

---

## 檔案結構

```
src/
  env.mjs            .env 載入 + 單帳號設定
  brand.mjs          config/argo.json 載入 + 預設
  threads_api.mjs    官方 API 低階 client（讀取/發文/回覆/token）
  threads_token.mjs  長期 token 交換/refresh/持久化
  threads_publish.mjs 發原生貼文（建容器→發布，DRY_RUN 保護）
  threads_reply.mjs  送已核准回覆（reply_to_id）+ 每日上限/去重
  threads_search.mjs keyword_search + 7 天額度守門
  trends.mjs         Google Trends 熱搜 + 新聞 RSS
  native_ai.mjs      原生貼文 AI 產稿（prompt/解析）
  native_generate.mjs 原生貼文生產線
  reply_pipeline.mjs 聆聽回覆生產線（搜候選→評分→產草稿）
  ai.mjs             claude -p runner + 回覆評分/產稿
  store.mjs          SQLite（貼文/草稿/token/額度）
  server.mjs         審核 dashboard + API
  *_cli.mjs          verify / publish / exchange / refresh / generate 進入點
public/              審核 dashboard 前端（原生貼文 / 回覆審核 兩分頁）
config/argo.json     品牌與流程設定（無 secrets）
```

---

## 技術慣例

Node.js ESM（`.mjs`）｜SQLite（`better-sqlite3`）｜HTTP（`express`）｜AI 草稿透過 `claude -p`（僅產草稿，不自動送出）｜全程繁體中文。
