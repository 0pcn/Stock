# GitHub Pages：Google 登入後共用固定股票表

正式網址：`https://0pcn.github.io/Stock/`

## 1. Google OAuth 用戶端

Google Cloud `Stock`（`stock-512804`）→ Google Auth Platform → 用戶端 → 選擇既有 Web application Client。

在 **已授權的 JavaScript 來源**加入：

```text
https://0pcn.github.io
http://localhost:5173
http://127.0.0.1:5173
```

來源只包含協定、主機與必要的 port，不包含 `/Stock/`。GitHub Pages 使用 Google Identity Services 彈出視窗的 token model，無須新增伺服器回呼網址，也不使用 Client Secret。既有其他用途的回呼網址可保留。

`pages/google-config.json` 只放公開 Client ID 與 API 執行檔部署 ID。

## 2. API 與授權範圍

在同一個 Cloud 專案啟用 Google Sheets API 與 Google Apps Script API。

Data Access 包含原股票腳本的三個範圍：

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.scriptapp`

最後一項來自原腳本的排程功能。Apps Script API 要求授權涵蓋整份腳本的範圍；網站只呼叫固定的現價更新函式，不新增排程。

在目標對象 Audience 設定使用者：Testing 模式只允許 Test users。正式提供其他帳號使用時，依 Google 要求發布與驗證；未驗證應用可能有警告與使用者上限，發布不代表已完成驗證。

首頁可使用 `https://0pcn.github.io/Stock/`，隱私權說明為 `https://0pcn.github.io/Stock/privacy.html`。

## 3. Apps Script 執行入口

股票腳本與網站 OAuth Client 必須共用同一個標準 Cloud 專案。

把 `stockfolio-api.gs` 的固定入口加入原股票腳本；如果入口已存在，只替換同名函式，不要重複加入或刪除其他股票工具函式。此版本使用 `canEdit()` 在更新前檢查庫存範圍權限。

Apps Script → 部署 → 管理部署作業 → 編輯目前 API 執行檔：

1. 選擇新版本，包含更新後的入口。
2. 「誰可以存取」改成已登入 Google 的使用者（ANYONE），才能接受其他帳號的呼叫。
3. 部署。若產生新部署 ID，更新 `pages/google-config.json` 再推送 GitHub。

不要改成以擁有者代為執行的 Web App。每位訪客必須用自己的 Google 授權。沒有試算表存取權限者無法讀取；檢視者不能更新現價。若要新增可更新的人，請在 Google 試算表共用設定加入該帳號為編輯者。

## 4. 操作驗證

- 未登入應顯示登入頁，不會讀取庫存。
- 用編輯者帳號登入，庫存應成功載入。
- 按更新現價，成功後庫存明細的試算表更新時間應改變。
- 檢視者的價格更新應被拒絕；完全沒有權限者不能讀取。
- 登出或授權到期，畫面資料及分頁中的 Token 應清除。
- 網路中斷或結果不明，不會自動重送更新。

## 官方參考

- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/apps-script/api/how-tos/execute
