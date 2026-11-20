// robots.txt: allow everything and point search engines at the sitemap.
import { readAll } from '../../../schema/read.js';
import { siteBase } from '../../../schema/content.js';

export function GET() {
  const { settings } = readAll();
  const base = siteBase(settings);
  // The sitemap line needs a full address, so it waits until the site has one.
  return new Response(`User-agent: *\nAllow: /\n${base ? `\nSitemap: ${base}/sitemap.xml\n` : ''}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
