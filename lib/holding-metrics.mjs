const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;

/** Home metrics describe only the remaining position, excluding past sales/dividends. */
export function unrealizedPosition(row) {
  const profitLoss = amount(row[9]);
  const cost = amount(row[6]);
  return { profitLoss, returnRate: cost > 0 ? profitLoss / cost : 0 };
}
