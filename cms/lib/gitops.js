// Git: describe unpublished changes, publish, discard, history, revert, maintenance switch.
import { execFile } from 'node:child_process';
import { existsSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, PUBLIC } from '../../schema/read.js';

const TRACKED = ['content', 'site/public'];

export function git(args, { allowFail = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err && !allowFail) {
        const e = new Error((stderr || err.message).trim());
        e.stderr = stderr;
        return reject(e);
      }
      resolve(allowFail ? { ok: !err, stdout, stderr } : stdout);
    });
  });
}

export async function hasHead() {
  return (await git(['rev-parse', '--verify', 'HEAD'], { allowFail: true })).ok;
}
export async function remoteUrl() {
  const r = await git(['remote', 'get-url', 'origin'], { allowFail: true });
  return r.ok ? r.stdout.trim() : '';
}
export async function currentBranch() {
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
  return r.ok && r.stdout.trim() !== 'HEAD' ? r.stdout.trim() : 'main';
}

async function showHead(path) {
  const r = await git(['show', `HEAD:${path}`], { allowFail: true });
  return r.ok ? r.stdout : null;
}

const LABELS = {
  profile: 'Profile', toolkit: 'Toolkit', settings: 'Settings', status: 'Maintenance page', theme: 'Appearance',
};
const FIELD_NAMES = {
  title: 'title', year: 'year', summary: 'summary', stack: 'stack', live: 'live link', code: 'code link', image: 'image',
  writeup: 'write-up page', show: 'visibility', order: 'order', org: 'organisation', start: 'start date', end: 'end date',
  description: 'description', link: 'link', name: 'name', role: 'role', bio: 'bio', photo: 'photo', details: 'details',
  availability: 'availability', links: 'links', email: 'email', resume: 'résumé', icons: 'icons', iconStyle: 'icon style',
  groups: 'groups', shareImage: 'share image', checkBeforePublish: 'check setting', quickPublish: 'quick publish',
  siteUrl: 'site address', domainRenews: 'renewal date', maintenance: 'maintenance mode', message: 'message', showEmail: 'email', showResume: 'résumé',
  showPhoto: 'photo', showLinks: 'links',
  palette: 'palette', mode: 'light or dark', accent: 'accent colour', fonts: 'fonts', layout: 'layout', density: 'spacing', monogram: 'icon letters',
};

/** Which item a changed file belongs to. */
function itemFor(path) {
  let m;
  if ((m = path.match(/^content\/(profile|toolkit|settings|status|theme)\.json$/))) return { key: m[1], kind: 'single', name: m[1] };
  if (path === 'site/public/favicon.svg') return { key: 'theme', kind: 'single', name: 'theme' };
  if ((m = path.match(/^content\/(projects|experience)\/([a-z0-9-]+)\.(json|md)$/))) return { key: `${m[1]}/${m[2]}`, kind: m[1], slug: m[2] };
  if ((m = path.match(/^site\/public\/images\/projects\/([a-z0-9-]+?)-[0-9a-f]{8}(?:-\d+w)?\.webp$/))) return { key: `projects/${m[1]}`, kind: 'projects', slug: m[1] };
  if ((m = path.match(/^site\/public\/images\/writeups\/(projects|experience)-([a-z0-9-]+?)-[0-9a-f]{8}(?:-\d+w)?\.webp$/))) return { key: `${m[1]}/${m[2]}`, kind: m[1], slug: m[2] };
  if (/^site\/public\/(images\/profile\/|files\/)/.test(path)) return { key: 'profile', kind: 'single', name: 'profile' };
  if (path === 'site/public/og.png') return { key: 'settings', kind: 'single', name: 'settings' };
  return { key: 'other', kind: 'other' };
}

function changedFields(before, after) {
  try {
    const a = before ? JSON.parse(before) : {};
    const b = after ? JSON.parse(after) : {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => FIELD_NAMES[k] || k);
  } catch {
    return [];
  }
}

/** Parse `git status --porcelain` into changed paths. */
async function statusPaths() {
  const out = await git(['status', '--porcelain', '-uall', '--', ...TRACKED]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      let path = line.slice(3).trim();
      if (path.includes(' -> ')) path = path.split(' -> ')[1];
      path = path.replace(/^"|"$/g, '');
      const state = code.includes('?') || code.includes('A') ? 'new' : code.includes('D') ? 'deleted' : 'modified';
      return { path, state };
    })
    .filter((p) => !p.path.endsWith('.gitkeep'));
}

/** Unpublished changes grouped into human-readable items. */
export async function changes() {
  const paths = await statusPaths();
  const items = new Map();
  for (const p of paths) {
    const it = itemFor(p.path);
    if (!items.has(it.key)) items.set(it.key, { ...it, paths: [], what: new Set(), state: 'modified', label: '' });
    const item = items.get(it.key);
    item.paths.push(p.path);
    if (p.path.endsWith('.json')) {
      if (p.state === 'new') item.state = 'new';
      else if (p.state === 'deleted') item.state = 'deleted';
      else {
        const now = readFileSync(join(ROOT, p.path), 'utf8');
        changedFields(await showHead(p.path), now).forEach((f) => item.what.add(f));
      }
    } else if (p.path.endsWith('.md')) item.what.add('write-up');
    else if (/\.(webp|png|jpg)$/.test(p.path) && p.state !== 'deleted') {
      item.what.add(p.path.includes('/writeups/') ? 'write-up image' : p.path.includes('/profile/') ? 'photo' : p.path.endsWith('og.png') ? 'share image' : 'image');
    }
    else if (p.path.endsWith('.pdf')) item.what.add('résumé');
  }
  const list = [];
  for (const item of items.values()) {
    if (item.kind === 'single') item.label = LABELS[item.name];
    else if (item.kind === 'projects' || item.kind === 'experience') {
      const file = join(ROOT, 'content', item.kind, `${item.slug}.json`);
      let title = item.slug;
      try {
        title = JSON.parse(existsSync(file) ? readFileSync(file, 'utf8') : (await showHead(`content/${item.kind}/${item.slug}.json`)) || '{}').title || item.slug;
      } catch {}
      item.label = title;
      item.section = item.kind === 'projects' ? 'Project' : 'Experience';
    } else item.label = 'Other files';
    const what = [...item.what].filter((w) => w !== 'order' || item.what.size === 1);
    item.summary = item.state === 'new' ? 'new' : item.state === 'deleted' ? 'deleted' : what.join(', ') || 'changed';
    delete item.what;
    list.push(item);
  }
  const ahead = await commitsAhead();
  return { items: list, ahead, hasHead: await hasHead() };
}

