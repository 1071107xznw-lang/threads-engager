# Threads App 送審上 Live 清單

把 Meta App 從 **Development** 送審切到 **Live**，聆聽回覆與站內趨勢才會有真實資料。

## 前置認知
- Dev 模式：`keyword_search` 只回**你自己**的貼文；App 只對開發者/測試者帳號有效。
- 要 Live 才有用的：**聆聽回覆別人的串**、**站內趨勢**。
- **原生排程發文 Dev 模式就能用**——上 Live 不影響它。

---

## 第一段：送審前準備（developers.facebook.com → 你的 App）

- [ ] **補齊 App 基本資料（Basic settings）**——沒填會直接擋審核：
  - [ ] App 圖示、顯示名稱、類別
  - [ ] **隱私權政策 URL**（必填，要能公開開啟）
  - [ ] 商家/開發者驗證（Meta 若要求）
- [ ] **確認要送審的權限**（Use cases → Access the Threads API → Customize）：
  - [ ] `threads_basic` — 必備（讀 profile）
  - [ ] `threads_content_publish` — 發原生貼文 **和** 送出回覆都靠它
  - [ ] `threads_keyword_search` — 搜別人的公開貼文（聆聽 + 趨勢）
  - [ ] `threads_manage_replies` — 只有要「管理自己貼文底下的留言（隱藏/回覆）」才需要；單純回別人的串**不一定**要，先確認再決定
- [ ] **準備 App Review 素材**（每個進階權限都要）：
  - [ ] 一段**螢幕錄影**，示範完整流程：`搜尋候選串 → AI 產草稿 → 進審核佇列 → 人工按核准 → 才送出`
  - [ ] 幾張截圖（dashboard 的回覆審核畫面、核准按鈕）
  - [ ] 文字說明：**如何、為何**呼叫每個權限

## 第二段：送出審核

- [ ] 每個進階權限填「用途說明」，**主打合規設計**（這是相對別人的優勢）：
  - 所有對外回覆**一律經人工在 dashboard 逐則核准**才送出，無任何自動外送路徑
  - 走**官方 API**，不做爬蟲/瀏覽器自動化
  - 內建**額度守門**（keyword_search 每 7 天 ≤ 上限）與同作者去重，低頻批次、不濫用
  - 一份部署只服務**一個帳號**、由帳號擁有者本人操作
- [ ] 送出，等審核結果（通常數天；被退會附原因）。

## 第三段：通過後啟用

- [ ] App Dashboard 把 App **切成 Live 模式**。
- [ ] 開 `config/brand.json`，把 `useThreadsSearch` 改成 `true`：
  ```json
  "useThreadsSearch": true
  ```
  （這是實際會被載入的設定檔。）
- [ ] 重開 dashboard 讓設定生效：
  ```bash
  cd ~/threads-engager && npm start
  ```
- [ ] 驗證：「回覆審核」按「搜尋候選串」→ 應開始撈到**別人**的公開串；狀態列「站內搜尋」變「開」。
- [ ] 這時 draft-cron（每 6h）也會自動開始產出真的回覆草稿，早上批次核准即可。

---

## 常見被退原因（先避開）
- ❌ 隱私權政策 URL 沒填 / 打不開
- ❌ 錄影沒清楚示範「人工核准」那一步（審核最在意有沒有人在把關）
- ❌ 權限用途寫得太空泛，沒對到實際 API 呼叫
- ❌ 要求了用不到的權限（只送你真的會用的那幾個）

> ⚠️ Meta 的權限名稱與審核介面常改，**以你 App Dashboard 當下顯示的為準**；上面名稱是目前的通稱。
