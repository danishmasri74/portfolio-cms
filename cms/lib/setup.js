// First-launch checks and actions, plus the local config file.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../schema/read.js';
import { git, hasHead, remoteUrl } from './gitops.js';

const CONFIG_DIR = join(ROOT, 'cms', '.local');
const CONFIG = join(CONFIG_DIR, 'config.json');

export function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return { setupDone: false, previewPort: 4321 };
  }
}
export function writeConfig(patch) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const next = { ...readConfig(), ...patch };
  writeFileSync(CONFIG, JSON.stringify(next, null, 2));
  return next;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, windowsHide: true, timeout: opts.timeout || 30000, shell: opts.shell || false }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() }),
    );
  });
}

export function desktopPath() {
  return run('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"]).then((r) => r.stdout);
}

export async function shortcutExists() {
  const desk = await desktopPath();
  return !!desk && existsSync(join(desk, 'Portfolio CMS.lnk'));
}

export async function checks(preview) {
  const gitV = await run('git', ['--version']);
  const isRepo = (await git(['rev-parse', '--is-inside-work-tree'], { allowFail: true })).ok;
  const url = isRepo ? await remoteUrl() : '';
  let access = { ok: false, message: '' };
  if (url) {
    // A dry-run push proves you can publish, not just read. That catches a plain clone of someone else's repository.
    const r = (await hasHead())
      ? await git(['push', '--dry-run', 'origin', 'HEAD'], { allowFail: true, timeout: 30000 })
      : await git(['ls-remote', '--heads', 'origin'], { allowFail: true, timeout: 20000 });
    const denied = /\b403\b|denied|not allowed|permission/i.test(r.stderr || '');
    access = {
      ok: r.ok,
      message: r.ok ? '' : denied ? 'You can\'t publish to this repository. On GitHub, use "Use this template" to make your own copy, or connect a repository you own.' : r.stderr.trim().split('\n').pop(),
    };
  }
  const gh = await run('gh', ['auth', 'status'], { timeout: 10000 });
  return {
    folder: { ok: existsSync(join(ROOT, 'content', 'settings.json')), path: ROOT },
    git: { ok: gitV.ok, version: gitV.stdout.replace('git version ', '') },
    repo: { ok: isRepo, hasHead: isRepo && (await hasHead()) },
    github: { ok: !!url && access.ok, url, message: access.message, ghAvailable: gh.ok },
    packages: { ok: existsSync(join(ROOT, 'node_modules', 'astro')) },
    preview: { ok: preview.status === 'running', status: preview.status, url: preview.url },
    shortcut: { ok: await shortcutExists() },
  };
}

export async function initRepo() {
  if (!(await git(['rev-parse', '--is-inside-work-tree'], { allowFail: true })).ok) await git(['init', '-b', 'main']);
  if (!(await hasHead())) {
    await git(['add', '-A']);
    await git(['commit', '-m', 'First version of the portfolio']);
  }
}

export async function setRemote(url) {
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(url)) throw new Error('Enter a GitHub address like https://github.com/you/portfolio.git');
  const has = await remoteUrl();
  await git(has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
}

export async function createWithGh(name, visibility) {
  if (!/^[\w.-]{1,100}$/.test(name)) throw new Error('Use letters, numbers, dots or dashes for the repository name.');
  const r = await run('gh', ['repo', 'create', name, visibility === 'public' ? '--public' : '--private', '--source', '.', '--remote', 'origin'], { timeout: 60000 });
  if (!r.ok) throw new Error(r.stderr || 'GitHub CLI could not create the repository.');
}

export async function createShortcut() {
  const r = await run(process.execPath, [join(ROOT, 'cms', 'shortcut.js')], { timeout: 30000 });
  if (!r.ok) throw new Error(r.stderr || 'Could not create the shortcut.');
}
