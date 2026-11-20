// Portfolio CMS: a local-only server. Run with `npm run cms` or the desktop shortcut.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { exec, execFile } from 'node:child_process';
import { relative, join } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, readAll } from '../schema/read.js';
import { searchIcons, matchIcon, iconSvg, iconHex } from '../schema/icons.js';
import { siteBase, schemas } from '../schema/content.js';
import { PALETTES, FONTS, ACCENTS, DEFAULT_THEME, themeCss, themeColors, contrast } from '../schema/theme.js';
import * as store from './lib/store.js';
import * as images from './lib/images.js';
import * as gitops from './lib/gitops.js';
import * as preview from './lib/preview.js';
import * as setup from './lib/setup.js';
import * as hosting from './lib/hosting.js';
import * as github from './lib/github.js';
import { checkLinks } from './lib/links.js';
import { domainExpiry } from './lib/domain.js';

const PORT = Number(process.env.CMS_PORT || 4000);
const HOST = '127.0.0.1';
const APP_ID = 'portfolio-cms';
const STAY = process.argv.includes('--stay') || process.env.CMS_STAY === '1';
const NO_OPEN = process.argv.includes('--no-open') || process.env.CMS_NO_OPEN === '1';
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

// ---------- single instance ----------
try {
  const res = await fetch(`http://${HOST}:${PORT}/api/ping`, { signal: AbortSignal.timeout(800) });
  if ((await res.json()).app === APP_ID) {
    openWindow();
    process.exit(0);
  }
} catch {}

const app = new Hono();
let lastPing = 0;
let sync = { state: 'idle', at: null, message: '' };
let busy = null; // 'publishing' | 'checking' | null

const ok = (c, data = {}) => c.json({ ok: true, ...data });
const fail = (c, message, extra = {}, status = 400) => c.json({ ok: false, message, ...extra }, status);

app.onError((err, c) => {
  if (err instanceof store.ValidationError) return fail(c, err.message, { fields: err.fields }, 422);
  if (err instanceof images.UploadError) return fail(c, err.message, {}, 400);
  console.error(err);
  return fail(c, err.message || 'Something went wrong.', {}, 500);
});

// Only accept requests from this app's own page.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) return fail(c, 'Forbidden', {}, 403);
  }
  await next();
});

// ---------- basics ----------
app.get('/api/ping', (c) => c.json({ app: APP_ID }));
// Each open window has its own id, so closing one window doesn't stop the CMS for another.
const windows = new Map();
app.post('/api/ping', async (c) => {
  const { id } = await c.req.json().catch(() => ({}));
  lastPing = Date.now();
  if (id) windows.set(String(id), lastPing);
  clearTimeout(closeTimer);
  closeTimer = null;
  return ok(c);
});
// The window sends this when it closes. Wait a moment in case it was only a reload.
let closeTimer = null;
app.post('/api/bye', async (c) => {
  const id = await c.req.text().catch(() => '');
  if (id) windows.delete(id);
  // Forget windows that haven't been heard from in 30 minutes.
  for (const [k, t] of windows) if (Date.now() - t > 30 * 60 * 1000) windows.delete(k);
  if (!STAY && windows.size === 0) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (busy || windows.size ? null : shutdown()), 20000);
  }
  return ok(c);
});
// Open outside links in the default browser instead of the CMS window's browser.
app.post('/api/open', async (c) => {
  const { url } = await c.req.json().catch(() => ({}));
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(String(url || ''))) return fail(c, 'That link can’t be opened.');
  if (process.platform === 'win32') execFile('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  return ok(c);
});
app.post('/api/quit', (c) => {
  setTimeout(shutdown, 150);
  return ok(c);
});

