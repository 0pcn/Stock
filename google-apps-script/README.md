# 與「股票工具 → 立即更新現價」共用同一個更新程式

已確認來源專案的選單使用 `refreshCurrentPrices(e)`。App 不重新實作行情來源或損益公式，而是呼叫同一份 Apps Script，等待完成後再讀取 Google Sheets。

## 一次性設定

1. 將 `refresh-current-prices.patch` 套用到原本的「股票.gs」：更新現價與重建庫存共用 ScriptLock，回傳成功、失敗股票和完成時間。這避免 API 執行時沒有綁定文件的 DocumentLock，也保留重建庫存與更新現價之間的互斥。
2. 在同一腳本加入 `stockfolio-api.gs` 的固定入口。若已將補丁中的入口附加到檔案，不要重複加入。
3. 將 Apps Script 的 GCP 專案設為與本機 OAuth Client 相同的標準 Google Cloud 專案。
4. 在該 Google Cloud 專案啟用 Google Apps Script API。
5. 將腳本部署為 **API 執行檔**，存取權限選擇 **僅限本人**。無須建立公開 Web App。
6. 把真正的 API 執行檔部署 ID 填入本機 `.env.local` 的 `GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID`，重新啟動開發伺服器。
7. 在 OAuth 的 Data Access 加入本腳本要求的三個範圍，重新登入 Google 授權：
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/script.scriptapp`

最後一個範圍來自原腳本的排程管理功能。Apps Script API 要求 Token 包含整個腳本需要的範圍；App 的執行入口固定為現價更新，不提供外部指定函式、試算表或排程的代理。

## 同步行為

- 只有明確點擊「同步資料／更新現價並同步」才執行腳本。
- 登入、載入頁面、一般資料讀取與失敗後的讀取重試，都不會執行價格更新。
- 執行成功後才讀回五個分頁；報價仍沿用原始 Yahoo Finance／證交所 MIS 來源，不保證每次都有不同的成交價。
- 部分抓價失敗會保留舊價並顯示失敗代號。
- 同一次點擊以 request ID 去重；結果不明的請求不自動重送，避免重複執行。
- 原腳本已有的持股、成本、股利、手續費、稅與損益公式維持不變。

官方文件：https://developers.google.com/apps-script/api/how-tos/execute
