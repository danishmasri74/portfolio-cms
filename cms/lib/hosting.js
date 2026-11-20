// Cloudflare Pages hosting, driven from the CMS.
// Sign-in and deploys go through Wrangler (Cloudflare's official CLI). Domain status and
// custom domains use the Cloudflare API with the token Wrangler holds after sign-in.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, symlinkSync, mkdirSync, lstatSync, unlinkSync, existsSync } from 'node:fs';
import { ROOT } from '../../schema/read.js';
import { readConfig, writeConfig } from './setup.js';
import { git } from './gitops.js';

const require = createRequire(import.meta.url);
const WRANGLER = join(require.resolve('wrangler/package.json'), '..', 'bin', 'wrangler.js');
const ASTRO = join(require.resolve('astro/package.json'), '..', 'bin', 'astro.mjs');
const API = 'https://api.cloudflare.com/client/v4';
// Only what the CMS needs: who you are, Pages projects, and reading your domains.
const SCOPES = ['account:read', 'user:read', 'pages:write', 'zone:read'];
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

export class HostingError extends Error {
  constructor(message, reason = 'unknown') {
    super(message);
    this.reason = reason;
  }
}

function run(cmd, args, { cwd = ROOT, timeout = 120000, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0', ...env } });
    let out = '';
    let err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code, out: strip(out), err: strip(err) });
    });
    p.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, code: -1, out: '', err: e.message });
    });
  });
}
const wrangler = (args, opts) => run(process.execPath, [WRANGLER, ...args], opts);

function classify(text) {
  const t = String(text);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(t)) return 'network';
  if (/not logged in|Authentication|unauthori[sz]ed|10000|9109|invalid.*token|login/i.test(t)) return 'auth';
  return 'unknown';
}

// ---------- sign-in ----------
let loginProc = null;
let loginError = '';

export function startLogin() {
  if (loginProc) return;
  loginError = '';
  loginProc = spawn(process.execPath, [WRANGLER, 'login', '--scopes', ...SCOPES], {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' },
  });
  let log = '';
  loginProc.stdout.on('data', (d) => (log += d));
  loginProc.stderr.on('data', (d) => (log += d));
  loginProc.on('exit', (code) => {
    if (code !== 0 && code !== null) loginError = /denied|cancel/i.test(log) ? 'Sign-in was cancelled.' : 'Sign-in did not finish. Try again.';
    loginProc = null;
    tokenCache = null;
  });
}
export function cancelLogin() {
  if (loginProc) loginProc.kill();
  loginProc = null;
}
export async function logout() {
  cancelLogin();
  await wrangler(['logout'], { timeout: 30000 });
  tokenCache = null;
  writeConfig({ hosting: { ...(readConfig().hosting || {}), accountId: null } });
}

let tokenCache = null;
async function token() {
  if (tokenCache && Date.now() - tokenCache.at < 4 * 60 * 1000) return tokenCache.value;
  const r = await wrangler(['auth', 'token', '--json'], { timeout: 30000 });
  if (!r.ok) throw new HostingError('Connect Cloudflare first.', 'auth');
  let value = '';
  try {
    value = JSON.parse(r.out.slice(r.out.indexOf('{'))).token;
  } catch {
    value = r.out.trim().split(/\s+/).pop();
  }
  if (!value) throw new HostingError('Connect Cloudflare first.', 'auth');
  tokenCache = { value, at: Date.now() };
  return value;
}

async function cf(path, { method = 'GET', body } = {}) {
  const t = await token();
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HostingError("Couldn't reach Cloudflare. Check your internet connection.", 'network');
  }
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join('; ') || `Cloudflare returned ${res.status}.`;
    if (res.status === 401 || res.status === 403) {
      tokenCache = null;
      throw new HostingError('Cloudflare needs you to sign in again.', 'auth');
    }
    const e = new HostingError(msg, 'api');
    e.status = res.status;
    e.codes = json.errors?.map((x) => x.code) || [];
    throw e;
  }
  return json.result;
}