async function commitsAhead() {
  const r = await git(['rev-list', '--count', '@{u}..HEAD'], { allowFail: true });
  if (r.ok) return Number(r.stdout.trim()) || 0;
  // No upstream yet: everything committed is waiting if there is a remote.
  if (!(await remoteUrl()) || !(await hasHead())) return 0;
  const c = await git(['rev-list', '--count', 'HEAD'], { allowFail: true });
  return c.ok ? Number(c.stdout.trim()) : 0;
}

/** Put the given paths back to the last published version. */
export async function discardPaths(paths) {
  if (!paths.length) return;
  const head = await hasHead();
  const tracked = [];
  for (const p of paths) {
    const inHead = head && (await git(['cat-file', '-e', `HEAD:${p}`], { allowFail: true })).ok;
    if (inHead) tracked.push(p);
    else rmSync(join(ROOT, p), { force: true });
  }
  if (tracked.length) await git(['checkout', 'HEAD', '--', ...tracked]);
}

export function classifyPushError(msg) {
  const m = String(msg);
  if (/could not resolve host|unable to access|failed to connect|timed out|network|Could not read from remote/i.test(m)) return 'network';
  if (/rejected|non-fast-forward|fetch first|Updates were rejected/i.test(m)) return 'behind';
  if (/Authentication failed|Permission denied|403|could not read Username/i.test(m)) return 'auth';
  if (/CONFLICT|could not apply|Merge conflict/i.test(m)) return 'conflict';
  return 'unknown';
}

/** Pull then push. Returns { ok, reason, message }. */
export async function syncUp() {
  const url = await remoteUrl();
  if (!url) return { ok: true, local: true };
  const branch = await currentBranch();
  const hasUpstream = (await git(['rev-parse', '--abbrev-ref', '@{u}'], { allowFail: true })).ok;
  if (hasUpstream) {
    const pull = await git(['pull', '--rebase', '--autostash'], { allowFail: true, timeout: 90000 });
    if (!pull.ok) {
      await git(['rebase', '--abort'], { allowFail: true });
      return { ok: false, reason: classifyPushError(pull.stderr), message: pull.stderr.trim() };
    }
  }
  const push = await git(['push', '-u', 'origin', branch], { allowFail: true, timeout: 90000 });
  if (!push.ok) return { ok: false, reason: classifyPushError(push.stderr), message: push.stderr.trim() };
  return { ok: true };
}

/** Pull latest on launch, keeping local edits. */
export async function pullLatest() {
  if (!(await remoteUrl()) || !(await hasHead())) return { ok: true, skipped: true };
  const hasUpstream = (await git(['rev-parse', '--abbrev-ref', '@{u}'], { allowFail: true })).ok;
  if (!hasUpstream) return { ok: true, skipped: true };
  const r = await git(['pull', '--rebase', '--autostash'], { allowFail: true, timeout: 60000 });
  if (!r.ok) {
    await git(['rebase', '--abort'], { allowFail: true });
    return { ok: false, reason: classifyPushError(r.stderr), message: r.stderr.trim() };
  }
  return { ok: true };
}

export async function commitAll(message) {
  await git(['add', '-A', '--', ...TRACKED]);
  const staged = await git(['diff', '--cached', '--name-only']);
  if (!staged.trim()) return false;
  await git(['commit', '-m', message]);
  return true;
}

export async function commitOnly(paths, message) {
  await git(['add', '--', ...paths]);
  await git(['commit', '-m', message, '--', ...paths]);
}

export async function history(limit = 30) {
  if (!(await hasHead())) return [];
  // Only versions that changed the site's content, not code changes to the CMS itself.
  const out = await git(['log', `-${limit}`, '--date=iso-strict', '--format=%H%x1f%h%x1f%ad%x1f%s', '--', ...TRACKED]);
  return out.split('\n').filter(Boolean).map((l) => {
    const [hash, short, date, message] = l.split('\x1f');
    return { hash, short, date, message };
  });
}

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out;
}

/** Bring content back to how it was at `hash`, as unpublished changes. */
export async function revertTo(hash) {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('Unknown version.');
  const list = (await git(['ls-tree', '-r', '--name-only', hash, '--', ...TRACKED])).split('\n').filter(Boolean);
  const keep = new Set(list);
  for (const f of [...walkFiles(join(ROOT, 'content')), ...walkFiles(PUBLIC)]) {
    if (!keep.has(f) && !f.endsWith('.gitkeep')) rmSync(join(ROOT, f), { force: true });
  }
  await git(['checkout', hash, '--', ...TRACKED]);
  await git(['reset', '-q', '--', ...TRACKED]);
}
