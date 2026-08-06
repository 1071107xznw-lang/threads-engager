# App Review 送審說明書（可直接複製貼上）

送審是文件工作,不是技術工作。審核官不會讀你的程式碼——他們看三樣東西:
**用途說明寫得夠不夠具體**、**錄影有沒有拍到人工核准那一步**、**隱私權政策打不打得開**。

這份文件把三樣都備好了。英文段落請**原文貼上**(Meta 審核以英文進行)。

---

## 第 0 步:先過硬擋條件

| 項目 | 狀態 | 怎麼處理 |
|---|---|---|
| 隱私權政策 URL | ✅ **已上線** | 見下方，直接複製 |
| Token 有效 | ✅ 實測 `@argotaipei` 通過 | 到期 2026-09-26，錄影前不會過期 |
| 權限實際可呼叫 | ✅ 逐一實測 200 | 見第 1 步 |
| App 圖示 / 顯示名稱 / 類別 | 待你填 | Basic settings,類別選 **Business** |
| 商家/開發者驗證 | Meta 若要求才需要 | 依畫面指示 |

> 🔑 **`.env` 裡的 `THREADS_ACCESS_TOKEN` 已於 2026-07-28 過期**，但工具用的是 DB 裡自動續期後的那顆
> （`getActiveToken` 優先讀 DB），所以功能正常。`.env` 那顆只有在**切換帳號清空 DB 之後**才會被拿來用——
> 真的要切帳號時記得先更新它，否則會拿到一顆死 token。
>
> 順帶一提：Meta 對過期 token 回的是 `{"code":1,"message":"An unknown error occurred"}`，
> **真正的原因藏在 `www-authenticate` 標頭裡**。之後遇到莫名其妙的 500，先看那個標頭。

### 隱私權政策 ✅ 已上線

GitHub Pages 已啟用（`main` / `/docs`），實測 HTTP 200：

```
https://1071107xznw-lang.github.io/threads-engager/privacy-policy
```

**把這個網址貼進 App 的 Basic settings → Privacy Policy URL。**

政策本文在 [`privacy-policy.md`](privacy-policy.md)；改那個檔推上 `main`，網站會自動重建。

> ⚠️ 審核官一定會點這個連結。送出前自己用**無痕視窗**再開一次確認。

---

## 第 1 步:送哪些權限

**只送你真的會用的**。要了用不到的權限是常見退件原因。

以下是**實測確認**這個工具會呼叫的:

| 權限 | 實際呼叫 | 送? |
|---|---|---|
| `threads_basic` | `GET /{user-id}`、`GET /{user-id}/threads` | ✅ 必送 |
| `threads_content_publish` | `POST /{user-id}/threads` + `/threads_publish`(發文與回覆共用) | ✅ 必送 |
| `threads_keyword_search` | `GET /keyword_search` | ✅ 必送(這是你要解鎖的) |
| `threads_manage_insights` | `GET /{media-id}/insights` | ✅ 必送(實測 200) |
| `threads_read_replies` | `GET /{media-id}/conversation`、`GET /{uid}/replies`（**讀**） | ✅ 必送 |
| `threads_manage_replies` | 代表帳號**建立回覆** | ✅ 必送 |

> 📌 **為什麼 replies 要送兩個**：Meta 官方對這兩個權限的定義是分開的——
> `threads_read_replies` 是「取得應用程式用戶擁有之串文的**回覆**」（唯讀）；
> `threads_manage_replies` 是「代表 Threads 個人檔案**建立回覆**、隱藏或取消隱藏回覆，
> 以及控制誰可以回覆」。
>
> 💬 留言區**同時做了兩件事**：讀（找出還沒回的留言）與寫（送出回覆），所以兩個都要。
> 本工具**從不隱藏、從不取消隱藏、從不改動任何人的留言**——這點在用途說明裡要講清楚，
> 免得審核官以為你要動別人的內容。
>
> ⚠️ 早期版本的本文件只列 `threads_manage_replies`，理由是實測 `/conversation` 回 200。
> 但當時的 token **兩個權限都有**，那個測試分辨不出是哪一個在授權——結論下得太快。
> 以 App Dashboard 上每個權限點進去的官方說明為準。

