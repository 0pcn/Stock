export type DividendEntry = { id: number; code: string; name: string; date: string; year: string; month: number; perShare: number; shares: number; amount: number };
export function dividendCode(value: unknown): string;
export function dividendDate(value: unknown): string | null;
export function dividendEntries(rows: (string | number | null)[][]): DividendEntry[];
export function dividendTotal(entries: DividendEntry[]): number;
export function dividendMonths(entries: DividendEntry[]): { month: number; amount: number; count: number }[];
export function dividendStocks(entries: DividendEntry[]): { code: string; name: string; amount: number; count: number }[];
