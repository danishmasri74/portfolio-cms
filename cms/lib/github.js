// GitHub backup: sign in with GitHub's own device login (through the GitHub CLI), then create or connect a
// repository. The CMS never sees a password or token: the GitHub CLI keeps the sign-in.
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../schema/read.js';
import { git, hasHead, remoteUrl } from './gitops.js';

const GH_DIRS = [join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI')];

function run(cmd, args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, windowsHide: true, timeout }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() }),
    );
  });
}

/** Make tools installed while the CMS is running findable without a restart. */
export function addToPath(dir) {
  if (dir && existsSync(dir) && !process.env.PATH.split(';').includes(dir)) process.env.PATH += `;${dir}`;
}

/** Install a tool with Windows' own installer (winget). Resolves { ok, message }. */
export function wingetInstall(id, dir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'Automatic install only works on Windows.' });
    const p = spawn('winget', ['install', '--id', id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent'], { windowsHide: true });
    const t = setTimeout(() => p.kill(), 10 * 60 * 1000);
    p.on('error', () => {
      clearTimeout(t);
      resolve({ ok: false, message: "Windows' installer (winget) isn't available." });
    });
    p.on('exit', (code) => {
      clearTimeout(t);
      addToPath(dir);
      resolve(code === 0 ? { ok: true } : { ok: false, message: "The install didn't finish. Try again, or install it yourself." });
    });
  });
}

export const hasGit = async () => (await run('git', ['--version'], { timeout: 10000 })).ok;
export async function installGit() {
  const r = await wingetInstall('Git.Git', join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'));
  return r.ok && (await hasGit()) ? { ok: true } : { ok: false, message: r.message || 'Git still isn\'t found. Restart the CMS after installing it.' };
}

const hasGh = async () => {
  GH_DIRS.forEach(addToPath);
  return (await run('gh', ['--version'], { timeout: 10000 })).ok;
};

// ---------- sign-in ----------
let login = null; // { code, error, proc }

export async function status() {
  const gh = await hasGh();
  let user = '';
  if (gh) {
    const r = await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 15000 });
    if (r.ok) user = r.out;
  }
  return {
    gh,
    user,
    remote: await remoteUrl(),
    login: login ? { code: login.code, pending: !!login.proc, error: login.error } : null,
  };
}

export async function installGh() {
  const r = await wingetInstall('GitHub.cli', GH_DIRS[0]);
  return r.ok && (await hasGh()) ? { ok: true } : { ok: false, message: r.message || "The GitHub app still isn't found. Restart the CMS after installing it." };
}

/** Start GitHub's device login. Resolves once the one-time code is known. */
export async function startLogin() {
  if (login?.proc) return { code: login.code };
  if (!(await hasGh())) return { needGh: true };
  login = { code: '', error: '', proc: null };
  const p = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'], {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, GH_PROMPT_DISABLED: '' },
  });
  login.proc = p;
  let buf = '';
  const onData = (d) => {
    buf += d;
    const m = buf.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
    if (m && !login.code) {
      login.code = m[1].toUpperCase();
      // gh waits for Enter before opening the browser and checking for the sign-in.
      p.stdin.write('\n');
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('exit', async (code) => {
    const me = login;
    if (!me || me.proc !== p) return;
    me.proc = null;
    if (code === 0) {
      await run('gh', ['auth', 'setup-git'], { timeout: 20000 });
      me.error = '';
    } else if (!me.error) {
      me.error = /expired/i.test(buf) ? 'The code expired. Get a new code and try again.' : "Sign-in didn't finish. Try again.";
    }
  });
  // Wait briefly for the code to appear.
  for (let i = 0; i < 50 && !login.code && login.proc; i++) await new Promise((r) => setTimeout(r, 200));
  if (!login.code) {
    login.proc?.kill();
    login = { code: '', error: "GitHub didn't send a sign-in code. Try again.", proc: null };
  }
  return { code: login.code, error: login.error };
}

export function cancelLogin() {
  login?.proc?.kill();
  login = null;
}

// ---------- the backup itself ----------
async function pushAll() {
  if (!(await hasHead())) return { ok: true };
  const r = await git(['push', '-u', 'origin', 'HEAD'], { allowFail: true, timeout: 120000 });
  return r.ok ? { ok: true } : { ok: false, message: (r.stderr || '').trim().split('\n').pop() };
}

export async function createBackup(name, visibility) {
  if (!/^[\w.-]{1,100}$/.test(name)) throw new Error('Use letters, numbers, dots or dashes for the name.');
  const r = await run('gh', ['repo', 'create', name, visibility === 'public' ? '--public' : '--private', '--source', '.', '--remote', 'origin'], { timeout: 60000 });
  if (!r.ok) {
    if (/already exists/i.test(r.err)) throw new Error(`You already have a repository called ${name}. Pick another name, or use its address instead.`);
    throw new Error(r.err.split('\n').pop() || "GitHub couldn't create the backup.");
  }
  const p = await pushAll();
  if (!p.ok) throw new Error(`The backup was created, but uploading failed: ${p.message}`);
  return { remote: await remoteUrl() };
}

export async function useExisting(url) {
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(url)) throw new Error('Paste an address like https://github.com/you/portfolio.git');
  const has = await remoteUrl();
  await git(has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  const p = await pushAll();
  if (!p.ok) throw new Error(`Connected, but uploading failed: ${p.message}`);
  return { remote: await remoteUrl() };
}