> ⚠️ **你的 token 實際帶了 11 個權限，但工具只用上面這 6 個。**
> 用 `debug_token` 撈出來的完整清單還包含：`threads_manage_mentions`、
> `threads_delete`、`threads_location_tagging`、`threads_profile_discovery`、`threads_share_to_instagram`。
> **這 5 個一個都不要送審**——「要求了用不到的權限」是常見退件原因。
> （`threads_read_replies` 原本也在這串裡，已改列為必送，理由見上表下方的說明。）
>
> 附帶一個重要觀念：token **有** `threads_manage_mentions`，但 `/me/mentions` 仍然回
> 「Application does not have permission」。**權限在 token 上 ≠ App 有進階存取權**；
> 後者一定要送審。同理，`keyword_search` 現在能呼叫但只回自己的貼文，也是同一道牆。

> ✅ **五個都實測過了**（2026-08-04，用 DB 裡的有效 token 逐一打）：
> `/me` 200、`/{uid}/threads` 200 3 筆、`/insights` 200 3 個指標、`/conversation` 200、`keyword_search` 200 25 筆。
> `threads_manage_replies` 先前不確定有沒有勾選——**已確認可用，一定要送**，
> 漏送的話上 Live 之後「💬 留言區」會整個壞掉。

---

## 第 2 步:每個權限的用途說明(英文,直接貼)

每一段都做了同一件事:**先講這個 App 是什麼 → 這個權限具體呼叫哪個端點 → 為什麼非要不可 → 使用者怎麼受益**。

### 共用開場(若表單有「App 整體用途」欄位)

> Threads Engager is an open-source, self-hosted content assistant for a **single** Threads
> account owner. The owner installs it on their own computer and connects their own account.
> It helps them draft posts and replies, and requires the owner to **approve every outbound
> item individually** in a local review dashboard before anything is sent. There is no hosted
> service, no multi-account management, and no browser automation or scraping — every action
> goes through the official Threads API. The tool is used by the account owner, for their own
> account, only.

### `threads_basic`

> We use `threads_basic` to read the connected owner's own profile
> (`GET /{threads-user-id}?fields=id,username`) and their own recent posts
> (`GET /{threads-user-id}/threads`).
>
> Two things depend on it. First, we must know the owner's own username so we can **exclude
> their own content** from reply candidates — without it the tool would suggest replying to
> the owner's own posts. Second, the owner's recent posts are used as writing-style samples so
> generated drafts sound like the same person rather than generic AI text.
>
> We read only the connected account's own data. No other user's profile is accessed.

### `threads_content_publish`

> We use `threads_content_publish` for the only two outbound actions in the product, both
> using the standard two-step container flow (`POST /{threads-user-id}/threads` followed by
> `POST /{threads-user-id}/threads_publish`):
>
> 1. Publishing the owner's **own** original posts, optionally with a `topic_tag`.
> 2. Sending replies, using `reply_to_id` on the reply container.
>
> **Every send requires explicit human approval.** Drafts are written to a local queue with
> status `drafted`. The send routine reads only items with status `approved`, which a human
> sets by clicking "核准 / Approve" on that specific item in the dashboard. There is no code
> path that sends unapproved content — this is enforced in the codebase and covered by
> automated tests.
>
> Scheduled publishing applies **only** to the owner's own posts that the owner has already
> approved; it is a scheduling convenience, not autonomous posting. Replies are never
> scheduled. A `DRY_RUN` mode lets the owner rehearse the whole flow without sending anything.
>
> Volume is deliberately low: a per-day cap on replies, and a de-duplication rule that
> prevents replying to the same author twice within 168 hours.

### `threads_keyword_search`

