import { loadEnv } from 'vite';
import { createLocalGoogleMiddleware } from '../local-google/server.mjs';

/** Development-only OAuth server. Secrets stay in this Node process. */
export function localGoogleSheets({ enabled = true } = {}) {
  let root;
  let mode;
  return {
    name: 'stockfolio-local-google',
    apply: 'serve',
    configResolved(config) { root = config.root; mode = config.mode; },
    configureServer(server) {
      if (!enabled) return;
      const env = { ...loadEnv(mode, root, ''), ...process.env };
      server.middlewares.use(createLocalGoogleMiddleware({ root, env }));
    },
  };
}
