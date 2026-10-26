import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./pages', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  // Project Pages lives under /Stock/. All app/PWA paths stay inside this scope.
  base: '/Stock/',
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)), emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