> We use `GET /keyword_search` to find recent **public** posts on topics relevant to the
> owner's business (for a bar: cocktails, local dining, esports viewing nights), so the owner
> can join those public conversations.
>
> The results are never sent to automatically. For each candidate we generate a relevance
> score and a suggested reply, then place it in a review queue. The owner reads the original
> post, edits or rewrites the suggested reply, and approves it one item at a time. Anything
> not approved is never sent.
>
> We respect the published limit of 500 queries per rolling 7-day period. The tool logs every
> query in a local table and **refuses to issue a query that would exceed the cap** — it also
> reserves a percentage of the quota and adaptively lowers its own query rate as the quota is
> consumed, rather than running until it is blocked. Retries use exponential backoff and apply
> to read-only calls only.
>
> Search results are used for one purpose — helping the owner decide what to reply to. We do
> not build profiles of other users, do not store search results beyond the review queue, and
> do not redistribute the content.

### `threads_manage_insights`

> We use `GET /{threads-media-id}/insights` (metrics: `views`, `likes`, `replies`, `reposts`,
> `quotes`, `shares`) to read performance data for the connected owner's **own** posts only.
>
> Two uses, both for the owner:
>
> 1. A "performance" screen in the local dashboard ranks the owner's own posts so they can see
>    which of their posts actually resonated.
> 2. The top-performing posts are used as examples when drafting new content, so suggestions
>    are informed by what has actually worked for this account rather than by generic
>    assumptions.
>
> We never request insights for any account other than the connected owner's own. If the
> permission is not granted, the feature degrades silently and the rest of the product
> continues to work.

### `threads_read_replies`

> We use `threads_read_replies` for the two **read-only** calls that power the replies inbox:
>
> 1. `GET /{threads-media-id}/conversation` (with the `replied_to` field) — reads the public
>    replies left on the connected owner's **own** posts, so we can determine which replies the
>    owner has **not yet answered**.
> 2. `GET /{threads-user-id}/replies` — reads the owner's **own** past replies. These are used
>    only as writing-style samples, so that suggested responses sound like the same person
>    rather than generic AI text. Posts and replies are written in different registers, so
>    samples taken from the owner's replies produce far more natural suggestions than samples
>    taken from their posts.
>
> Both calls read only content belonging to the connected owner: replies left on their own
> posts, and replies they themselves wrote. We do not read conversations on other accounts'
> media. Nothing is sent as a result of these calls — they only populate a local review queue
> that a human must approve from, item by item.

### `threads_manage_replies`

> We use `threads_manage_replies` for one thing only: **creating a reply on behalf of the
> connected owner's own profile**, using `reply_to_id` on the reply container
> (`POST /{threads-user-id}/threads` followed by `POST /{threads-user-id}/threads_publish`).
>
> This is ordinary community management — the account owner answering people who commented on
> their own posts. Every reply is written to a local queue with status `drafted`, and is sent
> only after a human clicks "核准 / Approve" on that specific item in the review dashboard.
> There is no code path that sends an unapproved reply.
>
> **We never hide or unhide replies, never delete anyone's content, and never change who is
> allowed to reply.** The product has no user interface for any of those actions and the
> `manage_reply` endpoint is not called anywhere in the source. The only write this permission
> is used for is publishing the owner's own approved reply.

---

## 第 3 步:錄影腳本(審核最看重這段)

**一段影片就夠,60–90 秒,不用配音**,但畫面上必須清楚出現「人在按核准」。
用 macOS `⌘⇧5` 錄螢幕即可。

> 🔴 **最關鍵的一點**:核准按鈕被按下的那一刻,以及按下前後清單狀態的變化,
> 必須在同一鏡頭內連續拍到。剪掉那一刻 = 審核官看不到人工把關 = 退件。

> ⛔️ **不要用「🔍 搜尋候選串」當主軸拍。** App 還在 Development 模式，`keyword_search`
> **只會回你自己的貼文**（2026-08-04 實測：25 筆結果、別人的 0 筆）。照舊腳本拍出來，
> 畫面上會是「這個工具在回覆自己的貼文」——審核官看了只會更困惑。
>
> 改用 **💬 掃我的留言區**：那裡是**真的其他使用者**留在你貼文底下的留言，今天就拍得出來，
> 而且同一段影片就把 `threads_basic` + `threads_manage_replies` + `threads_content_publish`
> 三個權限一次演完。

