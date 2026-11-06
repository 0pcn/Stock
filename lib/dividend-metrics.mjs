const aliases = { '50': '0050', '56': '0056', '713': '00713', '919': '00919', '935': '00935', '9816': '009816' };
const numeric = value => value !== null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const dividendCode = value => aliases[String(value).trim()] || String(value ?? '').trim().toUpperCase();

/** The source contains ex-dividend dates, not payment dates. Never infer cash receipt dates. */
export function dividendDate(value) {
  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    text = new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  } else text = String(value ?? '').trim();
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:$|[T\s])/.exec(text);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dividendEntries(rows) {
  return rows.slice(1).flatMap((row, index) => {
    const code = dividendCode(row[0]), date = dividendDate(row[2]), amount = numeric(row[5]);
    if (!code || code.includes('合計') || !date || amount === null) return [];
    return [{ id: index, code, name: typeof row[1] === 'number' ? dividendCode(row[1]) : String(row[1] || code), date, year: date.slice(0, 4), month: Number(date.slice(5, 7)), perShare: numeric(row[3]) ?? 0, shares: numeric(row[4]) ?? 0, amount }];
  }).sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
}
export const dividendTotal = entries => entries.reduce((sum, entry) => sum + entry.amount, 0);
export function dividendMonths(entries) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1, records = entries.filter(entry => entry.month === month);
    return { month, amount: dividendTotal(records), count: records.length };
  });
}
export function dividendStocks(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.code) || { code: entry.code, name: entry.name, amount: 0, count: 0 };
    group.amount += entry.amount; group.count++; groups.set(entry.code, group);
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code));
}
