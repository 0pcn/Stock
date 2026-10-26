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

第一次使用需以 Google 帳號授權並讀取資料。成功讀取的庫存、交易、股利、已實現損益與設定會保存在此裝置的 IndexedDB；之後開啟先顯示保存的資料與「庫存最後讀取」日期時間。Google 授權過期、使用者取消授權或網路中斷時，仍可查看保存的庫存及持股明細，不會被導回登入頁；清除瀏覽器資料或「登出並清除此裝置資料」後，需再次登入建立資料。資料不會跨裝置、跨瀏覽器或 Safari 與獨立主畫面 App 同步。無法保存時會顯示提示。

授權有效時，開啟頁面會自動重新讀取試算表五個固定分頁；這只反映試算表目前的資料，不會自動抓取最新行情。手動按「更新現價並同步」才會執行原試算表「股票工具 → 立即更新現價」使用的腳本，等待成功後重新讀取各分頁。若 Google 授權已過期或即將到期，這次點擊會先開啟授權，成功後接續這次同步；取消授權及結果不明時不自動重送。抓價失敗會保留舊價並顯示失敗代號。每個分頁保存自己的成功讀取時間，失敗時不會把舊資料標為剛更新。

Google 存取 Token、授權範圍與原始到期時間另存於 localStorage 與 IndexedDB，供期限內更新使用。重新開啟不會延長 Google 的授權期限；到期後清除 Token，不會清除保存的庫存。登入會等待儲存完成並確認結果；無法保存授權時，仍可在目前分頁使用。主動登出會清除此裝置保存的財務資料與授權，也會通知使用相同儲存空間的其他分頁清除畫面。切換帳號前會清除舊的資料；遲到的舊請求無法重新寫回已清除的庫存。網站不使用 Client Secret、refresh token、sessionStorage 或 cookie，也不會建立共用庫存快照。

庫存成本、手續費、稅、股利及損益沿用原始試算表與股票工具。首頁只加總目前持股；已出清股票顯示於分析頁。CSV 匯出保留原始值。

Service worker 只快取公開 App 檔案、樣式、圖示與離線提示；股票資料在裝置的 IndexedDB，Google API 回應與授權資訊不放入 Cache Storage。App 檔案準備完成且已保存庫存後，離線也能開啟查看上次資料；取得新資料與行情需要網路及有效 Google 授權。手機安裝仍需在 Safari／Chrome 的分享或安裝選單完成。

歷史的伺服器模式仍保留於程式庫，供回溯使用，並以 `dev:server`／`build:server` 明確區分。預設開發、建置及 GitHub Actions 都只使用靜態 Pages 版本。