app.get('/api/state', async (c) => {
  const cfg = setup.readConfig();
  return ok(c, {
    setupDone: !!cfg.setupDone,
    startHidden: !!cfg.startHidden,
    profile: store.getSingle('profile'),
    toolkit: store.getSingle('toolkit'),
    settings: store.getSingle('settings'),
    status: store.getSingle('status'),
    projects: store.listCollection('projects'),
    experience: store.listCollection('experience'),
    preview: preview.previewState(),
    sync,
    remote: await gitops.remoteUrl(),
    branch: await gitops.currentBranch(),
    root: ROOT,
    previewPort: cfg.previewPort || 4321,
  });
});

app.get('/api/changes', async (c) => ok(c, { ...(await gitops.changes()), undeployed: await hosting.undeployed(), hosted: hosting.isConfigured(), busy, sync }));

// ---------- singles ----------
const shareImage = () => images.generateShareImage(store.getSingle('profile'), store.getSingle('settings'), store.getSingle('theme'));
for (const name of ['profile', 'toolkit', 'settings', 'theme', 'sections']) {
  app.get(`/api/${name}`, (c) => ok(c, { data: store.getSingle(name) }));
  app.put(`/api/${name}`, async (c) => {
    const data = store.saveSingle(name, await c.req.json());
    if (['profile', 'settings', 'theme'].includes(name) && store.getSingle('settings').shareImage === 'generated') await shareImage().catch(() => {});
    // The favicon follows the theme, and the name too unless the owner put in their own icon file.
    if (name === 'theme' || (name === 'profile' && images.faviconIsGenerated())) {
      try {
        images.generateFavicon(store.getSingle('profile'), store.getSingle('theme'));
      } catch {}
    }
    return ok(c, { data });
  });
}
app.post('/api/theme/preview', async (c) => {
  const parsed = schemas.theme.safeParse(await c.req.json().catch(() => ({})));
  const t = parsed.success ? parsed.data : schemas.theme.parse({});
  const colors = themeColors(t);
  return ok(c, {
    css: themeCss(t),
    attrs: { layout: t.layout, photo: t.photo, density: t.density, projects: t.projects, links: t.links, accent: t.accentStrength, motion: String(t.motion) },
    contrast: contrast(t.accent, colors.light.bg),
    darkAccent: colors.dark.accent,
  });
});
app.get('/api/theme/options', (c) => ok(c, { palettes: PALETTES, fonts: FONTS, accents: ACCENTS, defaults: DEFAULT_THEME, monogram: images.monogram(store.getSingle('profile'), {}) }));
// Maintenance page content is saved normally; the on/off switch publishes on its own (see /api/maintenance).
app.put('/api/status', async (c) => {
  const body = await c.req.json();
  const current = store.getSingle('status');
  return ok(c, { data: store.saveSingle('status', { ...body, maintenance: current.maintenance }) });
});

// ---------- collections ----------
for (const col of store.COLLECTIONS) {
  app.get(`/api/${col}`, (c) => ok(c, { items: store.listCollection(col) }));
  app.post(`/api/${col}`, async (c) => ok(c, { data: store.createEntry(col, await c.req.json()) }));
  app.put(`/api/${col}/order`, async (c) => {
    store.reorder(col, (await c.req.json()).slugs || []);
    return ok(c);
  });
  app.get(`/api/${col}/:slug`, (c) => {
    const e = store.getEntry(col, c.req.param('slug'));
    return e ? ok(c, { data: e, writeup: store.getWriteup(col, e.slug) }) : fail(c, 'Not found', {}, 404);
  });
  app.put(`/api/${col}/:slug`, async (c) => ok(c, { data: store.saveEntry(col, c.req.param('slug'), await c.req.json()) }));
  app.delete(`/api/${col}/:slug`, (c) => {
    store.deleteEntry(col, c.req.param('slug'));
    return ok(c);
  });
  app.put(`/api/${col}/:slug/writeup`, async (c) => {
    store.saveWriteup(col, c.req.param('slug'), (await c.req.json()).text || '');
    return ok(c);
  });
}

