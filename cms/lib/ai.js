// Connect this portfolio's MCP server (cms/mcp.js) to Claude Desktop by adding one entry to its settings file.
// Only the "portfolio" entry that points at this folder is ever added or removed; everything else is kept.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { ROOT } from '../../schema/read.js';

const NAME = 'portfolio';
const SERVER = join(ROOT, 'cms', 'mcp.js');

/**
 * The Microsoft Store version of Claude Desktop keeps its settings in its own package folder:
 * %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude. Windows shows that folder to the app as
 * %APPDATA%\Claude, but other programs (like this CMS) only see it at the package path.
 */
function storeAppFolder() {
  const packages = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Packages');
  try {
    for (const name of readdirSync(packages)) {
      if (!/^Claude_/i.test(name)) continue;
      const dir = join(packages, name, 'LocalCache', 'Roaming', 'Claude');
      if (existsSync(dir)) return dir;
    }
  } catch {}
  return null;
}

/**
 * Newer versions of the Windows app move all their data to %LOCALAPPDATA%\Claude-Data\claude_<id>,
 * leaving a ".user-data-left" marker in the old folder. When that folder exists, it holds the settings
 * file Claude actually reads.
 */
function claudeDataFolder() {
  const base = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Claude-Data');
  try {
    const dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && /^claude/i.test(d.name));
    // Prefer the one with a settings file; otherwise the first.
    const withConfig = dirs.find((d) => existsSync(join(base, d.name, 'claude_desktop_config.json')));
    const pick = withConfig || dirs[0];
    if (pick) return join(base, pick.name);
  } catch {}
  return null;
}

/** Claude Desktop's settings file. PORTFOLIO_CLAUDE_CONFIG points elsewhere (used for testing). */
export function configPath() {
  if (process.env.PORTFOLIO_CLAUDE_CONFIG) return process.env.PORTFOLIO_CLAUDE_CONFIG;
  if (process.platform === 'win32') {
    const data = claudeDataFolder();
    if (data) return join(data, 'claude_desktop_config.json');
    const store = storeAppFolder();
    if (store) return join(store, 'claude_desktop_config.json');
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function read() {
  const file = configPath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8') || '{}');
  } catch {
    throw new Error("Claude Desktop's settings file couldn't be read, so it wasn't changed.");
  }
}

const isOurs = (entry) => !!entry && Array.isArray(entry.args) && entry.args.some((a) => String(a).replace(/\\/g, '/').toLowerCase() === SERVER.replace(/\\/g, '/').toLowerCase());

export function status() {
  const file = configPath();
  const installed = existsSync(dirname(file));
  let entry = null;
  try {
    entry = read().mcpServers?.[NAME] || null;
  } catch {}
  return { installed, connected: isOurs(entry), otherFolder: !!entry && !isOurs(entry) };
}

export function connect() {
  const file = configPath();
  const cfg = read();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [NAME]: { command: process.execPath, args: [SERVER] } };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return status();
}

export function disconnect() {
  const file = configPath();
  const cfg = read();
  if (isOurs(cfg.mcpServers?.[NAME])) {
    copyFileSync(file, `${file}.bak`);
    delete cfg.mcpServers[NAME];
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  }
  return status();
}

// ---------- Codex (CLI, IDE extension and app share ~/.codex/config.toml) ----------
// Only the [mcp_servers.portfolio] table that points at this folder is ever added or removed.
// The file is edited as text so everything else in it (comments, order, other servers) stays exactly as it was.
export function codexConfigPath() {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  return join(home, 'config.toml');
}

const CODEX_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:portfolio|"portfolio")\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[/;

function readCodex() {
  const file = codexConfigPath();
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** The text of our table (and its sub-tables), and the file without it. */
function splitCodex(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  const ours = [];
  let inOurs = false;
  for (const line of lines) {
    if (ANY_HEADER.test(line)) inOurs = CODEX_HEADER.test(line);
    (inOurs ? ours : kept).push(line);
  }
  return { kept: kept.join('\n'), ours: ours.join('\n') };
}

const tomlString = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);
// Compare paths with any run of backslashes (TOML may escape them) treated as one slash.
const slashes = (s) => s.replace(/\\+/g, '/').toLowerCase();
const pointsHere = (block) => slashes(block).includes(slashes(SERVER));

export function codexStatus() {
  const file = codexConfigPath();
  const installed = existsSync(dirname(file));
  const { ours } = splitCodex(readCodex());
  const has = ours.trim().length > 0;
  return { installed, connected: has && pointsHere(ours), otherFolder: has && !pointsHere(ours) };
}

export function codexConnect() {
  const file = codexConfigPath();
  mkdirSync(dirname(file), { recursive: true });
  const text = readCodex();
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const { kept } = splitCodex(text);
  const block = [
    '# Portfolio CMS: lets Codex read and edit this portfolio. It cannot publish.',
    `[mcp_servers.${NAME}]`,
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(SERVER)}]`,
    'startup_timeout_sec = 20',
    '',
  ].join('\n');
  const base = kept.replace(/\s*# Portfolio CMS: lets Codex read and edit this portfolio\. It cannot publish\.\s*$/, '').replace(/\s*$/, '');
  writeFileSync(file, (base ? `${base}\n\n` : '') + block);
  return codexStatus();
}

export function codexDisconnect() {
  const file = codexConfigPath();
  const text = readCodex();
  const { kept, ours } = splitCodex(text);
  if (ours.trim() && pointsHere(ours)) {
    copyFileSync(file, `${file}.bak`);
    const base = kept.replace(/\s*# Portfolio CMS: lets Codex read and edit this portfolio\. It cannot publish\.\s*$/, '').replace(/\s*$/, '');
    writeFileSync(file, base ? `${base}\n` : '');
  }
  return codexStatus();
}