### 分鏡（主片，60–90 秒）

| # | 秒數 | 畫面 | 必須看得到 |
|---|---|---|---|
| 1 | 0–8 | 開 dashboard 首頁 | 三個分頁、狀態列顯示**正式模式** |
| 2 | 8–22 | 「回覆審核」分頁,按 **💬 掃我的留言區** | 清單長出來,每則都是**別人的帳號名稱**留的言 |
| 3 | 22–35 | 停在一張卡片上 | 你的原貼文 + **對方的留言** + **AI 草擬的回覆** |
| 4 | 35–45 | **在草稿框裡改幾個字** | 人真的在編輯,不是照送 |
| 5 | 45–55 | 🔴 **按「核准」** | 按鈕被按下、該則從待審清單消失、**其他則還留著沒動** |
| 6 | 55–70 | 按「送出已核准」,確認對話框跳出 → 按確定 | 「送出 N、略過 M」的結果訊息 |
| 7 | 70–85 | 切到 Threads 看那則回覆真的出現在留言串裡 | 送出的內容 = 你剛核准的內容 |

第 5 格是整支影片的重點。**其他則沒被送出**這件事要看得到——那證明的是「逐則決定」，
不是「按一個鍵全發」。

### 分鏡（補充片，20–30 秒，證明另外兩個權限）

| # | 畫面 | 對應權限 |
|---|---|---|
| 8 | 「成效」分頁,自家貼文依互動排名 | `threads_manage_insights` |
| 9 | 按 **🔍 搜尋候選串**,畫面出現結果清單與額度計數 | `threads_keyword_search` |

第 9 格照拍沒關係，**但不要宣稱那是別人的貼文**。在送審表單的說明欄照實寫：

> The keyword search screen is shown, but because the app is still in Development mode the
> API returns only the owner's own posts. The screen demonstrates the query flow, the 500-per-
> 7-days quota counter, and the review queue that every result must pass through before any
> reply can be sent. The approval mechanism is identical to the one demonstrated in the main
> recording.

老實講這件事**不會**扣分——審核官很清楚 Development 模式的限制；假裝有拍到才會出事。

### 錄影前務必（照順序做一遍）

1. **待審佇列現在是空的**（0 則 drafted）→ 先按 💬 掃我的留言區補幾則進去，
   **至少 3 則**，才看得出是有選擇地核准。
2. 確認狀態列是**正式模式**（DRY_RUN 已關 ✅）——影片要證明真的送得出去。
3. 視窗調大、字體看得清楚。
4. 🔒 把 `.env`、token、密碼欄位、Tailscale IP 全部避開鏡頭。
   用 `localhost:4321` 開，不要用 `100.88.137.107`。

---

## 第 4 步:截圖清單

| 截圖 | 拍什麼 | 用意 |
|---|---|---|
| 1 | 「回覆審核」分頁全貌,清單有 2–3 則待審 | 證明有審核佇列這個關卡 |
| 2 | 單張卡片放大:原貼文 + 草稿 + 核准/跳過按鈕 | 證明每則都要個別決定 |
| 3 | 狀態列 DRY_RUN 標示 | 證明有安全的乾跑模式 |
| 4 | 「成效」分頁 | 對應 `threads_manage_insights` |
| 5 | 「💬 掃我的留言區」結果 | 對應 `threads_manage_replies` |

---

## 第 5 步:審核官要的測試步驟

表單通常會問「how can we test this」。這個 App 是自架的、審核官沒辦法登入你的機器,
所以要老實講清楚:

