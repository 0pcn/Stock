export type HoldingReturnContext = { tab: 'holdings' | 'overview'; query: string; market: string; sort: string; filtersOpen: boolean; scrollY: number; focusCode: string };
export type HoldingNavigation = { open(code: string, view: Omit<HoldingReturnContext, 'scrollY' | 'focusCode'>): void; back(): void; reset(): void; dispose(): void };
export function holdingRoute(hash: string): string | null;
export function createHoldingNavigation(options: { browser?: Window; onChange: (change: { code: string | null; context: HoldingReturnContext | null; restore: boolean }) => void }): HoldingNavigation;
