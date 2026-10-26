# 正式版：Google 登入後共用同一份試算表

目標網站：`https://pin-stockfolio-shared.craftycamel2049.chatgpt.site`

這份程式固定使用原本的股票試算表，不讓訪客輸入其他試算表、範圍或函式。每位訪客以自己的 Google Token 呼叫 API。只具有檢視權限的帳號可以讀取，更新現價則由 Apps Script 入口檢查庫存範圍的編輯權限；沒有編輯權限就回傳 forbidden。

## Google 端的一次性設定

1. Google Cloud 的 `Stock` 專案（`stock-512804`）→ Google Auth Platform → 用戶端 → 現有網站 OAuth client → 授權重新導向 URI 新增：

   ```text
   https://pin-stockfolio-shared.craftycamel2049.chatgpt.site/api/auth/google/callback
   ```

   保留既有 localhost 回呼。此程式使用伺服器 OAuth，不必為每個使用者建立 Client，也不必讓他們加入 Cloud 專案。

2. Google Auth Platform → Data Access 確認三個範圍仍存在：
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/script.scriptapp`

3. Google Auth Platform → 目標對象：測試模式只允許 Test users。要讓名單以外的帳號授權，需要發布到正式環境；公開提供敏感範圍時可能需要 Google 驗證。未驗證狀態可能有警告與使用者上限，不能把「發布」當作已完成驗證。應用程式的首頁與隱私權說明可使用正式網站及 `/privacy`。

4. 在綁定試算表的 Apps Script，將既有 `stockfolioRefreshCurrentPrices()` 換成同目錄 `stockfolio-api.gs` 的版本。只替換這個入口，不要刪除原本股票工具程式。

5. Apps Script → 部署 → 管理部署作業 → 選擇現有 API 執行檔 → 編輯：版本使用「新版本」，誰可以存取改為已登入 Google 的使用者（ANYONE），再部署。若 Google 要求新增部署而部署 ID 改變，請同步更新網站的 `GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID`。不要部署為匿名 Web App，也不要改成以擁有者代為執行。

6. 要讓某位訪客可以更新，將這份試算表分享給該 Google 帳號為「編輯者」。網站本身不會新增任何試算表共用權限。

## Sites 的正式設定

在 `.openai/hosting.json` 宣告 D1 `DB`，發布時由 Sites 套用 `drizzle/` 的 schema migrations。透過 Sites runtime secrets 設定：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`（上方完整 HTTPS 回呼）
- `GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`（32 bytes 隨機值，以 base64url 表示）

金鑰只保存於託管環境，不能提交 Git、寫入 hosting manifest 或前端。改變加密金鑰會讓既有登入失效。網站入口的 Sites audience 設為 public，讓一般訪客抵達 Google 登入頁；所有財務資料 API 仍要求有效的 Google session。

## 驗證

- 未登入 API 必須拒絕讀取與更新。
- 編輯者登入後應能讀取五個分頁，手動更新現價應成功，且試算表更新時間改變。
- 檢視者可讀，但更新必須收到沒有編輯權限的訊息。
- 完全沒有試算表權限者不得讀取庫存。
- 登出後資料應清除，再次呼叫 API 必須被拒絕。
- Google 授權或網路中斷後，不應自動重送更新。
