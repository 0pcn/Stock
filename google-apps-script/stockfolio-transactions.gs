// Fixed-sheet API. Add alongside transaction-rules.gs and the existing stock script.
function stockfolioAddTransaction(requestId, input) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) return { status: 'invalid' };
  let tx;
  try { tx = stockfolioValidateTransaction_(input); } catch (error) { return { status: 'invalid' }; }
  if (typeof writeSummaryContents_ !== 'function' || typeof getFeeSettings !== 'function') return { status: 'configuration_required' };
  const ss = SpreadsheetApp.openById('1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70');
  const sh = ss.getSheetByName('交易記錄');
  const summary = ss.getSheetByName('庫存總覽');
  const dividends = ss.getSheetByName('股利記錄');
  const realized = ss.getSheetByName('已實現損益');
  if (!sh || !summary || !dividends || !realized || sh.getMaxColumns() < 12) return { status: 'configuration_required' };
  if (![sh, summary, dividends, realized].every(sheet => sheet.getRange(1, 1, sheet.getMaxRows(), sheet === sh ? 12 : sheet === summary ? 17 : 7).canEdit())) return { status: 'forbidden' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: 'busy' };
  try {
    if (sh.getRange(1, 1).getValue() !== '交易日期') return { status: 'configuration_required' };
    const idHeader = sh.getRange(1, 12).getValue();
    if (idHeader !== '' && idHeader !== '藏股交易ID') return { status: 'configuration_required' };
    const rowCount = Math.min(sh.getMaxRows(), 4997) - 1;
    const rows = sh.getRange(2, 1, rowCount, 12).getValues();
    if (idHeader === '' && rows.some(row => row[11] !== '' && row[11] !== null)) return { status: 'configuration_required' };
    const fingerprint = requestId + '|' + JSON.stringify(tx);
    const existing = rows.findIndex(row => String(row[11]).startsWith(requestId + '|'));
    let target;
    if (existing >= 0) {
      if (rows[existing][11] !== fingerprint) return { status: 'conflict' };
      target = existing + 2;
    } else {
      const used = rows.map((row, index) => ({ row, index, date: stockfolioTransactionDate_(row[0]) })).filter(item => item.row[1] !== '' && item.row[1] !== null);
      if (used.some(item => !item.date)) return { status: 'invalid' };
      const last = used.length ? used[used.length - 1].index + 2 : 1;
      if (last >= 4997) return { status: 'full' };
      const later = used.find(item => item.date > tx.date);
      if (later && used.some((item, i) => i > 0 && used[i - 1].date > item.date)) return { status: 'ledger_order' };
      // Validate the entire affected ticker timeline, including backdated sells.
      const sameCode = value => stockfolioTransactionCode_(value) === stockfolioTransactionCode_(tx.code);
      const prior = used.find(item => sameCode(item.row[1]));
      if (prior && String(prior.row[3]).trim() !== tx.market) return { status: 'invalid' };
      const storedCode = prior ? String(prior.row[1]).trim() : tx.code;
      const timeline = used.filter(item => sameCode(item.row[1])).map(item => ({ date: item.date, action: item.row[4], shares: Number(item.row[5]), order: item.index }));
      timeline.push({ date: tx.date, action: tx.action, shares: tx.shares, order: rows.length });
      timeline.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
      let held = 0;
      for (const item of timeline) {
        if (!['買入', '賣出'].includes(item.action) || !Number.isFinite(item.shares) || item.shares <= 0) return { status: 'invalid' };
        held += item.action === '買入' ? item.shares : -item.shares;
        if (held < 0) return { status: 'invalid' };
      }
      const settings = getFeeSettings(ss);
      const amount = tx.shares * tx.price;
      const discount = tx.action === '買入' ? settings.buyDiscount : settings.sellDiscount;
      const fee = tx.fee === null ? Math.max(settings.minFee, Math.round(amount * 0.001425 * discount)) : tx.fee;
      const tax = tx.tax === null ? tx.action === '賣出' ? Math.round(amount * 0.003) : 0 : tx.tax;
      if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(tax) || tax < 0) return { status: 'invalid' };
      target = later ? later.index + 2 : last + 1;
      if (later) sh.insertRowBefore(target);
      if (idHeader === '') sh.getRange(1, 12).setValue('藏股交易ID');
      const literal = text => /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
      sh.getRange(target, 2).setNumberFormat('@');
      sh.getRange(target, 1, 1, 12).setValues([[
        new Date(tx.date + 'T00:00:00+08:00'), storedCode, literal(tx.name), tx.market, tx.action, tx.shares, tx.price, fee, tax,
        Math.round(tx.action === '買入' ? amount + fee : amount - fee - tax), literal(tx.note), fingerprint,
      ]]);
      SpreadsheetApp.flush(); // Transaction and durable request ID are written together before recomputing.
    }
    let inventoryUpdated = false;
    try {
      sh.getRange(target, 1).setNumberFormat('yyyy/MM/dd');
      const holdings = calcHoldings(ss);
      const prices = fetchPrices(holdings);
      // Keep an existing quote when its upstream request fails.
      if (summary.getLastRow() > 1) summary.getRange(2, 1, summary.getLastRow() - 1, 6).getValues().forEach(row => {
        if (!(prices[String(row[0])] > 0) && Number(row[5]) > 0) prices[String(row[0])] = Number(row[5]);
      });
      if (Object.keys(holdings).some(code => holdings[code].lots.some(lot => lot.remaining > 0) && !(prices[code] > 0))) throw new Error('Quote unavailable');
      const totals = fetchAndSaveDividends(ss, holdings, readTxList(ss));
      // The outer ScriptLock covers both the transaction and the original FIFO rebuild.
      writeSummaryContents_(ss, holdings, prices, totals);
      SpreadsheetApp.flush();
      inventoryUpdated = true;
    } catch (error) { console.warn('Transaction saved; portfolio rebuild pending.'); }
    return { status: 'success', row: target, inventoryUpdated: inventoryUpdated };
  } finally { lock.releaseLock(); }
}

function stockfolioTransactionCode_(value) {
  const code = String(value).trim().toUpperCase();
  return ({ '50': '0050', '56': '0056', '713': '00713', '919': '00919', '935': '00935', '9816': '009816' })[code] || code;
}

function stockfolioTransactionDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'Asia/Taipei', 'yyyy-MM-dd');
  const text = String(value || '').trim().replace(/\//g, '-');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s.*)?$/);
  if (!match) return '';
  const date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : '';
}
