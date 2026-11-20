// Reading and writing content files, with validation.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { schemas, fieldErrors, slugify } from '../../schema/content.js';
import { CONTENT, readCollection, readSingle } from '../../schema/read.js';
import { matchIcon } from '../../schema/icons.js';

export const SINGLES = ['profile', 'toolkit', 'settings', 'status', 'theme', 'sections'];
export const COLLECTIONS = ['projects', 'experience'];

const jsonPath = (name) => join(CONTENT, `${name}.json`);
const entryPath = (col, slug, ext = 'json') => join(CONTENT, col, `${slug}.${ext}`);
const write = (file, data) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
};
const validSlug = (s) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(s);

export class ValidationError extends Error {
  constructor(fields) {
    super('Some fields need fixing.');
    this.fields = fields;
  }
}

function validate(name, data) {
  const r = schemas[name].safeParse(data);
  if (!r.success) throw new ValidationError(fieldErrors(r.error));
  return r.data;
}

export function getSingle(name) {
  return readSingle(name);
}

export function saveSingle(name, data) {
  if (name === 'toolkit') {
    // Give new items an icon automatically when the name matches one.
    for (const g of data.groups || []) for (const it of g.items || []) if (it.icon === undefined) it.icon = matchIcon(it.name);
  }
  const clean = validate(name, data);
  write(jsonPath(name), clean);
  return clean;
}

export function listCollection(col) {
  return readCollection(col, { strict: false }).map(({ writeupText, ...e }) => ({ ...e, hasWriteupText: !!writeupText.trim() }));
}

export function getEntry(col, slug) {
  if (!validSlug(slug) || !existsSync(entryPath(col, slug))) return null;
  const data = schemas[col].parse(JSON.parse(readFileSync(entryPath(col, slug), 'utf8')));
  return { ...data, slug };
}

function uniqueSlug(col, base) {
  let slug = slugify(base);
  let n = 2;
  while (existsSync(entryPath(col, slug))) slug = `${slugify(base)}-${n++}`;
  return slug;
}

export function createEntry(col, data) {
  const existing = listCollection(col);
  const clean = validate(col, { ...data, order: data.order ?? (existing.length ? Math.min(...existing.map((e) => e.order)) - 1 : 1) });
  const slug = uniqueSlug(col, clean.title);
  write(entryPath(col, slug), clean);
  return { ...clean, slug };
}

export function saveEntry(col, slug, data) {
  if (!validSlug(slug) || !existsSync(entryPath(col, slug))) throw new Error('Not found');
  const { slug: _s, hasWriteupText: _h, ...rest } = data;
  const clean = validate(col, rest);
  write(entryPath(col, slug), clean);
  return { ...clean, slug };
}

export function deleteEntry(col, slug) {
  if (!validSlug(slug)) throw new Error('Not found');
  rmSync(entryPath(col, slug), { force: true });
  rmSync(entryPath(col, slug, 'md'), { force: true });
}

export function reorder(col, slugs) {
  slugs.forEach((slug, i) => {
    const e = getEntry(col, slug);
    if (!e) return;
    const { slug: _s, ...data } = e;
    write(entryPath(col, slug), { ...data, order: i + 1 });
  });
}

export function getWriteup(col, slug) {
  const f = entryPath(col, slug, 'md');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

export function saveWriteup(col, slug, text) {
  if (!validSlug(slug) || !existsSync(entryPath(col, slug))) throw new Error('Not found');
  const f = entryPath(col, slug, 'md');
  if (!text.trim()) rmSync(f, { force: true });
  else writeFileSync(f, text.replace(/\r\n/g, '\n').trimEnd() + '\n', 'utf8');
}

/** A fingerprint of the content files (names and times changed), so the CMS notices edits made elsewhere. */
export function contentStamp() {
  let s = '';
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else s += `${p}:${statSync(p).mtimeMs};`;
    }
  };
  try {
    walk(CONTENT);
  } catch {}
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

/** All text in content, used to find which uploaded files are still referenced. */
export function allContentText() {
  let text = '';
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(json|md)$/.test(f.name)) text += readFileSync(p, 'utf8') + '\n';
    }
  };
  walk(CONTENT);
  return text;
}
