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

> 想分享給別人？把這個 repo 給他，他 `npm install && npm start`、在精靈連自己的帳號即可——**一人一套、各用各的帳號**（詳見 [`docs/friend-setup.md`](docs/friend-setup.md)）。

> 📱 **手機/遠端存取**：在 `.env` 設 `DASHBOARD_PASSWORD` 加登入密碼，再走區網 IP 或 Tailscale 連進來——步驟見 [`docs/remote-access.md`](docs/remote-access.md)。埠衝突可設 `PORT`。

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
即時熱搜(Google Trends TW) + 主題新聞(RSS) + 自己近期貼文(語氣樣本)
      + 📊 自家成效前幾名(什麼有效) + 品牌知識庫 + 搜尋字
    → AI 產草稿(觸及／互動／品牌分工) → 🛡 紅隊審稿
    → dashboard「原生貼文」分頁 → 你編輯/核准 → 【發布】
```

```bash
npm run generate            # 產草稿
npm run dashboard           # 審核 → 發布（DRY_RUN=1 為乾跑）
```

### 讓草稿像人寫的、而且不會被抓語病

三層設計，目標是「**一樣敢講、但戰不倒**」——不是把話講軟：

1. **語氣人化**：抓你自己最近 15 則貼文當語氣範本（句型、用字、emoji 與斷行習慣），
   並套用 Threads 上真正有效的寫法：第一行就是鉤子、短句多斷行、有觀點、結尾留話讓人回、
   不放連結。明文禁止 AI 腔（罐頭金句、「在這個◯◯的時代」、萬用形容詞）與商業腔
   （推銷、「立即預約」式 CTA）——每批最多 1 則可自然帶到店，且店是背景不是主角。

2. **品牌知識庫** `config/knowledge.md`（複製 [`config/knowledge.example.md`](config/knowledge.example.md) 開始）：
   寫下**你們敢背書的事實**（自家做法、店內資訊、專業判斷）。
   **AI 只能用肯定句陳述這裡有的事實**；沒寫的一律不准當權威斷言，得改成「我們的做法是…」。
   這比上網查更可靠——內容是你們親自驗證、願意用招牌擔保的。

3. **🛡 紅隊審稿**：每則草稿再讓 AI 扮演「最愛抓語病的知識型網友」挑一遍，
   找出會被戰的斷言（爭議說法當唯一正解、需要專業的事實、過度概括），改寫成站得住的說法。
   **硬規則：改寫後不准比原本更無聊、更軟弱**，也不准用「可能／因人而異」和稀泥。
   被改寫的草稿會在 dashboard 卡片標示 `🛡 已改寫…`，讓你知道動了哪裡。

實際效果：

| | |
|---|---|
| ❌ 太 AI、會被戰 | 「紅酒就是要常溫喝」 |
| ❌ 改怕了（我們不要這種） | 「紅酒溫度因人而異，建議依個人喜好調整」 |
| ✅ 這個設計產出的 | 「台灣的『常溫』對紅酒根本太熱。我們夏天輕一點的紅酒都會先冰過——不服的先喝過再來吵」 |

> 上面那句「先冰過」之所以敢講，是因為它**寫在知識庫裡**。知識庫沒有的細節（幾分鐘、幾度、
> 幾點開門、價格）AI 一律不准編——這條規則救過一次：初版知識庫留了幾條 `(待確認)` 的
> placeholder，AI 照樣當事實用，產出的回覆對著懂酒的留言者斷言了一個沒人確認過的做法。
> 所以：**寧可留空，不要放沒確認的假設**。

> `config/knowledge.md` 已被 gitignore（是你的店家內容，不會進版本庫）。內容愈具體，AI 愈敢講、也愈不會出包。

### 📊 成長期：最新的顧語氣，冠軍的顧寫法

只學「最近」的貼文，等於每次都在複製自己的平均值，流量池永遠放大不了。
所以產稿前會先讀**自己貼文的實際成效**，把表現最好的幾則餵給 AI 當「什麼有效」的實證。

**兩份範本同時進 prompt，分工不同**（會明文告訴 AI 衝突時聽誰的）：

| 範本 | 負責 | 學什麼 |
|---|---|---|
| 最近 15 則 | **現在的語氣與方向** | 用字、句長、emoji 與斷行習慣、現在在講什麼題材 |
| 成效前 5 名 | **什麼寫法有效** | 鉤子怎麼下、結構、要不要丟問題 |

> 衝突時：**語氣聽最近的，寫法聽成效好的**。冠軍貼文會帶日期，日期較舊的只借寫法——
> 不准把舊主題、舊活動、舊檔期搬回來。

- **排名邏輯**：留言 > 轉發／引用 > 讚 ≫ 瀏覽。瀏覽權重刻意壓到很低——
  互動率通常只有幾 %，瀏覽數量級大得多，權重給高就會蓋掉互動訊號，
  變成「5000 瀏覽 2 個讚」贏過「800 瀏覽 30 則留言」。但觸及是結果不是原因，那種貼文不值得模仿。
- **AI 拿它做什麼**：歸納「為什麼有人看」——鉤子怎麼下、挑什麼主題、寫多長、有沒有丟問題，
  然後把新稿往那些方向靠。明文要求**不是照抄內容或主題**。
- **在哪裡看**：dashboard「成效」分頁列出排名與數字，你也能直接判斷什麼有效。
- **需要權限**：token 要有 `threads_manage_insights`。**沒有也不會壞**——
  自動略過這個訊號、照常產稿，dashboard 會提示你怎麼補。

**每批草稿的分工**（`goalMix`）：成長期不該三則都在講自己的店，所以每批依序分工——

| 分工 | 目的 | 寫法 |
|---|---|---|
| 🚀 `reach` 觸及型 | 讓還沒追蹤你的人看到 | 蹭當下熱搜，不提店也沒關係 |
| 💬 `engage` 互動型 | 衝留言數（演算法吃互動） | 丟一個超好回答的問題：二選一、幫我決定 |
| 🏠 `brand` 品牌型 | 建立記憶點 | 專業或店裡日常，有畫面、有內行細節 |

**搜尋字訊號**（`localSearchTerms` + `tags`）：顧客實際用什麼字找到你。
從 Google 商家檔案「成效 → 搜尋字詞」抄過來即可（成長期資料少很正常，留空也能跑，
會回落用 `tags`）。AI 只會自然帶上 1～2 個字眼，明文禁止寫成 SEO 文。

### ✨ 優化「你自己寫的」貼文

自己寫的稿，在「自己寫一則」框裡按 **✨ 優化這則**。它會：

- **找鉤子**——第一行決定別人展不展開，改成一句就想看下去的話
- **緊縮 + 去 AI 腔**——砍廢話與萬用形容詞，短句多斷行
- **結尾留互動**——換成一個很好回答的問題（二選一、幫我決定）
- **自然搭上熱度**——只有**接得上才接**；接不上會明講「沒硬蹭」
- **建議主題**，並過一次 🛡 紅隊審稿

跟從零產稿最大的差別：**這是你的文**。所以第一條規則是保留你的原意、資訊與立場，
只把它變得更容易被看到；也**不准替你補上知識庫沒有的營業細節**（時間、價格、人名、分鐘數）。

結果是「前後對照 + 改了什麼」，你按【採用這版】或【保留我的原稿】。AI 失敗一律原稿原樣退回，
不會弄丟你寫的東西。

**主題（topic_tag）**：dashboard 每張草稿卡片可填一個「主題」（1–50 字、不可含 `.` 或 `&`），
發布時貼文會歸到該 Threads 話題下。選填。

**排程發佈**：卡片可設「排程時間」後按「排程」（等於核准 + 指定時間）。時間到會自動發布**已核准**的貼文
（仍是人工先核准，符合 CLAUDE.md 規則 2）。兩種觸發：

- **開著 dashboard**：內建排程器每分鐘檢查、自動發到期的貼文。
- **關著也要發**：交給 cron 每分鐘跑一次（`DRY_RUN` 開啟時只會 log 不發）：
  ```bash
  * * * * *  cd /path/to/repo && npm run publish-due >> publish-due.log 2>&1
  ```

### B. 回覆別人（兩個來源，同一個審核佇列）

```
💬 我的留言區：自己貼文的 conversation → 挑出「別人留的、我還沒回的」
🔍 主動留言　：keyword_search 找候選串(濾掉自己, 額度守門) → AI 評分
                          ↓
        AI 產回覆草稿 → dashboard「回覆審核」分頁 → 你逐則【核准】
                          ↓
              【送出已核准】(官方回覆端點 reply_to_id)
