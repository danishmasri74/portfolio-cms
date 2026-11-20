// Finds when the site's domain expires, using RDAP: the public lookup service every domain registry runs.
// The registry for each ending (.tech, .com, ...) comes from IANA's official list. Only the domain name is sent.
import { readConfig, writeConfig } from './setup.js';

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const DAY = 24 * 60 * 60 * 1000;
let bootstrap = null;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/rdap+json, application/json' } });
  if (!res.ok) throw Object.assign(new Error(`Lookup returned ${res.status}`), { status: res.status });
  return res.json();
}

async function rdapBase(tld) {
  if (!bootstrap || Date.now() - bootstrap.at > 7 * DAY) bootstrap = { at: Date.now(), data: await getJson(BOOTSTRAP) };
  const hit = bootstrap.data.services.find(([tlds]) => tlds.includes(tld));
  return hit ? hit[1][0].replace(/\/?$/, '/') : null;
}

// Free addresses from hosting services: there's no domain of your own to renew.
const FREE_HOSTS = ['pages.dev', 'workers.dev', 'github.io', 'netlify.app', 'vercel.app'];

/** The registered domain for a site address: "https://www.example.com/" -> "example.com". Null for free hosting addresses. */
export function registeredDomain(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (FREE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return /\./.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost' ? host : null;
  } catch {
    return null;
  }
}

async function lookup(domain) {
  const labels = domain.split('.');
  // Try the full name first, then shorter ones, so sub.example.com still finds example.com.
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join('.');
    const base = await rdapBase(labels.at(-1));
    if (!base) return { ok: false, reason: 'unsupported' };
    try {
      const j = await getJson(`${base}domain/${encodeURIComponent(name)}`);
      const exp = (j.events || []).find((e) => e.eventAction === 'expiration');
      if (!exp) return { ok: false, reason: 'no-date', domain: name };
      return { ok: true, domain: name, expires: exp.eventDate.slice(0, 10) };
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
  }
  return { ok: false, reason: 'not-found' };
}

/**
 * Cached expiry for the site's domain. Looks it up at most once a day, or when the domain changes.
 * Returns { domain, expires, checkedAt, ok, reason }.
 */
export async function domainExpiry(siteUrl, { force = false } = {}) {
  const domain = registeredDomain(siteUrl);
  if (!domain) return { ok: false, reason: 'no-domain' };
  const cached = readConfig().domainExpiry;
  if (!force && cached && cached.domain === domain && Date.now() - new Date(cached.checkedAt).getTime() < DAY) return cached;
  try {
    const r = await lookup(domain);
    const result = { ...r, domain: r.domain || domain, checkedAt: new Date().toISOString() };
    writeConfig({ domainExpiry: result });
    return result;
  } catch {
    // Offline or the registry is down: keep the last good answer if there is one.
    if (cached && cached.domain === domain && cached.ok) return { ...cached, stale: true };
    return { ok: false, reason: 'offline', domain };
  }
}
