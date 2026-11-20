import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

const settings = JSON.parse(readFileSync(new URL('../content/settings.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: settings.siteUrl || undefined,
  server: { port: 4321, host: '127.0.0.1' },
  devToolbar: { enabled: false },
  vite: {
    server: { fs: { allow: ['..'] } },
  },
});
