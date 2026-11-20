// Uploads: resize to WebP, store under site/public, generate the share image, clean up unused files.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PUBLIC } from '../../schema/read.js';
import { slugify } from '../../schema/content.js';
import { themeColors, resolveTheme } from '../../schema/theme.js';
import { allContentText } from './store.js';

const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);
const MAX_UPLOAD = 15 * 1024 * 1024;

export class UploadError extends Error {}

async function toWebp(buf, { width, height, fit = 'inside' }) {
  try {
    const img = sharp(buf, { failOn: 'error' }).rotate();
    const out = await img.resize({ width, height, fit, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return out;
  } catch {
    throw new UploadError("That file isn't an image the CMS can read. Use a JPG, PNG or WebP.");
  }
}

/** kind: project | photo | writeup | resume | og */
export async function saveUpload(kind, file, { collection = 'projects', slug = 'item', ownerName = 'resume' } = {}) {
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) throw new UploadError('That file is empty.');
  if (buf.length > MAX_UPLOAD) throw new UploadError('That file is over 15 MB. Use a smaller one.');
  const safeSlug = slugify(slug);

  if (kind === 'resume') {
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new UploadError('The résumé needs to be a PDF.');
    const name = `${slugify(ownerName)}-resume.pdf`;
    mkdirSync(join(PUBLIC, 'files'), { recursive: true });
    // Remove older résumés so only one is ever published.
    for (const f of readdirSync(join(PUBLIC, 'files'))) if (f.endsWith('.pdf')) rmSync(join(PUBLIC, 'files', f));
    writeFileSync(join(PUBLIC, 'files', name), buf);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
    return { src: `/files/${name}`, size: buf.length, pages, updated: new Date().toISOString().slice(0, 10) };
  }

  if (kind === 'og') {
    const out = await sharp(buf).resize(1200, 630, { fit: 'cover' }).png().toBuffer().catch(() => {
      throw new UploadError("That file isn't an image the CMS can read. Use a JPG, PNG or WebP.");
    });
    writeFileSync(join(PUBLIC, 'og.png'), out);
    return { src: '/og.png', size: out.length, width: 1200, height: 630 };
  }

  const opts = {
    project: { dir: 'images/projects', prefix: safeSlug, width: 1600, height: 1600 },
    photo: { dir: 'images/profile', prefix: 'photo', width: 900, height: 900 },
    writeup: { dir: 'images/writeups', prefix: `${collection}-${safeSlug}`, width: 1600, height: 2000 },
  }[kind];
  if (!opts) throw new UploadError('Unknown upload type.');
  const { data, info } = await toWebp(buf, opts);
  const name = `${opts.prefix}-${hash(data)}.webp`;
  mkdirSync(join(PUBLIC, opts.dir), { recursive: true });
  writeFileSync(join(PUBLIC, opts.dir, name), data);
  await makeVariants(`/${opts.dir}/${name}`);
  return { src: `/${opts.dir}/${name}`, size: data.length, width: info.width, height: info.height };
}

// Smaller copies, so the site never downloads a 1600px image for a 200px slot.
const VARIANT_WIDTHS = { 'images/projects': [400, 800], 'images/writeups': [480, 960], 'images/profile': [240, 480] };

/** Create name-400w.webp style copies next to an uploaded image. Skips sizes that already exist. */
export async function makeVariants(pub) {
  const dir = Object.keys(VARIANT_WIDTHS).find((d) => pub.startsWith(`/${d}/`));
  if (!dir || !pub.endsWith('.webp') || /-\d+w\.webp$/.test(pub)) return;
  const file = join(PUBLIC, pub);
  if (!existsSync(file)) return;
  const { width } = await sharp(file).metadata();
  for (const w of VARIANT_WIDTHS[dir]) {
    if (!width || w >= width) continue;
    const out = file.replace(/\.webp$/, `-${w}w.webp`);
    if (existsSync(out)) continue;
    await sharp(file).resize({ width: w }).webp({ quality: 80 }).toFile(out);
  }
}

/** Make sure every image the content uses has its smaller copies (covers images uploaded before this existed). */
export async function ensureAllVariants() {
  const refs = new Set(allContentText().match(/\/images\/[\w\-./]+\.webp/g) || []);
  for (const pub of refs) await makeVariants(pub).catch(() => {});
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The colours a theme shows first: dark for "dark", light for "light" and "auto".
const firstLook = (theme) => {
  const t = resolveTheme(theme);
  return themeColors(t)[t.mode === 'dark' ? 'dark' : 'light'];
};
const serif = (theme) => resolveTheme(theme).fonts === 'editorial';

/** Share image generated from name, role and domain, in the theme's colours. */
export async function generateShareImage(profile, settings, theme) {
  const c = firstLook(theme);
  const face = serif(theme) ? 'Georgia, Times New Roman, serif' : 'Segoe UI, Helvetica, Arial, sans-serif';
  const domain = (settings.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Shrink the text for long names and roles so nothing runs off the 1200px canvas (about 0.56em per character).
  const fit = (text, max, width = 1008) => Math.max(36, Math.min(max, Math.floor(width / (String(text).length * 0.56))));
  const nameSize = fit(profile.name, 84);
  const roleSize = fit(profile.role, 38);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${c.bg}"/>
  <rect x="0" y="0" width="1200" height="630" fill="none" stroke="${c.rule}" stroke-width="2"/>
  <text x="96" y="300" font-family="${face}" font-size="${nameSize}" font-weight="600" fill="${c.text}">${esc(profile.name)}</text>
  <text x="96" y="372" font-family="${face}" font-size="${roleSize}" fill="${c.muted}">${esc(profile.role)}</text>
  <text x="96" y="534" font-family="Consolas, Menlo, monospace" font-size="28" fill="${c.accent}">${esc(domain)}</text>
</svg>`;
  const out = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(join(PUBLIC, 'og.png'), out);
}

// ---------- favicon ----------
const FAVICON = join(PUBLIC, 'favicon.svg');
const GENERATED = 'data-generated="cms"';

/** Letters for the favicon: the theme's own, or the first letters of the first and last name. */
export function monogram(profile, theme) {
  const own = String(resolveTheme(theme).monogram || '').trim();
  if (own) return own.slice(0, 2);
  const words = String(profile.name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '•';
  return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
}

/** True when the CMS made the current favicon, so it's safe to replace when the name changes. */
export function faviconIsGenerated() {
  try {
    return readFileSync(FAVICON, 'utf8').includes(GENERATED);
  } catch {
    return true;
  }
}

/** Favicon: the monogram in the theme's colours, shaped like the profile photo. */
export function generateFavicon(profile, theme) {
  const t = resolveTheme(theme);
  const c = firstLook(t);
  const letters = monogram(profile, t);
  const shape = t.photo === 'circle' ? '<circle cx="32" cy="32" r="32"' : `<rect width="64" height="64" rx="${t.photo === 'square' ? 0 : 12}"`;
  const size = letters.length > 1 ? 26 : 34;
  const face = serif(t) ? 'Georgia, Times New Roman, serif' : 'Arial, Helvetica, sans-serif';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" ${GENERATED}>${shape} fill="${c.text}"/><text x="32" y="${letters.length > 1 ? 41 : 44}" text-anchor="middle" font-family="${face}" font-size="${size}" font-weight="700" fill="${c.bg}">${esc(letters)}</text></svg>
`;
  writeFileSync(FAVICON, svg);
}

/** Delete uploaded files that no content refers to any more. Returns removed public paths. */
export function removeUnusedUploads() {
  const text = allContentText();
  const removed = [];
  for (const dir of ['images/projects', 'images/profile', 'images/writeups', 'images/experience', 'files']) {
    const abs = join(PUBLIC, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (f.startsWith('.') || !statSync(join(abs, f)).isFile()) continue;
      const pub = '/' + relative(PUBLIC, join(abs, f)).replace(/\\/g, '/');
      // A smaller copy (name-400w.webp) belongs to its original.
      const owner = pub.replace(/-\d+w(\.webp)$/, '$1');
      if (!text.includes(owner)) {
        rmSync(join(abs, f));
        removed.push(pub);
      }
    }
  }
  return removed;
}
