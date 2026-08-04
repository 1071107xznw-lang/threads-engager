# App Review 送審說明書（可直接複製貼上）

送審是文件工作,不是技術工作。審核官不會讀你的程式碼——他們看三樣東西:
**用途說明寫得夠不夠具體**、**錄影有沒有拍到人工核准那一步**、**隱私權政策打不打得開**。

這份文件把三樣都備好了。英文段落請**原文貼上**(Meta 審核以英文進行)。

---

## 第 0 步:先過硬擋條件

| 項目 | 狀態 | 怎麼處理 |
|---|---|---|
| 隱私權政策 URL | ✅ **已上線** | 見下方，直接複製 |
| App 圖示 / 顯示名稱 / 類別 | 待你填 | Basic settings,類別選 **Business** |
| 商家/開發者驗證 | Meta 若要求才需要 | 依畫面指示 |

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
| `threads_manage_insights` | `GET /{media-id}/insights` | ✅ 建議送(只讀自家資料,好過) |
| `threads_manage_replies` | `GET /{media-id}/conversation` | ⚠️ 見下方說明 |

> `threads_manage_replies`:你目前的 token 已經能成功呼叫 `/conversation`。
> 到 App Dashboard 的權限頁確認它是否已勾選——**已經有就一起送審**(不然上 Live 後留言區會壞);
> 沒勾選就代表 `/conversation` 是靠 `threads_basic` 過的,那就別送。

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

### `threads_manage_replies` — 只有已勾選才送

> We use `GET /{threads-media-id}/conversation` to read the public replies left on the
> connected owner's **own** posts, together with the `replied_to` field, so we can determine
> which replies the owner has **not yet answered**.
>
> This powers an "inbox" screen: unanswered replies on the owner's own posts are listed, a
> suggested response is drafted for each, and the owner approves each one individually before
> it is sent. This is ordinary community management — the account owner responding to people
> who commented on their own content.
>
> We only read conversations belonging to the connected owner's own media. We do not hide,
> delete, or moderate anyone's replies.

---

## 第 3 步:錄影腳本(審核最看重這段)

**一段影片就夠,60–90 秒,不用配音**,但畫面上必須清楚出現「人在按核准」。
用 macOS `⌘⇧5` 錄螢幕即可。

> 🔴 **最關鍵的一點**:核准按鈕被按下的那一刻,以及按下前後清單狀態的變化,
> 必須在同一鏡頭內連續拍到。剪掉那一刻 = 審核官看不到人工把關 = 退件。

### 分鏡

| # | 秒數 | 畫面 | 必須看得到 |
|---|---|---|---|
| 1 | 0–8 | 開 dashboard 首頁 | 三個分頁、狀態列 |
| 2 | 8–20 | 「回覆審核」分頁,按**搜尋候選串** | 抓回來的**別人的**公開貼文,清單長出來 |
| 3 | 20–35 | 停在一張卡片上,滑鼠指過去 | 原貼文內容 + 相關性分數 + **AI 草擬的回覆** |
| 4 | 35–45 | **在草稿框裡改幾個字** | 人真的在編輯,不是照送 |
| 5 | 45–55 | 🔴 **按「核准」** | 按鈕被按下、該則從待審清單消失 |
| 6 | 55–70 | 按「送出已核准」,確認對話框跳出 → 按確定 | 「送出 N、略過 M」的結果訊息 |
| 7 | 70–85 | 切到 Threads 看那則回覆真的出現了 | 送出的內容 = 你剛核准的內容 |

### 錄影前務必

- **DRY_RUN 關掉**(狀態列切到「正式模式」)——影片要證明真的送得出去
- 待審清單裡先留 **2–3 則**,才看得出「有選擇地核准」而不是全自動
- 視窗調大、字體看得清楚
- 把密碼欄位、`.env` 內容、token 全部避開鏡頭

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

---

## 常見退件原因(先自己檢查一遍)

- ❌ 隱私權政策 URL 打不開 → 先用**無痕視窗**測
- ❌ 錄影沒拍到按核准的那一刻 → 這是第一名退件原因
- ❌ 用途說明太空泛(「for social media management」)→ 要寫到端點名稱
- ❌ 送了用不到的權限 → 只送上面確認過的
- ❌ 錄影還開著 DRY_RUN → 看起來像沒真的送出

---

## 通過之後

1. App Dashboard 把 App 切成 **Live**
2. `config/brand.json` 把 `useThreadsSearch` 改成 `true`
3. 重開 `npm start`,「回覆審核」按「搜尋候選串」→ 應該開始撈到**別人**的公開串

詳見 [`go-live-checklist.md`](go-live-checklist.md)。

> ⚠️ Meta 的權限名稱與審核介面常改,**以你 App Dashboard 當下顯示的為準**。
