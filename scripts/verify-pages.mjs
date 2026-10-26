import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist-pages');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
if (!index.includes('/Stock/assets/') || !index.includes('/Stock/manifest.webmanifest')) throw new Error('GitHub Pages base path is missing');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './') throw new Error('PWA scope is not project-relative');
const forbidden = ['GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY', 'cloudflare:workers', 'google_sessions', 'OAI-Sites-Authorization'];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(html|js|json)$/.test(entry.name)) {
      const text = await readFile(file, 'utf8');
      if (forbidden.some(marker => text.includes(marker))) throw new Error('A server-only dependency was included in the static output');
    }
  }
}
await inspect(root);
console.log('Verified GitHub Pages paths, PWA scope and absence of server credentials.');
