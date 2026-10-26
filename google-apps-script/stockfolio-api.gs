// 藏股 App 的固定 API 入口。只更新這份試算表，不接受外部指定檔案或函式。
function stockfolioRefreshCurrentPrices() {
  const spreadsheet = SpreadsheetApp.openById("1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70");
  const summary = spreadsheet.getSheetByName("庫存總覽");
  if (!summary || !summary.getRange(1, 1, Math.max(1, summary.getLastRow()), 17).canEdit()) {
    return { status: "forbidden" };
  }
  return refreshCurrentPrices({ source: spreadsheet });
}
