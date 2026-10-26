export type Connection = { mode: 'local' | 'hosted' | 'pages'; configured?: boolean; connected?: boolean; configurationError?: string; signInPath?: string; signOutPath?: string; priceRefreshConfigured?: boolean; loginRemembered?: boolean; loginExpiresAt?: number };
export type PortfolioApi = {
  status(): Promise<Connection>;
  read(source: string): Promise<any>;
  refresh(requestId: string): Promise<any>;
  logout(): Promise<any>;
  login?(): Promise<any>;
  initialize?(): Promise<void>;
  subscribe?(listener: () => void): () => void;
};
async function post(path: string, body?: unknown) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), cache: 'no-store' });
  return response.json();
}
export const serverApi: PortfolioApi = {
  async status() { const response = await fetch('/api/auth/google/status', { cache: 'no-store' }); if (!response.ok) throw new Error(); return response.json(); },
  read: source => post('/api/portfolio', { source }),
  refresh: requestId => post('/api/portfolio/refresh-prices', { requestId }),
  logout: () => post('/api/auth/google/logout'),
};