```

#### 💬 我的留言區（Development 模式就能用 ← 先做這個）

按「**掃我的留言區**」：抓自己近 20 則貼文的整串對話，用 `replied_to` 精準判斷
**哪些留言你還沒回**，逐則產回覆草稿進審核佇列。

回自家留言的 prompt 跟主動留言完全不同——**你是主人**，所以：
具體回應對方講的那個點（罐頭「謝謝支持」直接算失敗）；被糾正或被挑語病時
**不道歉式退讓、也不硬碰硬**，改用知識庫裡「我們的做法」守住立場；對方開玩笑就接梗。

> 為什麼優先做這個：主動去熱門串留言需要 App 上 Live，但留言區今天就能用，
> 而且這些人已經對你有興趣。回覆還會拉高該則的**對話深度**，演算法會再推一次。

#### 🔍 主動留言（需 App 上 Live）

在 dashboard「回覆審核」分頁按「搜尋候選串」→ 審核 →「送出已核准」。

**送出只讀 `approved`；未核准的永遠不送。** 兩種來源的送出限制不同：

| | 每日上限 | 同作者去重 |
|---|---|---|
| 💬 留言區（回自家客人） | `inboxDailyCap`（20） | ❌ 不套用——同一人留兩則本來就該回兩則 |
| 🔍 主動留言（去別人串下） | `replyDailyCap`（8） | ✅ 168 小時 |

> 那些限制是為了「不要看起來像騷擾機器人」。回自己貼文底下的留言是主人的常態行為，
> 套同一套限制反而會擋住該回的話。

#### 🔍 找熱門串（自己去留言）

「回覆審核」分頁輸入關鍵字 → 整理出 Threads 上的公開串連結，**你自己點進去手動留言**。
這裡不做任何自動留言，純粹是一份可點的清單。

⚠️ 兩個誠實的限制：

1. **拿不到觀看次數。** Threads API 的 insights 只能讀**自己**的貼文；別人的貼文沒有公開的
   觀看/按讚數。所以無法真的照觀看數排序——這裡用 Threads 自己的熱門排序（`search_type=TOP`），
   不足 20 則才補時間序（`RECENT`）。
2. **Development 模式下只會回你自己的貼文**，等於沒資料。搜出來全是自己的時會直接提示你這點。
   要上 Live 才有用。

每次搜尋最多打 2 次 API，一樣走 `keyword_search` 的 7 天額度守門（湊滿 20 則就不打第二次）。

**指定貼文回覆**：不想等搜尋，可在「回覆審核」分頁貼上對方貼文的 **media ID**（純數字，不是網址）
＋寫好回覆 →「加入待審核」。它一樣進審核佇列，**核准後才會送出**。

**批次核准**：待審核清單可勾選 + 「全選」→「核准所選」，一次核准一整批（編輯過的內容會一起存）。
核准後仍需按「送出已核准」才真的送出。

> ⚠️ 目前「搜尋候選串」在 Development 模式會是空的（keyword_search 只回你自己的貼文）——
> 見下方「上 Live」。**「掃我的留言區」不受影響，現在就能用。**

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

> **不會重複發文**：`publish-due` cron 與 dashboard 內建排程器共用同一個 DB，發布前會**原子認領**
> （approved → publishing），同一則只會有一方發出，兩者同時開著也安全。發布失敗的排程貼文轉為
> `failed`（記錄 error），**不會自動重試**，避免逾時誤判造成重複發送——失敗的請到 dashboard 手動處理。

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

- 未送出的草稿與紀錄**留在本機資料庫**，只清憑證。
- **每個帳號記住自己的風格**：persona、tags、主題、回覆語氣等品牌設定會以帳號 id 為鍵
  存在本機 DB。切走時自動快照、切回同一帳號時自動還原（不必重設），且會跳過品牌設定步驟。
  不同帳號各有各的風格，互不覆蓋。
- 但**已核准／已排程待發**的內容會退回草稿——避免用新帳號的身分自動發出上一個帳號核准的東西。
- 切換後 **DRY_RUN 自動回到乾跑**，避免對新帳號誤發。
- 切換後不會再回落 `.env` 的舊憑證（否則舊帳號會被復活）。
  若你是走 `.env` 進階路線，重跑 `npm run exchange` 會解除這個抑制、重新連上。
- 執行中的 server 會**即時**改用新帳號憑證（每次操作重讀 DB），不需重啟。

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
   - `threads_manage_insights`（讀**自己**貼文的成效，供「成效」分頁與產稿範本用）
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
| `tags` | 站內趨勢搜尋關鍵字（受眾興趣全譜，供 Live 後用；同時當產稿的搜尋字訊號） |
| `useThreadsSearch` | 是否啟用站內趨勢搜尋（Live 前建議 `false`，避免空搜耗額度） |
| `useInsights` | 是否讀自家貼文成效當產稿範本（預設 `true`；缺權限會自動略過） |
| `localSearchTerms` | 顧客實際用什麼字找到你（Google 商家檔案「搜尋字詞」抄過來；可留空） |
| `goalMix` | 每批草稿的分工循環，預設 `["reach","engage","brand"]` |
| `newsFeeds` / `hotTrendsFeeds` | 主題新聞 RSS / 即時熱搜（Google Trends TW） |
| `draftsPerRun` | 每次 `generate` 產幾則原生草稿 |
| `replyPersona` | 回覆別人的口吻（貼題、有梗、不推銷、≤120字） |
| `replyTags` | 回覆用的聚焦搜尋 tag（比 `tags` 精簡，省額度） |
| `replyThreshold` | 回覆相關性門檻，未過不產草稿 |
| `replyDailyCap` | 每日「主動去別人串下留言」上限 |
| `inboxDailyCap` / `inboxPerRun` | 💬 留言區：每日送出上限 / 一輪最多產幾則草稿 |
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
  insights.mjs       自家貼文成效（解析/加權排名，缺權限 fail-open）
  polish.mjs         ✨ 優化自己寫的貼文（鉤子/緊縮/蹭熱度/建議主題）
  hotthreads.mjs     🔍 關鍵字找熱門串連結（走額度守門）
  knowledge.mjs      品牌知識庫載入（config/knowledge.md）
  native_ai.mjs      原生貼文 AI 產稿（prompt/解析/分工/紅隊審稿）
  native_generate.mjs 原生貼文生產線
  reply_pipeline.mjs 主動留言生產線（搜候選→評分→產草稿）
  inbox.mjs         💬 留言區（自家貼文底下未回的留言→產草稿）
  ai.mjs             claude -p runner + 回覆評分/產稿
  store.mjs          SQLite（貼文/草稿/token/額度）
  server.mjs         審核 dashboard + API
  *_cli.mjs          verify / publish / exchange / refresh / generate 進入點
public/              審核 dashboard 前端（原生貼文 / 回覆審核 / 成效 三分頁）
config/argo.json     品牌與流程設定（無 secrets）
```

---

## 技術慣例

Node.js ESM（`.mjs`）｜SQLite（`better-sqlite3`）｜HTTP（`express`）｜AI 草稿透過 `claude -p`（僅產草稿，不自動送出）｜全程繁體中文。
