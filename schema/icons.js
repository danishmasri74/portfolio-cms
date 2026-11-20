// Icon lookup shared by the site and the CMS.
// Logos: Simple Icons (CC0). Generic icons: Lucide (ISC).
import * as simpleIcons from 'simple-icons';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const lucideDir = join(dirname(require.resolve('lucide-static/package.json')), 'icons');

let siList;
function logos() {
  if (!siList) siList = Object.values(simpleIcons).filter((i) => i && i.slug && i.path);
  return siList;
}
let lucideNames;
function generics() {
  if (!lucideNames) lucideNames = readdirSync(lucideDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  return lucideNames;
}

const norm = (s) => String(s).toLowerCase().replace(/\.js$/, 'js').replace(/[^a-z0-9+#]/g, '');

// Common names people type that differ from the icon's title.
const ALIASES = {
  node: 'nodedotjs', nodejs: 'nodedotjs', express: 'express', expressjs: 'express', vue: 'vuedotjs', next: 'nextdotjs',
  nextjs: 'nextdotjs', nuxt: 'nuxt', postgres: 'postgresql', mongo: 'mongodb', js: 'javascript', ts: 'typescript',
  golang: 'go', 'c#': 'csharp', csharp: 'csharp', 'c++': 'cplusplus', cpp: 'cplusplus', aws: 'amazonwebservices',
  tailwind: 'tailwindcss', bash: 'gnubash', vscode: 'visualstudiocode', k8s: 'kubernetes', html: 'html5', css: 'css',
  java: 'openjdk', sql: null,
};
const GENERIC_FALLBACK = { sql: 'database', database: 'database', api: 'webhook', testing: 'flask-conical', linux: null };

/** Inline SVG string for a stored icon, or '' if it can't be found. */
export function iconSvg(icon) {
  if (!icon) return '';
  if (icon.set === 'si') {
    const i = logos().find((x) => x.slug === icon.name);
    return i ? `<svg viewBox="0 0 24 24" role="img" aria-hidden="true" fill="currentColor"><path d="${i.path}"/></svg>` : '';
  }
  try {
    return readFileSync(join(lucideDir, `${icon.name}.svg`), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s(width|height)="24"/g, '')
      .replace('<svg', '<svg aria-hidden="true"');
  } catch {
    return '';
  }
}

export function iconHex(icon) {
  if (!icon || icon.set !== 'si') return null;
  const i = logos().find((x) => x.slug === icon.name);
  return i ? `#${i.hex}` : null;
}

/** Best automatic icon for an item name, or null. */
export function matchIcon(name) {
  const n = norm(name);
  if (!n) return null;
  if (n in ALIASES) {
    const a = ALIASES[n];
    if (a && logos().some((x) => x.slug === a)) return { set: 'si', name: a };
  }
  const exact = logos().find((x) => x.slug === n || norm(x.title) === n);
  if (exact) return { set: 'si', name: exact.slug };
  const g = GENERIC_FALLBACK[n];
  if (g) return { set: 'lucide', name: g };
  if (generics().includes(n)) return { set: 'lucide', name: n };
  return null;
}

/** Search both sets. kind: 'all' | 'si' | 'lucide'. Returns [{set,name,title,svg}] */
export function searchIcons(query, kind = 'all', limit = 40) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const q = norm(query);
  const results = [];
  const score = (title, slug) => {
    const t = title.toLowerCase();
    if (!q) return 1;
    if (norm(t) === q || slug === q) return 100;
    if (norm(t).startsWith(q) || slug.startsWith(q)) return 60;
    let s = 0;
    for (const w of words) {
      const nw = norm(w);
      if (!nw) continue;
      if (slug.includes(nw) || norm(t).includes(nw)) s += 20;
    }
    return s;
  };
  if (kind !== 'lucide') {
    for (const i of logos()) {
      const s = score(i.title, i.slug);
      if (s > 0) results.push({ s: s + 1, set: 'si', name: i.slug, title: i.title });
    }
  }
  if (kind !== 'si') {
    for (const name of generics()) {
      const title = name.replace(/-/g, ' ');
      const s = score(title, name.replace(/-/g, ''));
      if (s > 0) results.push({ s, set: 'lucide', name, title: title[0].toUpperCase() + title.slice(1) });
    }
  }
  results.sort((a, b) => b.s - a.s || a.title.localeCompare(b.title));
  return results.slice(0, limit).map(({ s, ...r }) => ({ ...r, svg: iconSvg(r) }));
}