> This is a self-hosted, open-source tool. It is not a hosted service, so there is no login
> for reviewers to use — each user runs it on their own machine against their own account.
> The full source code, including the review-and-approval logic, is public at
> <https://github.com/1071107xznw-lang/threads-engager>.
>
> The attached screen recording demonstrates the complete flow end to end on a real account:
> searching for public posts, an AI-suggested reply being generated, the human editing it,
> the human clicking Approve on that specific item, and only then the reply being sent and
> appearing on Threads.
>
> To verify the approval requirement in the source: replies are sent only by
> `sendApprovedReplies()` in `src/threads_reply.mjs`, which reads exclusively from items whose
> status is `approved`; status is set to `approved` only by the dashboard endpoint that a
> human clicks. Automated tests cover this behaviour.
>
> One note on the recording: the app is still in Development mode, so `keyword_search`
> currently returns only the owner's own posts. The main recording therefore demonstrates the
> approval flow using the replies inbox, where the content shown is genuinely from other
> users — people who replied to the owner's posts. The keyword search screen is shown
> separately to demonstrate the query and quota-guard flow. Both paths feed the same review
> queue and the same per-item human approval step.

---

## 第 6 步:在 Meta 後台實際送出（逐步）

這段只有你能做——要登入你自己的 Meta 帳號、代表你的商家送件。我不會、也不該代替你登入或按送出。

> ⏱ 材料備齊的話後台操作約 20 分鐘。
> 審核時間**不一定**：官方沒有承諾天數，社群回報從幾個工作天到**每個權限 2–4 週**都有。
> 別把上線日期押在特定日期上。
> ⚠️ **表單中途不能存草稿**，所以第 3、4 步的材料一定要先做完再開始填。

### 你的 App 資訊（實測撈出來的）

| | |
|---|---|
| App 名稱 | **Threads Auto ARGO** |
| Token 到期 | 2026-09-26 |
| Token 實際帶的權限 | **11 個**，但工具只用 5 個 |

**只送這 6 個**（其餘 5 個工具沒用到，送了會變成退件理由）：

```
threads_basic
threads_content_publish
threads_keyword_search
threads_manage_insights
threads_read_replies
threads_manage_replies
```

沒用到、**不要送**的：`threads_manage_mentions`、`threads_delete`、
`threads_location_tagging`、`threads_profile_discovery`、`threads_share_to_instagram`。

---

### 6-0　先把材料做完（表單開始後就不能停）

- [ ] 螢幕錄影（第 3 步分鏡）
- [ ] 5 張截圖（第 4 步清單）
- [ ] 這份文件開著，等一下要複製第 2、5 步的英文段落

---

### 6-1　開啟 Meta 開發者後台

1. 瀏覽器開 **<https://developers.facebook.com/apps>**
2. 用**管理這個 App 的 Facebook 帳號**登入（不是 Threads 帳號本身）
3. 畫面上是你的 App 清單 → 點 **Threads Auto ARGO**
4. 進去後左側是選單列，上方會顯示目前模式：**開發中 / Development**

> 找不到 App？確認登入的帳號是當初建立 App 的那一個。App 只有管理員看得到。

---

### 6-2　補完 Basic settings（沒填會直接擋審核）

左側選單 **應用程式設定 / App settings → 基本 / Basic**

逐欄填：

| 欄位 | 填什麼 |
|---|---|
| 隱私政策網址 / Privacy Policy URL | `https://1071107xznw-lang.github.io/threads-engager/privacy-policy` |
| 使用者資料刪除 / User data deletion | 選 **Data deletion instructions URL**，填上面同一條網址 |
| 應用程式圖示 / App icon | 上傳 **1024×1024 PNG**（Argo logo）。**必填，沒有會擋送審** |
| 類別 / Category | 選 **Business and pages**（商業與粉絲專頁） |
| 應用程式網域 / App domains | **留空**（自架工具，沒有對外網域） |

拉到頁面最下面按 **儲存變更 / Save changes**。

> ✅ 存檔後，用**無痕視窗**貼一次隱私政策網址，確認打得開。審核官一定會點。

---

### 6-3　找到權限申請頁

> ⚠️ **不是**舊版的「App Review → Permissions and Features」。新版後台改走 **Use cases**，
> 舊路徑已經不是入口了。

左側選單 **使用案例 / Use cases** → **Access the Threads API** → 按 **自訂 / Customize**

進去之後才會看到 **權限和功能 / Permissions and Features** 的清單：

