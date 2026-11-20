// sitemap.xml: the home page and every published write-up, for search engines.
import { readAll } from '../../../schema/read.js';
import { siteBase } from '../../../schema/content.js';

export function GET() {
  const { settings, status, projects, experience } = readAll();
  const base = siteBase(settings);
  // Sitemap entries must be full addresses, so it stays empty until the site has one.
  const paths = !base || status.maintenance
    ? []
    : ['/', ...projects.filter((p) => p.show && p.writeup).map((p) => `/projects/${p.slug}/`), ...experience.filter((e) => e.show && e.writeup).map((e) => `/experience/${e.slug}/`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
