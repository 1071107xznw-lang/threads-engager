# 遠端/手機存取內容中心（安全設定）

內容中心跑在你的電腦上（`http://localhost:4321`）。想從**手機**或**外面**用，需要兩件事：
**(1) 一道登入密碼**、**(2) 一條連進來的通道**。

> ⚠️ dashboard 是你帳號的控制台。**沒有密碼就別對區網/外網開放**——任何人連到就能操作你的帳號。

---

## 第一步（必做）：設登入密碼

在專案的 `.env` 加一行（自己想一組強一點的密碼）：

```bash
DASHBOARD_PASSWORD=你的密碼
```

重開 `npm start`，啟動訊息會出現 `🔒 已啟用登入密碼`。之後開網頁會跳出登入框：
**帳號隨便填、密碼填上面那組**即可。本機、手機、遠端都會要這道密碼。

（留空 = 免密碼，只適合純本機自己用。）

---

## 第二步：選一種連進來的方式

### A. 同一個 Wi-Fi（最簡單）
手機和電腦連同一個 Wi-Fi，用電腦的區網 IP：

```
http://<電腦區網IP>:4321
```

查電腦 IP：`ipconfig getifaddr en0`（Wi-Fi）。IP 可能因 DHCP 變動；要固定可在路由器設保留位址。

### B. 不同網路 / 外出（推薦 Tailscale，私有加密）
[Tailscale](https://tailscale.com) 幫你的裝置組一個**只有你自己**的私有網路，手機在 4G 也連得到，且**不會公開曝露到全網**。

1. 電腦裝 Tailscale、用你的帳號登入：`brew install --cask tailscale`（或官網下載），開 App 登入
2. 手機也裝 Tailscale App、**用同一個帳號**登入
3. 查電腦的 Tailscale IP（`100.x.x.x`）：Tailscale App 裡看，或 `tailscale ip -4`
4. 電腦保持 `npm start` 在跑
5. 手機瀏覽器打開：`http://100.x.x.x:4321` → 輸入密碼

這樣只有你自己的裝置連得到，中間全程加密。

> ❌ 不建議 ngrok / Cloudflare Tunnel 這類**公開網址**方案——那會把控制台放到全網，就算有密碼風險也高。真要用，務必搭配密碼，並理解風險。

---

## 換個埠（選用）
埠衝突時，在 `.env` 設 `PORT=`（預設 4321），例如 `PORT=4400`，網址跟著改。

## 提醒
- 電腦要**開著**且 `npm start` 在跑，遠端才連得到（自動排程發文則是 cron 在跑，跟這個無關）。
- 密碼走 HTTP Basic Auth：**在 Tailscale（加密）或本機/區網下用沒問題**；別在未加密的公開 HTTP 上曝露。

## 🔐 建議做法：只綁 Tailscale 介面

預設 `HOST=0.0.0.0` 代表**同一個區網的任何裝置都連得到**這個 dashboard——
而它能用你的身分發文。店面環境下，那包含**客用 Wi-Fi 上的所有人**。

Tailscale 登入後，把 `.env` 的 `HOST` 設成這台機器的 Tailscale IP：

```bash
tailscale ip -4          # 例如 100.88.137.107
```

```
HOST=100.88.137.107
```

之後 Mac 與手機都用同一個網址開：`http://100.88.137.107:4321`
（綁單一介面時 `localhost` 會連不到，這是正常的。）

| | `HOST=0.0.0.0`（預設） | 綁 Tailscale IP |
|---|---|---|
| 自己的手機（同 Wi-Fi） | ✅ | ✅ |
| 自己的手機（外面 / 4G） | ❌ | ✅ |
| 區網上的其他人 | ⚠️ 連得到 | ✅ 碰不到 |

啟動時會明講現在綁在哪、誰連得到，不用自己猜。

---

## 🔁 讓它自己一直跑（launchd 背景服務）

用 `npm start` 開的話，**關掉終端機視窗或關電腦，手機就連不到了**。
macOS 上交給 launchd：開機自動跑、當掉自動重啟、跟終端機視窗脫鉤。

服務檔：`~/Library/LaunchAgents/com.argo.threads-engager.plist`

| 要做什麼 | 指令 |
|---|---|
| 看狀態 | `launchctl print gui/$(id -u)/com.argo.threads-engager \| grep -E "state\|pid"` |
| 看 log | `tail -f ~/argo-dashboard.log` |
| 重啟（改完 `.env` 或 `git pull` 後） | `launchctl kickstart -k gui/$(id -u)/com.argo.threads-engager` |
| 暫停 | `launchctl bootout gui/$(id -u)/com.argo.threads-engager` |
| 重新啟用 | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.argo.threads-engager.plist` |

設定要點（照抄時注意）：

- **`WorkingDirectory` 一定要設**——server 從 cwd 讀 `.env` 與 `config/`、寫 `data.db`。
- **`PATH` 要含 `claude`**——AI 產稿是 spawn 子行程，PATH 沒有它就會全部失敗。
  launchd 的預設 PATH 很精簡，不會有 `/usr/local/bin`。
- **`KeepAlive` + `ThrottleInterval`**——開機時 Tailscale 可能還沒配好 IP，
  綁不上會啟動失敗；靠 KeepAlive 重試到成功，ThrottleInterval 避免狂重啟。
- **node 路徑寫死版本號**（nvm 的路徑含 `v24.17.0`）。之後用 nvm 升級 node
  要記得改這個檔，不然服務會起不來。

> ⚠️ 服務跑起來後**不要再手動 `npm start`**——會搶同一個埠。
> 要臨時停掉服務再手動跑，用上面的「暫停」。

