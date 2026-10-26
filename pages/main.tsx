import { createRoot } from 'react-dom/client';
import Portfolio from '../app/portfolio';
import { createBrowserGoogle } from '../lib/browser-google.mjs';
import { createSavedPortfolioApi } from '../lib/portfolio-snapshot.mjs';
import config from './google-config.json';
import '../app/globals.css';

const api = createSavedPortfolioApi({ api: createBrowserGoogle(config) });
const baseUrl = import.meta.env.BASE_URL;
createRoot(document.getElementById('root')!).render(<Portfolio api={api} baseUrl={baseUrl} />);
