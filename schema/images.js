// Responsive image helper for the site. The CMS saves smaller copies next to each upload
// (photo-ab12cd34-400w.webp); this builds the srcset so browsers pick the smallest that fits.
import sharp from 'sharp';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { PUBLIC } from './read.js';

const cache = new Map();

/** { src, srcset, width, height } for an image under site/public. Safe for missing files. */
export async function responsive(src) {
  if (!src || !src.endsWith('.webp')) return { src, srcset: undefined, width: undefined, height: undefined };
  if (cache.has(src)) return cache.get(src);
  const file = join(PUBLIC, src);
  let out = { src, srcset: undefined, width: undefined, height: undefined };
  if (existsSync(file)) {
    const { width, height } = await sharp(file).metadata().catch(() => ({}));
    const stem = basename(file, '.webp');
    const dir = dirname(file);
    const urlDir = src.slice(0, src.lastIndexOf('/') + 1);
    const variants = readdirSync(dir)
      .map((f) => f.match(new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)w\\.webp$`)))
      .filter(Boolean)
      .map((m) => ({ url: urlDir + m[0], w: Number(m[1]) }))
      .sort((a, b) => a.w - b.w);
    const parts = variants.map((v) => `${v.url} ${v.w}w`);
    if (width) parts.push(`${src} ${width}w`);
    out = { src, srcset: parts.length > 1 ? parts.join(', ') : undefined, width, height };
  }
  cache.set(src, out);
  return out;
}

/** Add srcset, sizes, lazy loading and dimensions to <img> tags in rendered Markdown. */
export async function enhanceHtmlImages(html, sizes) {
  const tags = [...html.matchAll(/<img\s+src="([^"]+)"([^>]*)>/g)];
  let result = html;
  for (const [tag, src, rest] of tags) {
    const r = await responsive(src);
    const attrs = [`src="${src}"`, rest.trim()];
    if (r.srcset) attrs.push(`srcset="${r.srcset}"`, `sizes="${sizes}"`);
    if (r.width && r.height) attrs.push(`width="${r.width}"`, `height="${r.height}"`);
    attrs.push('loading="lazy"', 'decoding="async"');
    result = result.replace(tag, `<img ${attrs.filter(Boolean).join(' ')}>`);
  }
  return result;
}
