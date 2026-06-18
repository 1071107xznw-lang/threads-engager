# Threads Engager — 設計規格

**日期**：2026-06-19
**狀態**：設計定案，待實作

## 1. 目的

多帳號、人工把關的 Threads 互動工具，用於**行銷曝光／養帳號**。
核心流程：抓 tag 貼文 → AI 評分＋產回覆草稿 → 使用者在本機 dashboard 審核 → 工具限流自動送出回文。

不做的事（明確排除，避免 scope 蔓延）：
- 不做自動發原創貼文（那是參考文章那個工具的功能，本工具專注「搜 tag 回文」）
- 不做排程／無人值守（第一版一律 on-demand 手動觸發）
- 不做 Threads 官方 API 整合（走瀏覽器自動化）

## 2. 需求摘要（brainstorming 結論）

| 維度 | 決定 |
|------|------|
| 核心目的 | 行銷曝光／養帳號 |
| 回文生成 | AI 生成草稿 + 使用者審核後送出（人工 gate） |
| 規模 | 多帳號 |
| 技術路線 | 路線 B：瀏覽器自動化（Playwright persistent profile） |
| 審核介面 | 本機網頁 dashboard |
| 拓文設定 | 每帳號各自的 tag 清單 + AI 相關性評分篩選 |
| AI 驅動 | `claude -p`（Claude Code headless CLI，用既有訂閱，免 API key） |
| 運作模式 | on-demand 手動觸發 |

## 3. 資料流

```
帳號設定(config) 
  → 抓取(scraper, Playwright) 
  → 候選貼文(store) 
  → AI 評分+草稿(ai, claude -p) 
  → dashboard 審核(server + UI) 
  → 送出(sender, Playwright, 限流) 
  → 標記已送(store)
```

## 4. 技術選型

- **Node.js + Playwright**：persistent context，每帳號一個 profile，沿用既有 beatit / 591 / weibo 工具鏈
- **本機 dashboard**：輕量 Express server + 單頁前端（原生 HTML/JS），不引入重前端框架
- **資料庫**：SQLite（`better-sqlite3`），唯一狀態來源
- **AI 層**：shell 呼叫 `claude -p "<prompt>" --output-format json`，解析結構化輸出取得 {分數, 草稿}
  - 抽象成可換介面（`ai.mjs`），日後要換成 Anthropic API 或 Gemini 只需改一個模組
  - ⚠️ 消耗 Claude Code 月額度；on-demand 模式讓使用者控制每次處理量

## 5. 模組切分（單一職責、可獨立測試）

| 模組 | 職責 | 輸入 → 輸出 |
|------|------|------------|
| `src/store.mjs` | SQLite 讀寫，唯一狀態來源 | — |
| `src/scraper.mjs` | 開帳號 profile、搜每個 tag、抓貼文、套基本篩選（時間/讚數/去重） | 帳號設定 → 候選貼文 |
| `src/ai.mjs` | 對每篇貼文評相關性分數；分數過門檻才生成該帳號口吻草稿 | 貼文+人設 → {分數, 草稿} |
| `src/sender.mjs` | 取已核准草稿，逐則導到貼文 URL 用 UI 回覆，隨機節奏＋每日上限 | 已核准草稿 → 送出並標記 |
| `src/server.mjs` | Express：審核 API ＋ 觸發抓取/送出 endpoint | — |
| `public/` | 單頁 dashboard：帳號切換、貼文+草稿卡片佇列、編輯/核准/跳過、「開始抓取」「送出已核准」按鈕 | — |

## 6. 帳號設定（`config/accounts.json`）

每帳號各自設定：
- `name`：帳號識別名
- `profilePath`：Playwright persistent profile 路徑
- `tags`：要搜尋的 tag/關鍵字清單
- `persona`：品牌口吻／人設（餵給 AI 生成草稿）
- `filters`：`{ recencyHours, minLikes }` 基本篩選
- `relevanceThreshold`：相關性分數門檻（低於不產草稿）
- `dailyCap`：每日回覆上限（預設保守，建議 10–15）
- `enabled`：是否啟用

## 7. 資料模型（SQLite）

- `posts`：`id, account, threadUrl, author, content, likes, postedAt, relevanceScore, status, discoveredAt`
  - `status`：`new` → `drafted` → `approved` → `sent` / `skipped` / `failed`
- `drafts`：`postId, draftText, editedText, updatedAt`
- 去重鍵：`threadUrl`（同貼文不重抓）；另記 `author` 供「同作者短期不重複回」判斷

## 8. 運作模式：on-demand

1. 使用者開 dashboard
2. 按「開始抓取」（單帳號或全部）→ scraper 抓候選貼文
3. AI 自動評分；過門檻者產草稿，進審核佇列
4. 使用者逐張審核：可編輯草稿、核准、或跳過
5. 按「送出已核准」→ sender 以限流節奏逐則送出
6. store 標記已送

排程／無人值守為未來可選，本版不做（YAGNI）。

## 9. 養帳號風險控制（成敗關鍵）

- 每帳號**每日回覆上限**（`dailyCap`，預設保守）
- 送出之間**隨機擬人延遲**（如 30–120 秒），不爆衝
- **去重**：同貼文/同作者短期內不重複回
- **人工審核 gate**（核心機制）
- 每帳號獨立 profile，session 與指紋隔離

> 風險聲明：多帳號自動回文成長是 Meta 明確打擊的行為，即使有人工審核仍有封號/限流風險。此為使用者已知並接受的取捨。

## 10. 錯誤處理

- **登入過期** → dashboard 顯示「需重新登入」，開 headed 瀏覽器讓使用者手動登入該 profile（沿用 beatit 模式）
- **選擇器失效（UI 改版）** → 記 log、跳過該則、在 dashboard 標示
- **送出失敗** → 標記 `failed`，供手動重試
- **dry-run 模式** → 只抓不送；sender 只記錄預計動作不真的點擊，用來驗證流程與選擇器

## 11. 測試策略

- **單元測試**（mock 外部依賴）：相關性評分解析、草稿生成、篩選邏輯、去重邏輯、store CRUD
- **AI 層**：mock `claude -p` 子行程，驗證 prompt 組裝與輸出解析
- **scraper / sender**：選擇器靠 dry-run + dashboard 人工驗證（live UI 難自動測）

## 12. 專案結構

```
threads_engager/
├── package.json
├── config/accounts.json        # 多帳號設定
├── src/
│   ├── store.mjs               # SQLite 存取
│   ├── scraper.mjs             # Playwright 抓 tag 貼文
│   ├── ai.mjs                  # claude -p 評分 + 草稿生成
│   ├── sender.mjs              # Playwright 送出（限流/節奏）
│   └── server.mjs              # Express dashboard + API
├── public/                     # dashboard 前端
│   ├── index.html
│   └── app.js
├── profiles/                   # 每帳號一個 Playwright persistent profile
├── data.db                     # SQLite
└── docs/superpowers/specs/     # 本規格文件
```
