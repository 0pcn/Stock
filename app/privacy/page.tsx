export default function Privacy() {
  return <main style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px', lineHeight: 1.8 }}>
    <a href="/">← 回到藏股</a><h1>藏股 Stockfolio 隱私權說明</h1>
    <p>藏股提供固定股票試算表的庫存、交易、損益及股利查閱，並可手動執行試算表原有的現價更新程式。</p>
    <h2>Google 授權如何使用</h2>
    <p>每位使用者以自己的 Google 帳號授權。網站只讀取固定的股票試算表；更新現價需要該帳號有試算表編輯權限。Google 權限範圍涵蓋試算表讀寫、腳本連線外部服務，以及原腳本使用的排程管理。網站的同步入口只執行固定的現價更新函式，不接受訪客指定其他檔案或函式。</p>
    <h2>儲存與保護</h2>
    <p>Google 存取及更新 Token 加密保存於託管伺服器資料庫，不放入瀏覽器程式或離線快取。瀏覽器只保存受 HttpOnly、Secure 與 SameSite 保護的登入 cookie。登入最長保留 30 天，也可能因 Google 授權失效而提前結束。更新請求的狀態用來避免重複或多人同時執行；股票庫存不保存為共用快照。</p>
    <h2>外部服務</h2>
    <p>資料透過 Google Sheets 與 Apps Script 處理。現價來源沿用原股票腳本所連接的行情服務。網站及授權資料由 Sites／Cloudflare 託管。網站不將 Google 使用者資料用於廣告或出售。</p>
    <h2>撤銷與刪除</h2>
    <p>在網站登出會刪除這個瀏覽器對應的伺服器登入資料；也可從 Google 帳戶的第三方連線管理撤銷 stock 的授權。過期登入與驗證資料會於後續登入流程清理。網站登出不會刪除原始試算表內容。</p>
  </main>;
}
