// Checks the outside links visitors can click: profile links, project demos and code, experience links,
// and links inside write-ups. Runs as part of Check, never on Publish, so publishing stays fast.
import { readAll } from '../../schema/read.js';

const TIMEOUT = 9000;
const UA = 'Mozilla/5.0 (compatible; PortfolioLinkCheck/1.0)';

export function collectLinks() {
  const { profile, projects, experience } = readAll();
  const found = new Map();
  const add = (url, where) => {
    if (!/^https?:\/\//i.test(url || '')) return;
    if (!found.has(url)) found.set(url, []);
    found.get(url).push(where);
  };
  for (const l of profile.links) if (l.show) add(l.url, `Profile · ${l.label}`);
  for (const p of projects.filter((x) => x.show)) {
    add(p.live, `${p.title} · Live demo`);
    add(p.code, `${p.title} · Code`);
    if (p.writeup) for (const m of p.writeupText.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], `${p.title} · Write-up`);
  }
  for (const e of experience.filter((x) => x.show)) {
    add(e.link, `${e.title} · Link`);
    if (e.writeup) for (const m of e.writeupText.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], `${e.title} · Write-up`);
  }
  return [...found].map(([url, where]) => ({ url, where }));
}

export async function probe(url) {
  const attempt = async (method) => {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
    res.body?.cancel?.().catch(() => {});
    return res.status;
  };
  try {
    let code = await attempt('HEAD');
    // Many sites reject HEAD requests; try a normal request before judging.
    if ([400, 403, 404, 405, 406, 501].includes(code)) code = await attempt('GET');
    if (code < 400) return { state: 'ok', code };
    if (code === 404 || code === 410) return { state: 'broken', code, reason: 'Page not found' };
    if (code >= 500 && code < 600) return { state: 'broken', code, reason: 'The site returned an error' };
    // LinkedIn (999), logins (401/403) and rate limits (429) block automated checks.
    return { state: 'unknown', code, reason: 'The site blocks automatic checks' };
  } catch (e) {
    const msg = String(e?.cause?.code || e?.name || e?.message || '');
    if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return { state: 'broken', reason: 'Domain not found', network: /EAI_AGAIN/.test(msg) };
    if (/Timeout|AbortError/i.test(msg)) return { state: 'unknown', reason: 'Took too long to respond' };
    return { state: 'unknown', reason: "Couldn't connect", network: true };
  }
}

/** Returns { checked, broken: [...], unknown: [...], offline } */
export async function checkLinks() {
  const links = collectLinks();
  const results = [];
  const queue = [...links];
  const worker = async () => {
    while (queue.length) {
      const l = queue.shift();
      results.push({ ...l, ...(await probe(l.url)) });
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  const offline = results.length > 0 && results.every((r) => r.network);
  return {
    checked: results.length,
    offline,
    broken: offline ? [] : results.filter((r) => r.state === 'broken'),
    unknown: offline ? [] : results.filter((r) => r.state === 'unknown'),
  };
}
