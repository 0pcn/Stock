import type { PortfolioApi, SavedPortfolio } from './portfolio-api';
export function rowsFrom(result: any): (string | number | null)[][];
export function createSavedPortfolioApi(options: { api: PortfolioApi }): PortfolioApi;
export function createPortfolioSnapshot(): { load(): Promise<SavedPortfolio>; reload(): Promise<void>; save(source: string, rows: (string | number | null)[][], savedAt: number): Promise<boolean>; clear(): Promise<boolean> };
