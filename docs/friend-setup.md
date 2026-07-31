# 朋友自架指南（各自用自己的帳號）

這套是**通用的單帳號工具**：你在自己的電腦上跑一份，連**你自己的** Threads 帳號，
所有對外回覆由**你自己**在網頁上核准後才送出。

> ⚠️ **一實例一帳號**。這份工具是給你操作**你自己**的帳號用的。
> 不要拿它去同時管理別人的帳號、或替別人代發——那違反 Threads 平台條款，
> 而且集中操作最容易讓帳號被風控停用。要分享就請對方也照這份各自架一份。

---

## 你需要先有的東西

- 一台 **Mac 或 Linux**（Windows 可用 WSL）
- **Node.js 18+**（建議 20/22；本專案 CI 跑 Node 22）。用 [nvm](https://github.com/nvm-sh/nvm) 裝最省事。
- **git**
- 你自己的 **Threads 帳號**
- （選用）**`claude` CLI** 並登入——只有要用 AI 自動產草稿才需要；不裝就用手動撰寫

---

## 步驟

### 1. 取得程式碼

```bash
git clone <這個 repo 的網址> threads-engager
cd threads-engager
npm install
```

> ⚠️ **不要放在 `~/Downloads`、`~/Desktop`、`~/Documents`**。這幾個資料夾被 macOS 隱私保護，
> 之後排程用的 cron 會因權限失敗（`EPERM: uv_cwd`）。放在家目錄下的一般資料夾即可，例如 `~/threads-engager`。

### 2. 拿到你自己的 Threads API 存取權

工具的設定精靈會要 **App Secret** 和一組 **短期 Access Token**。這兩個來自一個 **Meta App**：

1. 到 [developers.facebook.com](https://developers.facebook.com) 建立一個 App
2. 加入 **Threads API** use case
3. 在 App 設定裡拿到 **App Secret**
4. 為**你自己的 Threads 帳號**產生一組短期 access token（含 `threads_basic` 等權限）

細節與「要讓別人的公開串搜得到、要真正上線」的完整流程，見 **[go-live-checklist.md](go-live-checklist.md)**。
（Dev 模式就能發自己的原生貼文；聆聽回覆別人的串需要送審上 Live。）

### 3. 跑設定精靈

```bash
npm start
```

瀏覽器打開 **http://localhost:4321**，跟著 3 步精靈：

1. **前置**：確認你有上面那些東西
2. **連接帳號**：貼上 App Secret + 短期 token → 工具會自動換成 60 天長期 token、抓你的帳號
3. **品牌設定**：填品牌名、persona、tags、回覆語氣

完成後就進到「內容中心」dashboard。你的憑證只存在**你自己這台電腦**的 `data.db` / `.env`（都不會進 git）。

### 4. （選用）AI 自動產草稿

想用「產生草稿」自動蹭熱搜產貼文、或自動產回覆草稿，需要本機有登入的 `claude` CLI：

```bash
claude          # 首次會引導登入；過期就用 /login 重登
claude -p "回我一句：OK"   # 回 OK 就代表登入正常
```

沒裝 `claude` 也能用——dashboard 會改成只顯示「自己寫一則」手動撰寫。

### 5. （選用）無人值守自動化

想讓它睡覺時也跑（排程發文、夜間產草稿），用 cron。範例與說明見 **[../README.md](../README.md)** 的
「🌙 無人值守自動化」。記得專案要在非 `~/Downloads` 的位置（見步驟 1）。

---

## 紅線（務必遵守）

- **對外回覆一律人工核准**：搜尋→AI 產草稿→進審核佇列→**你按核准**→才送出。沒有自動外送。
- **只走官方 API**：不裝爬蟲/瀏覽器自動化、不做規避偵測。
- **一實例一帳號**：一份部署只服務你自己一個帳號。要給朋友就請他也各自架一份。
- **Secrets 不進 git**：`.env`、`data.db`、`config/brand.json` 都已被 `.gitignore` 排除，別 commit 上去。

完整規則見專案根目錄的 `CLAUDE.md`。

---

## 常見問題

- **每次都要開著電腦嗎？** 要。工具跑在你自己的電腦上；電腦關機就不會發。排程也是靠你電腦上的 cron。
- **手機能操作嗎？** 同一個 Wi-Fi 下，用電腦的區網 IP（如 `http://192.168.x.x:4321`）可以；
  但 dashboard 目前沒有密碼，公開網路或不同網路存取請先加保護（問管理員/看 README）。
- **要花錢嗎？** Threads 官方 API 免費（有額度上限，工具會自動守門）。AI 產草稿需要你自己的 `claude` 訂閱。