// ---------- status ----------
const hostingConfig = () => readConfig().hosting || {};
const saveHosting = (patch) => writeConfig({ hosting: { ...hostingConfig(), ...patch } });

async function account() {
  const h = hostingConfig();
  const accounts = await cf('/accounts?per_page=20');
  if (!accounts.length) throw new HostingError('This Cloudflare login has no account.', 'api');
  const acc = accounts.find((a) => a.id === h.accountId) || accounts[0];
  if (acc.id !== h.accountId) saveHosting({ accountId: acc.id });
  return acc;
}

export async function status() {
  const h = hostingConfig();
  const base = {
    loginPending: !!loginProc,
    loginError,
    connected: false,
    project: h.project || null,
    subdomain: h.subdomain || null,
    domain: h.domain || null,
    lastDeployAt: h.lastDeployAt || null,
    deployedHead: h.deployedHead || null,
  };
  if (loginProc) return base;
  let user;
  try {
    user = await cf('/user');
  } catch (e) {
    return { ...base, error: e.reason === 'auth' ? '' : e.message, offline: e.reason === 'network' };
  }
  let acc;
  try {
    acc = await account();
  } catch (e) {
    return { ...base, error: e.message, offline: e.reason === 'network' };
  }
  const out = { ...base, connected: true, email: user.email, accountName: acc.name, accountId: acc.id };
  // The site may have been deleted in the Cloudflare dashboard since it was created here.
  if (h.project) {
    try {
      await cf(`/accounts/${acc.id}/pages/projects/${h.project}`);
    } catch (e) {
      if (e.status === 404) {
        saveHosting({ project: null, subdomain: null, deployedHead: null, lastDeployAt: null });
        return { ...out, project: null, subdomain: null, lastDeployAt: null, deployedHead: null, projectMissing: h.project };
      }
    }
  }
  if (h.domain) {
    try {
      const zones = await cf(`/zones?name=${encodeURIComponent(h.domain)}&account.id=${acc.id}`);
      const z = zones[0];
      out.zone = z ? { status: z.status, nameServers: z.name_servers || [], originalNameServers: z.original_name_servers || [] } : null;
      if (h.project) {
        let domains = [];
        try {
          domains = await cf(`/accounts/${acc.id}/pages/projects/${h.project}/domains`);
        } catch {}
        // Once the domain is active on Cloudflare, attach it (and www) to the site.
        if (z && z.status === 'active') {
          for (const name of [h.domain, `www.${h.domain}`]) {
            if (!domains.some((d) => d.name === name)) {
              try {
                domains.push(await cf(`/accounts/${acc.id}/pages/projects/${h.project}/domains`, { method: 'POST', body: { name } }));
              } catch (e) {
                out.domainError = e.message;
              }
            }
          }
        }
        out.pagesDomains = domains.filter((d) => d.name === h.domain || d.name === `www.${h.domain}`).map((d) => ({ name: d.name, status: d.status }));
      }
    } catch (e) {
      out.domainError = e.message;
    }
  }
  return out;
}

// ---------- site ----------
export async function createProject(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(name)) throw new HostingError('Use lowercase letters, numbers and dashes, like "yourname".', 'input');
  const acc = await account();
  let project;
  try {
    project = await cf(`/accounts/${acc.id}/pages/projects/${name}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    project = await cf(`/accounts/${acc.id}/pages/projects`, { method: 'POST', body: { name, production_branch: 'main' } });
  }
  if (project.source?.type === 'github' || project.source?.type === 'gitlab') {
    throw new HostingError(`"${name}" is already connected to a Git repository in Cloudflare, so the CMS can't upload to it. Pick another name.`, 'input');
  }
  saveHosting({ project: project.name, subdomain: project.subdomain });
  return { project: project.name, subdomain: project.subdomain };
}

// ---------- domain ----------
export function setDomain(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new HostingError('Enter a domain like yourname.com', 'input');
  saveHosting({ domain: d });
  return d;
}