1. 搜尋框輸入 `threads_`（或直接看列表）
2. 每個權限右邊有一顆按鈕：
   - **要求進階存取權 / Request advanced access** ← 要按的是這顆
   - 已經是進階的會顯示 **Advanced access**，那就跳過

`threads_basic` 常常本來就是進階存取權——**顯示已是 Advanced access 就不用送**。

**左側找不到「使用案例」？** 代表 App 建立時沒選 Threads use case。
先到 **App settings → Basic** 最下面把 **Threads** 產品加上去，選單才會出現。

> 💡 **不必等審核就能繼續用**：把自己的帳號加成 **Threads Tester**
> （App Dashboard → **App roles → Roles** → Add People → 選 Threads Tester），
> 測試者帳號可以立刻取得全部權限，不需要 App Review。
> 這不會解鎖 `keyword_search` 搜到別人的貼文（那要 Live），但開發與自用完全夠。

---

### 6-4　逐個權限填表（重複 5～6 次）

每按一次 **Request advanced access** 會展開一份表單，三個欄位：

| 表單問你 | 貼哪一段 |
|---|---|
| **你會如何使用這項權限？**<br>How will you use this permission? | 本文件**第 2 步**該權限的英文段落（原文貼上） |
| **示範操作 / Screencast** | 上傳第 3 步錄的影片 |
| **附註 / 測試說明**<br>Additional notes / testing instructions | 本文件**第 5 步**整段 |

有些權限還會多問「這項功能對使用者的價值」——把第 2 步的**共用開場**貼上去。

填完按該權限的 **送出 / Submit**。回到清單，換下一個。

> 影片可以**同一支重複上傳**給每個權限，不用剪五支。

---

### 6-5　最後送出

五個都填完後，頁面上方（或左側 **App Review → Requests**）會出現一個
**提交以供審查 / Submit for Review** 的按鈕。

按下去之前，最後確認：

1. 用**無痕視窗**開一次隱私政策，確定打得開
2. 影片裡**看得到按下核准的那一刻**，而且**沒被送出的那幾則還留在清單上**
3. 影片裡**沒有**出現 token、密碼、`.env`、Tailscale IP
4. **只送了那 6 個權限**

按 **Submit**。

---

### 6-6　送出之後

- 狀態在 **App Review → Requests** 看，會顯示 Pending / Approved / Rejected
  （送出用 Use cases，但看狀態仍在 App Review 底下）
- 結果也會寄到 App 管理員的信箱
- **被退件會寫明理由** → 對照本文件「常見退件原因」修完可**重送，次數不限**

### 6-7　通過之後才做這三件

1. App Dashboard 上方把模式從 **Development** 切成 **Live**
2. `config/brand.json` 把 `useThreadsSearch` 改成 `true`
3. 重啟服務：

```bash
launchctl kickstart -k gui/501/com.argo.threads-engager
```

驗證：「回覆審核」按「搜尋候選串」→ 應該開始撈到**別人**的公開串。

詳見 [`go-live-checklist.md`](go-live-checklist.md)。

---

## 常見退件原因(先自己檢查一遍)

- ❌ 隱私權政策 URL 打不開 → 先用**無痕視窗**測
- ❌ 錄影沒拍到按核准的那一刻 → 這是第一名退件原因
- ❌ 用途說明太空泛(「for social media management」)→ 要寫到端點名稱
- ❌ 送了用不到的權限 → 只送上面確認過的
- ❌ 錄影還開著 DRY_RUN → 看起來像沒真的送出
- ❌ 拿 Development 模式的搜尋結果當「別人的貼文」演 → 畫面上全是自家帳號,
  審核官一眼看穿。用留言區拍,搜尋那段照實說明

---

## 通過之後

1. App Dashboard 把 App 切成 **Live**
2. `config/brand.json` 把 `useThreadsSearch` 改成 `true`
3. 重開 `npm start`,「回覆審核」按「搜尋候選串」→ 應該開始撈到**別人**的公開串

詳見 [`go-live-checklist.md`](go-live-checklist.md)。

> ⚠️ Meta 的權限名稱與審核介面常改,**以你 App Dashboard 當下顯示的為準**。