// ---------- uploads ----------
app.post('/api/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === 'string') return fail(c, 'Choose a file to upload.');
  const kind = String(body.kind || '');
  const result = await images.saveUpload(kind, file, {
    collection: String(body.collection || 'projects'),
    slug: String(body.slug || 'item'),
    ownerName: store.getSingle('profile').name,
  });
  return ok(c, result);
});

// ---------- icons ----------
app.get('/api/icons', (c) => ok(c, { results: searchIcons(c.req.query('q') || '', c.req.query('kind') || 'all', 48) }));
app.post('/api/icons/match', async (c) => {
  const { names = [] } = await c.req.json();
  return ok(c, { results: names.map((n) => matchIcon(n)) });
});
app.post('/api/icons/svg', async (c) => {
  const { icons = [] } = await c.req.json();
  return ok(c, { svgs: icons.map((i) => iconSvg(i)), hexes: icons.map((i) => iconHex(i)) });
});

// ---------- check / publish ----------
async function check() {
  try {
    readAll();
  } catch (e) {
    return { ok: false, seconds: 0, message: e.message, log: e.message };
  }
  const r = await preview.runBuildCheck();
  const warnings = [];
  if (!siteBase(store.getSingle('settings'))) warnings.push('No site address yet, so share previews and the sitemap are left out. Create the site in Hosting, or enter the address in Settings.');
  return { ...r, warnings, message: r.ok ? 'All pages generated' : firstError(r.log) };
}
function firstError(log) {
  const lines = log.split('\n');
  const i = lines.findIndex((l) => /error|ENOENT|not found|failed/i.test(l));
  return (i >= 0 ? lines.slice(i, i + 2).join(' ') : lines.slice(-2).join(' ')).trim().slice(0, 300);
}

app.post('/api/check', async (c) => {
  if (busy) return fail(c, `Wait until ${busy} finishes.`);
  busy = 'checking';
  try {
    // Build and link check run side by side.
    const [build, links] = await Promise.all([check(), checkLinks().catch(() => null)]);
    return ok(c, { check: { ...build, links } });
  } finally {
    busy = null;
  }
});

function defaultMessage(items) {
  const names = items.map((i) => (i.kind === 'single' ? i.label.toLowerCase() : i.label));
  if (!names.length) return 'Update site';
  if (names.length === 1) return `Update ${names[0]}`;
  return `Update ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`.slice(0, 120);
}

// After committing: push to GitHub as a backup, then upload to Cloudflare if hosting is set up.
async function goLive() {
  const up = await gitops.syncUp();
  sync = { state: up.local ? 'local' : up.ok ? 'ok' : 'error', at: new Date().toISOString(), message: up.message || '' };
  const backupFailed = !up.ok && !up.local ? up.reason : null;
  if (hosting.isConfigured()) {
    if (!(await hosting.undeployed())) return { result: 'published', at: new Date().toISOString(), backupFailed };
    try {
      const d = await hosting.deploy();
      return { result: 'published', at: d.at, url: d.url, backupFailed };
    } catch (e) {
      return { result: 'deploy-failed', reason: e.reason || 'unknown', message: e.message, backupFailed };
    }
  }
  if (up.local) return { result: 'local' };
  if (!up.ok) return { result: 'push-failed', reason: up.reason, message: up.message };
  return { result: 'published', at: sync.at };
}

app.post('/api/publish', async (c) => {
  if (busy) return fail(c, `Wait until ${busy} finishes.`);
  const body = await c.req.json().catch(() => ({}));
  busy = 'publishing';
  try {
    const settings = store.getSingle('settings');
    images.removeUnusedUploads();
    const { items, ahead } = await gitops.changes();
    const pending = await hosting.undeployed();
    if (!items.length && !ahead && !pending) return ok(c, { result: 'nothing' });
    // Publish always checks the site first.
    if (items.length) {
      const r = await check();
      if (!r.ok) return ok(c, { result: 'check-failed', check: r });
    }
    if (items.length) await gitops.commitAll((body.message || '').trim() || defaultMessage(items));
    return ok(c, await goLive());
  } finally {
    busy = null;
  }
});

