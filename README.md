# 藏股 Stockfolio

個人台股庫存可視化網站，使用 Google Sheets 原有計算結果。私人網站由 Sites 管理登入與存取權限。

## 功能
- 資產總覽、市值配置、持股損益與明細
- 搜尋、上市／上櫃／ETF 篩選、排序、含股利切換、金額隱藏
- 交易記錄、股利年度圖與查詢、已出清股票損益
- 以登入者的 Google Drive 連線讀取資料，無個人庫存快照寫入程式碼
- 原始值 CSV 匯出；交易新增於原始試算表操作，再按同步更新
- PWA manifest、192/512 圖示、Apple touch icon、service worker 與離線說明

## 開發
Node.js 22.13 以上。`npm install`，`npm run dev`。正式建置使用 Sites 的 build-site.mjs helper。
資料讀取代理：`app/api/portfolio/route.ts`。來源試算表與分頁固定於伺服器；只允許同源 POST，需登入，連接器宣告為 read_only。

## 資料規則
庫存欄位沿用原始表格，不重算股價或券商費用。首頁只加總目前持股；已出清股票獨立顯示。股利頁加總表內實際領到金額。資料讀取與試算表更新時間分開標示。CSV 保留原始值（日期為 Sheets 序號）。

PWA 只快取公開圖示與離線提示，不快取 API、財務資料或帶登入資訊的頁面。查閱股票需要連線。實機 iOS/Android 安裝仍需在手機上確認。
