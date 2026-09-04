// GitHub Pages has no server-side rewrite rule like Cloudflare's `_redirects`,
// so client-side routes (e.g. /practice) 404 on a hard refresh unless a
// 404.html exists that serves the same SPA shell. Cloudflare/Vercel ignore
// this file and use `public/_redirects` instead.
import { copyFileSync, existsSync } from 'node:fs';

const src = 'dist/index.html';
const dest = 'dist/404.html';

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log(`Copied ${src} -> ${dest} (GitHub Pages SPA fallback)`);
} else {
  console.warn(`${src} not found; skipping SPA fallback copy.`);
}