export async function removeDomain() {
  const h = hostingConfig();
  if (h.domain && h.project) {
    const acc = await account();
    for (const name of [h.domain, `www.${h.domain}`]) {
      await cf(`/accounts/${acc.id}/pages/projects/${h.project}/domains/${name}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  saveHosting({ domain: null });
}

export function isConfigured() {
  return !!hostingConfig().project;
}

// ---------- deploy ----------
/** Build exactly what's committed (HEAD) in a temporary checkout, so unpublished edits never go live. */
export async function buildHead() {
  const dir = join(tmpdir(), `portfolio-deploy-${Date.now()}`);
  const add = await git(['worktree', 'add', '--detach', dir, 'HEAD'], { allowFail: true });
  if (!add.ok) throw new HostingError(`Couldn't prepare the build: ${add.stderr.trim()}`);
  const link = join(dir, 'node_modules');
  const cleanup = async () => {
    // Remove the node_modules link itself first. Deleting the folder recursively would
    // follow the link and wipe the real packages.
    try {
      if (lstatSync(link).isSymbolicLink() || process.platform === 'win32') unlinkSync(link);
    } catch {}
    if (existsSync(link)) throw new HostingError('Could not safely remove the temporary build folder.');
    await git(['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
    await git(['worktree', 'prune'], { allowFail: true });
  };
  try {
    symlinkSync(join(ROOT, 'node_modules'), link, 'junction');
    const out = join(dir, 'site', 'dist');
    mkdirSync(out, { recursive: true });
    const started = Date.now();
    const r = await run(process.execPath, [ASTRO, 'build', '--root', 'site'], { cwd: dir, timeout: 180000, env: { ASTRO_TELEMETRY_DISABLED: '1', PORTFOLIO_ROOT: dir } });
    const lines = (r.out + r.err).split(/\r?\n/).filter((l) => l.trim());
    if (!r.ok) {
      await cleanup();
      const i = lines.findIndex((l) => /error|ENOENT|not found|failed/i.test(l));
      throw new HostingError((i >= 0 ? lines.slice(i, i + 2).join(' ') : lines.slice(-2).join(' ')).slice(0, 300), 'build');
    }
    const pages = Number((r.out.match(/(\d+) page\(s\) built/) || [])[1]) || null;
    return { dir, out, cleanup, seconds: Math.round((Date.now() - started) / 100) / 10, pages };
  } catch (e) {
    if (!(e instanceof HostingError)) await cleanup();
    throw e;
  }
}

/** Build HEAD and upload it to Cloudflare Pages. */
export async function deploy() {
  const h = hostingConfig();
  if (!h.project) throw new HostingError('Create the site in Hosting first.', 'setup');
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  const message = (await git(['log', '-1', '--format=%s'])).trim();
  const build = await buildHead();
  try {
    const r = await wrangler(
      ['pages', 'deploy', build.out, '--project-name', h.project, '--branch', 'main', '--commit-hash', head, '--commit-message', message.slice(0, 200), '--commit-dirty=true'],
      { timeout: 300000, cwd: build.dir },
    );
    if (!r.ok) {
      const text = r.err || r.out;
      const reason = classify(text);
      throw new HostingError(
        reason === 'network' ? "Couldn't reach Cloudflare. Your changes are saved and will go live when you retry." : reason === 'auth' ? 'Cloudflare needs you to sign in again. Open Hosting to reconnect.' : text.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300),
        reason,
      );
    }
    const url = (r.out.match(/https:\/\/[^\s]+\.pages\.dev/) || [])[0] || null;
    const at = new Date().toISOString();
    saveHosting({ deployedHead: head, lastDeployAt: at });
    return { url, at, seconds: build.seconds, pages: build.pages };
  } finally {
    await build.cleanup();
  }
}

/** True when the committed version hasn't been uploaded yet. */
export async function undeployed() {
  const h = hostingConfig();
  if (!h.project) return false;
  const r = await git(['rev-parse', 'HEAD'], { allowFail: true });
  return r.ok && r.stdout.trim() !== h.deployedHead;
}

export function loginState() {
  return { pending: !!loginProc, error: loginError };
}

