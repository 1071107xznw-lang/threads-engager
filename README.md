# Threads 內容中心（單帳號工具）

**單一品牌帳號**的 Threads 發文與互動輔助工具——每個人自架一份、連接**自己的**帳號即可用。
走 **Meta 官方 Threads API**、**全程保留人工審核**。（最初為 BAR ARGO TAIPEI 打造。）

> 前身是多帳號 + 瀏覽器自動化的舊工具，已重構為「一實例一帳號、純官方 API」版。
> 動工前請先讀 [`CLAUDE.md`](CLAUDE.md)。**不是**多帳號後台/養號工具。

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

## 快速開始（推薦：設定精靈）

```bash
npm install
npm start          # 開 http://localhost:4321
```

第一次啟動、還沒設定時會自動導向**設定精靈**，網頁上兩步完成、不用碰終端機或編設定檔：

1. **前置**：你要有自己的 Meta App（拿到 App Secret + 短期 Access Token；精靈頁面有步驟連結）。
2. **連接帳號**：貼上 App Secret + 短期 token → 系統自動換成 60 天長期 token、抓出你的帳號。
3. **品牌設定**：填品牌名、人設、關鍵字、回覆口吻 → 完成即進內容中心。

憑證只存在**你這台電腦**的 `data.db`（已 gitignore），不會上傳、不進 repo。設定完就能用「原生貼文」分頁產稿、審核、發布（預設 `DRY_RUN` 乾跑，狀態列可一鍵切正式）。

> 想分享給別人？把這個 repo 給他，他 `npm install && npm start`、在精靈連自己的帳號即可——**一人一套、各用各的帳號**。

### 進階：用 `.env`（不透過精靈）

也可手動建 `.env`（`cp .env.example .env`）填 `THREADS_APP_SECRET`／`THREADS_ACCESS_TOKEN`，再 `npm run exchange` 換長期 token + 取 `THREADS_USER_ID`，`npm run verify` 驗證。精靈與 `.env` 兩種方式並存（憑證解析：DB → `.env`）。

---

## 指令總覽

| 指令 | 作用 | 對外動作？ |
|---|---|---|
| `npm run verify` | 唯讀驗證 token（讀 profile + 自己貼文） | 否 |
| `npm run exchange` | 短期→60天長期 token + 取 user id | 否（僅換發） |
| `npm run refresh-token` | 近到期才 refresh 長期 token（可交 cron 每日跑） | 否 |
| `npm run publish-due` | 發布到期的排程原生貼文（可交 cron 每分鐘跑） | **是**（發文） |
| `npm run generate` | 抓趨勢→AI 產**原生貼文**草稿進佇列 | 否（只產草稿） |
| `npm run draft-cron` | 搜候選串→AI 評分→產**回覆**草稿進審核佇列（可交 cron 每 6 小時跑） | 否（只產草稿） |
| `npm run publish -- "內容"` | 發一則自己的原生貼文（受 DRY_RUN 保護） | **是**（發文） |
| `npm start` | 開內容中心／設定精靈 http://localhost:4321 | 送出鈕才會 |
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

**主題（topic_tag）**：dashboard 每張草稿卡片可填一個「主題」（1–50 字、不可含 `.` 或 `&`），
發布時貼文會歸到該 Threads 話題下。選填。

**排程發佈**：卡片可設「排程時間」後按「排程」（等於核准 + 指定時間）。時間到會自動發布**已核准**的貼文
（仍是人工先核准，符合 CLAUDE.md 規則 2）。兩種觸發：

- **開著 dashboard**：內建排程器每分鐘檢查、自動發到期的貼文。
- **關著也要發**：交給 cron 每分鐘跑一次（`DRY_RUN` 開啟時只會 log 不發）：
  ```bash
  * * * * *  cd /path/to/repo && npm run publish-due >> publish-due.log 2>&1
  ```

### B. 聆聽回覆（回別人的公開貼文）

```
keyword_search 找候選串(濾掉自己, 額度守門) → AI 評分+產有梗回覆草稿
      → dashboard「回覆審核」分頁 → 你逐則【核准】 → 【送出已核准】(官方回覆端點)
```

在 dashboard「回覆審核」分頁按「搜尋候選串」→ 審核 → 「送出已核准」。
**送出只讀 `approved`；未核准的永遠不送。** 每日上限 `replyDailyCap`、同作者 168 小時去重。

**指定貼文回覆**：不想等搜尋，可在「回覆審核」分頁貼上對方貼文的 **media ID**（純數字，不是網址）
＋寫好回覆 →「加入待審核」。它一樣進審核佇列，**核准後才會送出**。

**批次核准**：待審核清單可勾選 + 「全選」→「核准所選」，一次核准一整批（編輯過的內容會一起存）。
核准後仍需按「送出已核准」才真的送出。

> ⚠️ 目前「搜尋候選串」在 Development 模式會是空的——見下方「上 Live」。

---

## 🌙 無人值守自動化（睡覺時也在跑）

能全自動的、與**必須人工**的界線：

| 動作 | 自動化 |
|---|---|
| 排程發布**你已核准**的原生貼文 | ✅ 全自動（cron / dashboard） |
| 搜候選串 → AI 評分 → 產回覆草稿 | ✅ 全自動（cron） |
| token 續期、額度守門與退避 | ✅ 全自動 |
| **送出對別人貼文的回覆** | 🔴 **每則都要人工核准**（規則 1，無例外、無旗標） |

建議的 cron 組合（夜間堆草稿，早上批次核准）：

```bash
# 每分鐘：發到期的排程原生貼文
* * * * *  cd /path/to/repo && npm run publish-due >> publish-due.log 2>&1
# 每 6 小時：搜尋+評分+產回覆草稿（需 claude CLI 已登入）
0 */6 * * *  cd /path/to/repo && npm run draft-cron >> draft-cron.log 2>&1
```

隔天早上打開 dashboard →「回覆審核」→ 掃一眼 → 全選 → 核准所選 → 送出已核准。

### 額度感知與退避（把官方額度用好，不撞頂）

- **自適應配額**：依近 7 天 `keyword_search` 剩餘額度，把額度平均攤給預期輪次
  （`runsPer7d`，預設 28 = 每 6 小時一輪）。用得快 → 自動搜更少；剩很多 → 多搜一些。
- **保留比例**：預設保留 10% 額度給白天手動操作（`searchReserveRatio`）。
- **額度不足**：整輪直接跳過並記 log，不會硬搜到撞上限。
- **指數退避**：限流（429）／伺服器錯誤（5xx）自動退避重試；4xx 不重試。
  ⚠️ **只用於唯讀呼叫**——送出/發布**不做自動重試**，避免容器重建造成重複發送。

> 這些處理的是官方**公開的 rate limit**（吞吐上限），不是任何規避偵測的手段。

---

## 🔄 切換帳號（一次一個帳號）

dashboard 右上「切換帳號」→ 清除本機憑證 → 回設定精靈連下一個帳號。

- 草稿與紀錄**留在本機資料庫**，只清憑證。
- 切換後 **DRY_RUN 自動回到乾跑**，避免對新帳號誤發。
- 切換後不會再回落 `.env` 的舊憑證（否則舊帳號會被復活）。

> 這是「登出 A 再連 B」，**不是**多帳號後台。本工具一份部署只服務一個帳號（CLAUDE.md 規則 3）。

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
