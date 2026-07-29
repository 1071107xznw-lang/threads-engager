# CLAUDE.md — Argo Threads 工具｜專案守則

Claude Code 每次進這個 repo 都會先讀這份。動工前**務必**先讀完整規格:
`docs/superpowers/specs/2026-07-21-argo-single-account-api-migration.md`。

---

## 這個專案是什麼

**單一品牌帳號**的 Threads 發文與互動輔助工具(通用版:每個使用者自架一份、
透過設定精靈連接**自己的**那一個帳號;最初為 BAR Argo 打造)。
走 **Meta 官方 Threads API**,**保留人工審核**。
它是一個舊專案(threads_engager,原為多帳號瀏覽器自動化)的重構版。

---

## 絕對規則(不可違反,不可為了「更自動」而繞過)

1. **對外回覆一律人工核准。**
   「回覆別人的公開貼文」這個動作**永遠不可以全自動送出**。流程必須是:
   自動搜尋 → 自動評分 → 自動產草稿 → 進審核佇列 → **人在 dashboard 按核准** →
   才送出。不准新增任何「跳過人工、直接送回覆」的路徑、旗標或排程。
   這是這個工具合規與否的分界線,也保護使用者的真實帳號不被 Meta 收掉。

2. **自動發布只限「使用者自己的、已人工核准的原生貼文」。**
   使用者寫好並核准的貼文,可依排程時間自動發布(等同一般排程工具)。
   除此之外沒有任何內容可以未經人工核准就對外發出。

3. **一實例一帳號;不做多帳號 / 分身 / 養號。**
   每一份部署只服務設定精靈連接的那**一個**帳號、由該帳號擁有者自己操作。
   **不得**做成一個後台同時操作多個帳號、或集中代管他人帳號(那是養號/濫用,
   也違反平台條款)。「通用工具」= 別人各自架一份用自己的帳號,不是多租戶後台。

4. **不用瀏覽器自動化。** 不引入 Playwright/puppeteer,不做指紋隔離、
   代理輪換、擬人延遲等任何「規避平台偵測」的手段。所有動作走官方 API。

5. **Secrets 絕不進 repo。** `THREADS_ACCESS_TOKEN`、`THREADS_APP_SECRET`、
   `THREADS_USER_ID` 一律走環境變數 / `.env`(且 `.env` 要在 `.gitignore`)。
   不得把 token、cookie、瀏覽器設定檔 commit 進版本庫。

6. **遵守官方額度。** keyword_search 每滾動 7 天 ≤ 500 次查詢;回覆有每日上限
   與同作者去重。設計成低頻批次,不得高頻打 API。

---

## 可全自動 vs 必須人工

| 動作 | 自動化程度 |
|---|---|
| 搜尋 tag / 抓候選貼文 | ✅ 全自動(可排程) |
| AI 評分、產回覆草稿 | ✅ 全自動 |
| 拉自己貼文的留言/mentions、拉數據 | ✅ 全自動 |
| token refresh | ✅ 全自動 |
| 發布 Argo 自己**已核准**的貼文(含排程) | ✅ 全自動 |
| **送出對別人貼文的回覆** | 🔴 **必須人工核准每一則** |
| 撰寫/核准原生貼文內容 | 🔴 由人決定 |

---

## 開發方式

- **分階段做**(見 spec 第 10 節):Phase 1 原生發文 → Phase 2 管理自己互動 →
  Phase 3 聆聽+外送回覆。不要一次全做完。
- **每階段流程**:開 branch → 實作 → 跑測試 → 給人看 diff → commit。
  每個 Phase 收尾一定要能獨立 commit / 可回滾。
- **高風險改動先用 Plan Mode**:凡動到 API 認證、發送/發布邏輯、額度控制、
  資料庫 schema,先出計畫給人核准,再改檔。
- **commit 訊息**用繁體中文,簡述做了什麼。
- 不確定就停下來問,不要自行擴大範圍。

---

## 架構(接手時的地圖,細節見 spec 第 3 節)

**保留:** `src/store.mjs`(SQLite 佇列+審核狀態機)、`src/ai.mjs`(評分+草稿)、
`src/server.mjs` + `public/`(審核 dashboard)。
**取代:** `src/scraper.mjs` → `src/threads_search.mjs`(官方 keyword_search);
`src/sender.mjs` 的發文段 → `src/threads_reply.mjs`(官方回覆端點)。
**新增:** `src/threads_publish.mjs`(發 Argo 原生貼文/排程)。
**刪除:** `profiles/`、Playwright 依賴、多帳號 config、`humanDelay`。

---

## 執行 / 測試

```bash
npm install
node src/server.mjs        # 啟動審核 dashboard: http://localhost:4321
npm test                   # 每階段收尾前務必綠燈
```

## 技術慣例

- Node.js,ESM(`.mjs`,`import`/`export`)。
- SQLite 用 `better-sqlite3`;HTTP 用 `express`。
- AI 草稿透過 `claude -p` 呼叫(見 `ai.mjs`)——僅用於**產草稿**,不得用來
  自動送出對外動作。
- 全程繁體中文(UI、草稿、註解、commit)。