app.post('/api/discard', async (c) => {
  const { keys } = await c.req.json().catch(() => ({}));
  const { items, hasHead } = await gitops.changes();
  if (!hasHead) return fail(c, 'Nothing has been published yet, so there is no earlier version to go back to.');
  const chosen = keys ? items.filter((i) => keys.includes(i.key)) : items;
  await gitops.discardPaths(chosen.flatMap((i) => i.paths));
  return ok(c);
});

app.get('/api/history', async (c) => ok(c, { items: await gitops.history() }));
app.post('/api/revert', async (c) => {
  await gitops.revertTo((await c.req.json()).hash);
  return ok(c);
});

app.post('/api/sync/retry', async (c) => {
  if (busy) return fail(c, `Wait until ${busy} finishes.`);
  busy = 'publishing';
  try {
    return ok(c, await goLive());
  } finally {
    busy = null;
  }
});

// Maintenance switch: saves and publishes only content/status.json.
app.post('/api/maintenance', async (c) => {
  if (busy) return fail(c, `Wait until ${busy} finishes.`);
  const { on } = await c.req.json();
  busy = 'publishing';
  try {
    const status = store.saveSingle('status', { ...store.getSingle('status'), maintenance: !!on });
    if (!(await gitops.hasHead())) return ok(c, { result: 'local', status });
    await gitops.commitOnly(['content/status.json'], on ? 'Turn on maintenance mode' : 'Turn off maintenance mode');
    return ok(c, { ...(await goLive()), status });
  } finally {
    busy = null;
  }
});

// ---------- hosting (Cloudflare Pages) ----------
const hostingCall = (fn) => async (c) => {
  try {
    return await fn(c);
  } catch (e) {
    if (e instanceof hosting.HostingError) return fail(c, e.message, { reason: e.reason }, 400);
    throw e;
  }
};
app.get('/api/hosting', hostingCall(async (c) => ok(c, { hosting: await hosting.status() })));
app.post('/api/hosting/login', (c) => {
  hosting.startLogin();
  return ok(c);
});
app.post('/api/hosting/login/cancel', (c) => {
  hosting.cancelLogin();
  return ok(c);
});
app.post('/api/hosting/logout', hostingCall(async (c) => {
  await hosting.logout();
  return ok(c);
}));
// With no domain of its own, the free name.pages.dev address becomes the site address, so links and share previews work.
function usePagesAddress(subdomain) {
  if (!subdomain) return;
  const settings = store.getSingle('settings');
  const current = settings.siteUrl || '';
  if ((!current || /\.pages\.dev\/?$/i.test(current)) && current !== `https://${subdomain}`) {
    store.saveSingle('settings', { ...settings, siteUrl: `https://${subdomain}` });
  }
}
app.post('/api/hosting/project', hostingCall(async (c) => {
  const r = await hosting.createProject(String((await c.req.json()).name || '').trim());
  if (!(setup.readConfig().hosting || {}).domain) usePagesAddress(r.subdomain);
  return ok(c, r);
}));
app.post('/api/hosting/domain', hostingCall(async (c) => {
  const domain = hosting.setDomain((await c.req.json()).domain);
  // Use the domain as the site address, so links and share previews point at it. Goes live on the next publish.
  const settings = store.getSingle('settings');
  if (settings.siteUrl !== `https://${domain}`) store.saveSingle('settings', { ...settings, siteUrl: `https://${domain}` });
  return ok(c, { domain });
}));
app.delete('/api/hosting/domain', hostingCall(async (c) => {
  await hosting.removeDomain();
  // Back to the free name.pages.dev address, or none if the site isn't created yet.
  const sub = (setup.readConfig().hosting || {}).subdomain;
  store.saveSingle('settings', { ...store.getSingle('settings'), siteUrl: sub ? `https://${sub}` : '' });
  return ok(c);
}));
app.post('/api/hosting/deploy', async (c) => {
  if (busy) return fail(c, `Wait until ${busy} finishes.`);
  busy = 'publishing';
  try {
    const d = await hosting.deploy();
    return ok(c, { result: 'published', ...d });
  } catch (e) {
    if (e instanceof hosting.HostingError) return ok(c, { result: 'deploy-failed', reason: e.reason, message: e.message });
    throw e;
  } finally {
    busy = null;
  }
});

