// Runs the Astro dev server for the live preview, and the build used by Check.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from '../../schema/read.js';

const require = createRequire(import.meta.url);
const ASTRO = join(require.resolve('astro/package.json'), '..', 'bin', 'astro.mjs');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const state = { proc: null, url: null, status: 'stopped', log: [], exitCode: null };

function remember(chunk) {
  for (let line of strip(chunk.toString()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('{')) {
      try {
        line = JSON.parse(line).message || line;
      } catch {}
    }
    state.log.push(line);
    if (state.log.length > 80) state.log.shift();
    const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
    if (m && state.status === 'starting') {
      state.url = `http://127.0.0.1:${m[1]}`;
      state.status = 'running';
    }
  }
}

export function startPreview(port = 4321, { retried = false } = {}) {
  if (state.proc) return previewState();
  state.status = 'starting';
  state.log = [];
  state.exitCode = null;
  state.url = null;
  const proc = spawn(process.execPath, [ASTRO, 'dev', '--root', 'site', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0' },
  });
  state.proc = proc;
  proc.stdout.on('data', remember);
  proc.stderr.on('data', remember);
  proc.on('exit', (code) => {
    if (state.proc !== proc) return;
    state.proc = null;
    state.exitCode = code;
    state.status = 'stopped';
    // A preview left over from an earlier session (for example after a crash) blocks a new one.
    // Stop the leftover and try once more.
    if (!retried && state.log.some((l) => /astro dev stop/i.test(l))) {
      state.status = 'starting';
      const stop = spawn(process.execPath, [ASTRO, 'dev', 'stop', '--root', 'site'], { cwd: ROOT, windowsHide: true, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
      stop.on('exit', () => startPreview(port, { retried: true }));
      stop.on('error', () => (state.status = 'stopped'));
    }
  });
  return previewState();
}

export function stopPreview() {
  if (state.proc) {
    state.proc.kill();
    state.proc = null;
  }
  state.status = 'stopped';
}

export function restartPreview(port) {
  stopPreview();
  return startPreview(port);
}

export function previewState() {
  return { status: state.status, url: state.url, exitCode: state.exitCode, log: state.log.slice(-12) };
}

/** Full production build into a temp folder. Resolves { ok, seconds, log }. */
export function runBuildCheck() {
  const out = join(tmpdir(), `portfolio-check-${Date.now()}`);
  const started = Date.now();
  return new Promise((resolve) => {
    let log = '';
    const proc = spawn(process.execPath, [ASTRO, 'build', '--root', 'site', '--outDir', out], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0' },
    });
    proc.stdout.on('data', (d) => (log += strip(d.toString())));
    proc.stderr.on('data', (d) => (log += strip(d.toString())));
    proc.on('exit', (code) => {
      rmSync(out, { recursive: true, force: true });
      const lines = log.split(/\r?\n/).filter((l) => l.trim());
      const pages = (log.match(/page\(s\) built/) && log.match(/(\d+) page\(s\) built/)?.[1]) || null;
      resolve({ ok: code === 0, seconds: Math.round((Date.now() - started) / 100) / 10, pages: pages ? Number(pages) : null, log: lines.slice(-15).join('\n') });
    });
  });
}
