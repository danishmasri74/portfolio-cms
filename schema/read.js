// Reads and validates everything in /content. Shared by the site and the CMS.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemas } from './content.js';

// The site bundler moves this file during builds, so find the repo root by looking
// for content/settings.json from the working directory upwards.
function findRoot() {
  const starts = [process.env.PORTFOLIO_ROOT, process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '..')].filter(Boolean);
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, 'content', 'settings.json'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error('Could not find the portfolio folder (content/settings.json).');
}
export const ROOT = findRoot();
export const CONTENT = join(ROOT, 'content');
export const PUBLIC = join(ROOT, 'site', 'public');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Content added in later versions. A copy made before then has no file yet, so it reads as the defaults.
export const OPTIONAL = ['theme'];

export function readSingle(name) {
  const file = join(CONTENT, `${name}.json`);
  if (OPTIONAL.includes(name) && !existsSync(file)) return schemas[name].parse({});
  return schemas[name].parse(readJson(file));
}

/** Entries of a collection ("projects" | "experience"), sorted by order. Each has slug + writeupText. */
export function readCollection(name, { strict = true } = {}) {
  const dir = join(CONTENT, name);
  if (!existsSync(dir)) return [];
  const items = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const slug = file.slice(0, -5);
    const raw = readJson(join(dir, file));
    const parsed = schemas[name].safeParse(raw);
    if (!parsed.success) {
      if (strict) throw new Error(`content/${name}/${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    const md = join(dir, `${slug}.md`);
    items.push({ ...parsed.data, slug, writeupText: existsSync(md) ? readFileSync(md, 'utf8') : '' });
  }
  return items.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

export function readAll() {
  return {
    profile: readSingle('profile'),
    toolkit: readSingle('toolkit'),
    settings: readSingle('settings'),
    status: readSingle('status'),
    theme: readSingle('theme'),
    projects: readCollection('projects'),
    experience: readCollection('experience'),
  };
}
