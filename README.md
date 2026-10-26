# Stock · 藏股 Stockfolio

個人台股庫存可視化網站，使用 Google Sheets 原有計算結果。私人網站由 Sites 管理登入與存取權限。

## 手機 App 介面

開啟時先確認登入狀態；未登入顯示獨立登入頁，不會發送庫存讀取請求或顯示底部分頁。登入後直接進入「我的庫存」，以持股清單呈現市值、損益、報酬率與現價。

底部固定五個分頁：庫存、分析、交易、股利、我的。資產配置與已實現損益位於分析頁；授權、匯出、偏好及登出位於我的帳戶。全尺寸均不使用 sidebar，持股明細改為底部面板，並預留手機安全區域。

## 功能
- 資產總覽、市值配置、持股損益與明細
- 搜尋、上市／上櫃／ETF 篩選、排序、含股利切換、金額隱藏
- 交易記錄、股利年度圖與查詢、已出清股票損益
- 以登入者的 Google Drive 連線讀取資料，無個人庫存快照寫入程式碼
- 原始值 CSV 匯出；交易新增於原始試算表操作，再按同步更新
- PWA manifest、192/512 圖示、Apple touch icon、service worker 與離線說明

## 本機開發（Google OAuth）

使用 Node.js 22.13 以上，`npm install` 後執行 `npm run dev`。固定以 `http://localhost:5173` 開啟網站。

1. 在 Google Cloud 專案啟用 Google Sheets API。
2. 設定 Google Auth platform 的同意畫面，個人帳號選 External / Testing，將持有試算表存取權的帳號加入 Test users。
3. 在 Data Access 新增 `https://www.googleapis.com/auth/spreadsheets.readonly`。這是唯讀權限，Google 的授權範圍涵蓋該帳號可存取的試算表；本程式只允許讀取固定的股票試算表與五個分頁。
4. 建立 Web application OAuth client，授權重新導向 URI 設定為 `http://localhost:5173/api/auth/google/callback`。
5. 複製 `.env.example` 為 `.env.local`，填入 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，保留上述 `GOOGLE_REDIRECT_URI`。若已存在設定檔，請直接編輯，勿覆蓋。
6. 儲存並重新啟動 `npm run dev`，在網站點「連接 Google」，完成 Google 登入與授權。回到頁面會自動讀取資料。

Client Secret 不會放入瀏覽器程式碼，也不會提交 Git。OAuth 使用 state 與 PKCE；只允許 loopback 主機與同源的 POST。登入後的 Token 存於本機 `.sites-runtime/google-oauth/`（資料夾權限 0700、檔案 0600），瀏覽器只有 HttpOnly / SameSite cookie。請勿上傳該目錄或將它放入公開備份。更換瀏覽器或清除 cookie 後需要重新連接。

「登出」只清除這個瀏覽器的本機登入，不撤銷 Google 帳號上整個應用程式的授權。需撤銷時可使用 Google 帳號的第三方連線管理。External / Testing 模式下，含 Sheets 權限的 refresh token 7 天後到期，網站會要求重新連接。

OAuth 設定有修改時需重啟開發伺服器；未儲存的登入回呼在重新啟動後會過期。`localhost` 與 `127.0.0.1` 是不同的 cookie 網域，登入流程會使用 `GOOGLE_REDIRECT_URI` 的主機。這個 OAuth 伺服器只供本機 `npm run dev`，不支援 LAN、`npm run start` 或其他對外主機。

正式 Sites 網站仍使用 Sites 管理的 ChatGPT 登入與 Google Drive 連接器。本機 OAuth 只在 Vite development middleware 運作，不包含在正式 Worker 建置，也不需要 Codex 資料橋接。本次本機修改不會自動部署至正式網站。

安全與授權回歸測試：`npm run test:google`。來源定義：`lib/portfolio-sources.mjs`；本機 OAuth：`scripts/local-google/server.mjs`；正式 Sites 代理：`app/api/portfolio/route.ts`。

官方參考：
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/guides/configure-oauth-consent
- https://developers.google.com/workspace/sheets/api/scopes

## 資料規則
庫存欄位沿用原始表格，不重算股價或券商費用。首頁只加總目前持股；已出清股票獨立顯示。股利頁加總表內實際領到金額。資料讀取與試算表更新時間分開標示。CSV 保留原始值（日期為 Sheets 序號）。

PWA 只快取公開圖示與離線提示，不快取 API、財務資料或帶登入資訊的頁面。查閱股票需要連線。實機 iOS/Android 安裝仍需在手機上確認。
