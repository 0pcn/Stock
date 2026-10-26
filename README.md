# Stock · 藏股 Stockfolio

手機優先的股票庫存 PWA，正式網址：**https://0pcn.github.io/Stock/**。

網站以 React + Vite 建置成靜態 HTML、CSS 和 JavaScript，由 GitHub Pages 提供。登入後直接顯示庫存；首頁摘要、持股列表及排序採未實現損益／報酬率，持股明細顯示已實現＋未實現的累計價差損益。底部有庫存、分析、交易、股利及帳戶五個分頁，支援加入手機主畫面。

## 執行與建置

使用 Node.js 24：

```sh
npm ci
npm run dev
```

開啟 `http://localhost:5173/Stock/`。正式建置用 `npm run build`，輸出為 `dist-pages/`；`npm run preview` 可預覽建置結果。`npm run typecheck` 執行型別檢查；`npm run test:google` 執行授權、權限與同步測試。

## GitHub Pages 部署

Repository → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。推送 `main` 後，`.github/workflows/pages.yml` 會安裝套件、檢查、測試、建置及發布。

PWA、圖示、離線頁與資源路徑均支援 `/Stock/`，不會誤指向 `0pcn.github.io` 的根目錄。

## Google 登入設定

公開設定位於 `pages/google-config.json`：

- `clientId`：Web application OAuth Client ID，可公開。
- `deploymentId`：股票腳本的 API 執行檔部署 ID，可公開；不是 Script ID。

**不要放入 Client Secret、refresh token、Access Token 或私鑰。** GitHub Pages 版本不讀取 `.env.local`，不使用網站後端、資料庫或伺服器端 OAuth 回呼。

在 Google Cloud `Stock` 專案設定：

1. 啟用 Google Sheets API 與 Google Apps Script API。
2. Google Auth Platform → 用戶端 → 現有 Web Client → **已授權的 JavaScript 來源**加入 `https://0pcn.github.io`（沒有 `/Stock/`），本機開發另加 `http://localhost:5173` 和 `http://127.0.0.1:5173`。
3. Data Access 保留原腳本要求的三個範圍：`spreadsheets`、`script.external_request`、`script.scriptapp`（完整值見 `google-apps-script/production-setup.md`）。
4. 測試模式需加入 Test users；要提供其他帳號使用，需依 Google 的發布與驗證要求設定目標對象。
5. 股票腳本與 OAuth Client 使用同一個標準 Cloud 專案，並部署為 API 執行檔。要讓其他帳號更新，部署存取權需允許其他已登入的 Google 使用者。

詳細步驟見 [Google 正式設定](google-apps-script/production-setup.md)。

## 資料與同步

所有人固定使用同一份股票試算表，各自以自己的 Google 帳號授權。試算表本身的 Google 分享權限決定是否能讀取；更新現價還需要編輯權限。網站不自動新增分享對象。

登入、開啟頁面及資料旁的重試只讀取五個固定分頁。手動按「更新現價並同步」會呼叫試算表「股票工具 → 立即更新現價」使用的原始腳本，等待成功後才重新讀取庫存、交易、股利與損益。抓價失敗會保留舊價並顯示失敗代號；結果不明時不自動重送。

Google 存取 Token、授權範圍與原始到期時間會保存在此瀏覽器或 PWA 的 localStorage，讓重新整理、關閉再開及手機背景重載後，在授權仍有效時直接進入庫存。重新開啟不會延長 Google 的授權期限，也不會自動重送價格更新；Token 到期或遭 Google 拒絕後需要再次登入。登出會清除保存的 Token 與畫面資料，同一儲存空間的其他分頁也會失效；已關閉網站的過期 Token 於下次開啟時清除。瀏覽器若禁止儲存，會退回目前分頁記憶體，不影響本次使用。此記憶不會跨裝置、跨瀏覽器同步，清除網站資料也會清除登入；不使用 refresh token、sessionStorage 或 cookie。

庫存成本、手續費、稅、股利及損益沿用原始試算表與股票工具。首頁只加總目前持股；已出清股票顯示於分析頁。CSV 匯出保留原始值。

Service worker 只快取公開圖示與離線提示，不快取股票資料、Google API 或授權資訊。查看資料需要網路；手機安裝仍需在 Safari／Chrome 的分享或安裝選單完成。

歷史的伺服器模式仍保留於程式庫，供回溯使用，並以 `dev:server`／`build:server` 明確區分。預設開發、建置及 GitHub Actions 都只使用靜態 Pages 版本。
