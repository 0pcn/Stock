import type { PortfolioApi } from './portfolio-api';
export function createBrowserGoogle(options: { clientId: string; deploymentId: string }): PortfolioApi;
export function loadGoogleIdentity(): Promise<void>;