// ---------- domain expiry (looked up from the registry) ----------
app.get('/api/domain-expiry', async (c) => ok(c, { expiry: await domainExpiry(store.getSingle('settings').siteUrl, { force: c.req.query('refresh') === '1' }) }));

// ---------- preview ----------
app.get('/api/preview', (c) => ok(c, { preview: preview.previewState() }));
app.post('/api/preview/restart', (c) => ok(c, { preview: preview.restartPreview(setup.readConfig().previewPort || 4321) }));

// ---------- setup ----------
app.get('/api/setup', async (c) => ok(c, { checks: await setup.checks(preview.previewState()), config: setup.readConfig() }));
app.post('/api/setup/init', async (c) => {
  await setup.initRepo();
  return ok(c);
});
app.post('/api/setup/remote', async (c) => {
  await setup.setRemote(String((await c.req.json()).url || '').trim());
  return ok(c);
});
app.post('/api/setup/gh-create', async (c) => {
  const { name, visibility } = await c.req.json();
  await setup.createWithGh(String(name || '').trim(), visibility);
  return ok(c);
});
app.post('/api/setup/shortcut', async (c) => {
  await setup.createShortcut();
  return ok(c);
});
app.post('/api/setup/done', (c) => ok(c, { config: setup.writeConfig({ setupDone: true }) }));
app.post('/api/setup/start-hidden', async (c) => ok(c, { config: setup.writeConfig({ startHidden: !!(await c.req.json()).hidden }) }));

// ---------- welcome (first launch) ----------
app.get('/api/welcome', async (c) => ok(c, { git: await github.hasGit(), preview: preview.previewState() }));
app.post('/api/welcome/install-git', async (c) => {
  const r = await github.installGit();
  return r.ok ? ok(c) : fail(c, r.message);
});
app.post('/api/welcome', async (c) => {
  const { name, role, palette } = await c.req.json();
  if (!(await github.hasGit())) return fail(c, 'Git is needed first.', { reason: 'git' });
  try {
    const profile = store.saveSingle('profile', { ...store.getSingle('profile'), name: String(name || '').trim(), role: String(role || '').trim() });
    const settings = store.getSingle('settings');
    // The sample page title becomes "Name · role". A title someone already wrote stays.
    if (!settings.title || /^your name(\s|$)/i.test(settings.title)) {
      store.saveSingle('settings', { ...settings, title: `${profile.name} · ${profile.role}`.slice(0, 70) });
    }
    const theme = store.getSingle('theme');
    if (['paper', 'warm', 'cool', 'stone'].includes(palette)) store.saveSingle('theme', { ...theme, palette });
    if (palette === 'dark') store.saveSingle('theme', { ...theme, palette: 'paper', mode: 'dark' });
  } catch (e) {
    if (e instanceof store.ValidationError) return fail(c, e.message, { fields: e.fields }, 422);
    throw e;
  }
  try {
    images.generateFavicon(store.getSingle('profile'), store.getSingle('theme'));
  } catch {}
  if (store.getSingle('settings').shareImage === 'generated') await shareImage().catch(() => {});
  await setup.initRepo();
  if (!(await setup.shortcutExists())) await setup.createShortcut().catch(() => {});
  setup.writeConfig({ setupDone: true });
  return ok(c);
});

// ---------- GitHub backup ----------
const ghCall = (fn) => async (c) => {
  try {
    return ok(c, await fn(c));
  } catch (e) {
    return fail(c, e.message);
  }
};
app.get('/api/github', ghCall(() => github.status()));
app.post('/api/github/install', ghCall(async () => {
  const r = await github.installGh();
  if (!r.ok) throw new Error(r.message);
  return {};
}));
app.post('/api/github/login', ghCall(() => github.startLogin()));
app.post('/api/github/login/cancel', ghCall(() => (github.cancelLogin(), {})));
app.post('/api/github/create', ghCall(async (c) => {
  const { name, visibility } = await c.req.json();
  return github.createBackup(String(name || '').trim(), visibility);
}));
app.post('/api/github/use', ghCall(async (c) => github.useExisting(String((await c.req.json()).url || '').trim())));
app.put('/api/setup/config', async (c) => {
  const { previewPort } = await c.req.json();
  const port = Number(previewPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fail(c, 'Use a port between 1024 and 65535.', { fields: { previewPort: 'Use a port between 1024 and 65535.' } }, 422);
  return ok(c, { config: setup.writeConfig({ previewPort: port }) });
});

// ---------- static ----------
// Always check for a newer copy of the CMS's own files, so updates show up without a hard refresh.
app.use('*', async (c, next) => {
  await next();
  if (!c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-cache');
});
app.use('/vendor/alpine.js', serveStatic({ path: rel(join(ROOT, 'node_modules/alpinejs/dist/cdn.min.js')) }));
app.use('/fontsource/*', serveStatic({ root: rel(join(ROOT, 'node_modules/@fontsource')), rewriteRequestPath: (p) => p.replace(/^\/fontsource/, '') }));
app.use('/site/*', serveStatic({ root: 'site/public', rewriteRequestPath: (p) => p.replace(/^\/site/, '') }));
app.use('/*', serveStatic({ root: 'cms/public' }));

// ---------- start ----------
process.chdir(ROOT);
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Portfolio CMS running at http://${HOST}:${PORT}`);
  // --no-preview: for running a second copy while testing, without touching the main preview.
  if (!process.argv.includes('--no-preview')) preview.startPreview(setup.readConfig().previewPort || 4321);
  domainExpiry(store.getSingle('settings').siteUrl).catch(() => {});
  // Smaller copies of images uploaded before responsive images existed.
  images.ensureAllVariants().catch(() => {});
  // Make sure there's a share image for link previews.
  if (!existsSync(join(ROOT, 'site', 'public', 'og.png')) && store.getSingle('settings').shareImage === 'generated') {
    shareImage().catch(() => {});
  }
  sync = { state: 'pulling', at: null, message: '' };
  gitops.pullLatest().then((r) => {
    sync = r.skipped ? { state: 'local', at: null, message: '' } : { state: r.ok ? 'ok' : 'offline', at: new Date().toISOString(), message: r.message || '' };
  });
  openWindow();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is used by another program. Close it, or start the CMS with CMS_PORT set to a free port.`);
    process.exit(1);
  }
  throw e;
});

function openWindow() {
  if (NO_OPEN) return;
  const url = `http://${HOST}:${PORT}`;
  if (process.platform === 'win32') {
    // Edge app mode gives the CMS its own window. Falls back to the default browser.
    exec(`start "" msedge --app=${url} --window-size=1440,900`, { windowsHide: true }, (err) => {
      if (err) exec(`start "" ${url}`, { windowsHide: true });
    });
  } else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`);
}

function shutdown() {
  preview.stopPreview();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Fallback if the window disappeared without saying goodbye (crash, sleep). Browsers slow
// down timers in minimised windows, so this waits a long time before giving up.
if (!STAY) {
  setInterval(() => {
    if (lastPing && Date.now() - lastPing > 30 * 60 * 1000 && !busy) shutdown();
  }, 60000);
}
