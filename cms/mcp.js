#!/usr/bin/env node
// Portfolio MCP server: lets AI assistants (Claude Desktop, Claude Code, other MCP apps) read and edit
// this portfolio's content. Edits are saved exactly like the CMS saves them, and nothing goes online:
// the owner reviews changes in the CMS and presses Publish. Run: node cms/mcp.js (stdio).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readAll } from '../schema/read.js';
import { siteBase } from '../schema/content.js';
import { PALETTES, contrast } from '../schema/theme.js';
import { matchIcon } from '../schema/icons.js';
import * as store from './lib/store.js';
import * as images from './lib/images.js';
import * as gitops from './lib/gitops.js';
import { runBuildCheck } from './lib/preview.js';
import { checkLinks } from './lib/links.js';

const NOT_LIVE = 'Saved. The owner sees it in the CMS under See changes; nothing is online until they press Publish.';

const INSTRUCTIONS = `You are helping someone edit their personal portfolio site.
- Start with get_portfolio to see what's there. Keep their voice: short, plain, first person, no buzzwords, nothing made up. Ask for facts you don't have.
- Every edit is checked against the content rules. If a tool returns a problem, fix the value and try again.
- Nothing you do goes online. The owner reviews changes in their CMS and presses Publish. Don't tell them it's live.
- Photos, screenshots and the résumé are added in the CMS, not here.`;

// ---------- helpers ----------
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const COLLECTION = { type: 'string', enum: ['projects', 'experience'], description: 'Which list the item is in.' };
const PROJECT_FIELDS = {
  title: str('Project name, up to 60 characters.'),
  year: { type: 'integer', description: 'Year, like 2026.' },
  summary: str('One or two sentences, up to 180 characters: what it is and what they did.'),
  stack: str('Tools used, separated by commas, like "React, Supabase".'),
  live: str('Link to the running project, starting with https://. Empty to remove.'),
  code: str('Link to the code, starting with https://. Empty to remove.'),
  show: bool('Whether it shows on the site.'),
};
const EXPERIENCE_FIELDS = {
  title: str('Job title, degree or role, up to 80 characters.'),
  org: str('Company, university or organisation.'),
  start: str('Start month as YYYY-MM.'),
  end: { type: ['string', 'null'], description: 'End month as YYYY-MM, or null if they still do it.' },
  description: str('One line, up to 180 characters.'),
  link: str('Optional link, starting with https://.'),
  show: bool('Whether it shows on the site.'),
};
const LINK = { type: 'object', properties: { label: str('Shown text, like GitHub.'), url: str('Starts with https://.'), show: bool('Shown on the site.') }, required: ['label', 'url'] };
const DETAIL = { type: 'object', properties: { value: str('The text.'), show: bool('Shown on the site.') } };

function problem(e) {
  if (e instanceof store.ValidationError) {
    const lines = Object.entries(e.fields || {}).map(([k, v]) => `${k}: ${v}`);
    return `Not saved. Fix these and try again:\n${lines.join('\n') || e.message}`;
  }
  return `Not saved: ${e.message}`;
}

function refreshImages({ favicon = false } = {}) {
  const profile = store.getSingle('profile');
  const theme = store.getSingle('theme');
  try {
    if (favicon || images.faviconIsGenerated()) images.generateFavicon(profile, theme);
  } catch {}
  if (store.getSingle('settings').shareImage === 'generated') {
    return images.generateShareImage(profile, store.getSingle('settings'), theme).catch(() => {});
  }
}

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined));

// ---------- tools ----------
const TOOLS = [
  {
    name: 'get_portfolio',
    description: 'Read the whole portfolio: profile, projects and experience (with write-ups), toolkit, sections, appearance, page title and description, and whether maintenance is on. Use this first.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const all = readAll();
      const withText = (col) => store.listCollection(col).map((e) => ({ ...e, writeupText: store.getWriteup(col, e.slug) }));
      return {
        profile: all.profile,
        projects: withText('projects'),
        experience: withText('experience'),
        toolkit: all.toolkit,
        sections: all.sections,
        appearance: all.theme,
        seo: { title: all.settings.title, description: all.settings.description, siteAddress: siteBase(all.settings) || '(not online yet)' },
        maintenance: all.status.maintenance,
      };
    },
  },
  {
    name: 'update_profile',
    description: 'Change profile fields. Only the fields you pass change. "links" replaces the whole list. Photo and résumé are added in the CMS.',
    inputSchema: {
      type: 'object',
      properties: {
        name: str('Full name, up to 60 characters.'),
        role: str('What they do, up to 80 characters, like "Software engineering student".'),
        bio: str('A few sentences, up to 400 characters.'),
        headline: str('One big line above their work, up to 120 characters. Empty to remove.'),
        details: { type: 'object', description: 'Any of: location, pronouns, timezone, languages, learning, phone.', properties: Object.fromEntries(['location', 'pronouns', 'timezone', 'languages', 'learning', 'phone'].map((k) => [k, DETAIL])) },
        availability: { type: 'object', properties: { text: str('Like "Looking for an internship from June 2027".'), show: bool('Shown on the site.') } },
        links: { type: 'array', items: LINK, description: 'The full list of links, in order.' },
        email: { type: 'object', properties: { value: str('Email address.'), show: bool('Shown on the site.') } },
      },
    },
    async run(a) {
      const p = store.getSingle('profile');
      const next = { ...p, ...pick(a, ['name', 'role', 'bio', 'headline', 'links']) };
      if (a.details) next.details = Object.fromEntries(Object.entries(p.details).map(([k, v]) => [k, { ...v, ...(a.details[k] || {}) }]));
      if (a.availability) next.availability = { ...p.availability, ...a.availability };
      if (a.email) next.email = { ...p.email, ...a.email };
      if (a.links) next.links = a.links.map((l) => ({ show: true, ...l }));
      const saved = store.saveSingle('profile', next);
      await refreshImages();
      return { saved: true, profile: saved, note: NOT_LIVE };
    },
  },
  ...['projects', 'experience'].flatMap((col) => {
    const one = col === 'projects' ? 'project' : 'experience';
    const fields = col === 'projects' ? PROJECT_FIELDS : EXPERIENCE_FIELDS;
    const keys = Object.keys(fields);
    return [
      {
        name: `add_${one}`,
        description: `Add a new ${one}. It goes at the top of the list. Pass "writeup" to add a Markdown write-up page too. Returns its slug.`,
        inputSchema: { type: 'object', properties: { ...fields, writeup: str('Optional Markdown for its own page (## headings, lists, links).') }, required: col === 'projects' ? ['title', 'summary'] : ['title', 'start'] },
        run(a) {
          const base = col === 'projects' ? { year: new Date().getFullYear(), stack: '', live: '', code: '', image: null, show: true } : { org: '', end: null, description: '', link: '', show: true };
          const entry = store.createEntry(col, { ...base, ...pick(a, keys), writeup: !!a.writeup });
          if (a.writeup) store.saveWriteup(col, entry.slug, a.writeup);
          return { saved: true, slug: entry.slug, [one]: entry, note: NOT_LIVE };
        },
      },
      {
        name: `update_${one}`,
        description: `Change a ${one} by its slug. Only the fields you pass change.`,
        inputSchema: { type: 'object', properties: { slug: str('From get_portfolio.'), ...fields }, required: ['slug'] },
        run(a) {
          const e = store.getEntry(col, a.slug);
          if (!e) throw new Error(`No ${one} with the slug "${a.slug}". Use get_portfolio to see them.`);
          const saved = store.saveEntry(col, a.slug, { ...e, ...pick(a, keys) });
          return { saved: true, [one]: saved, note: NOT_LIVE };
        },
      },
      {
        name: `delete_${one}`,
        description: `Delete a ${one} by its slug, with its write-up. The owner can undo it in the CMS until they publish. Confirm with them first.`,
        inputSchema: { type: 'object', properties: { slug: str('From get_portfolio.') }, required: ['slug'] },
        run(a) {
          if (!store.getEntry(col, a.slug)) throw new Error(`No ${one} with the slug "${a.slug}".`);
          store.deleteEntry(col, a.slug);
          return { deleted: true, note: 'Deleted. The owner can undo it under See changes until they publish.' };
        },
      },
    ];
  }),
  {
    name: 'write_writeup',
    description: 'Set the Markdown write-up page for a project or experience, and turn its page on (or off). Use ## headings, short paragraphs and lists.',
    inputSchema: { type: 'object', properties: { collection: COLLECTION, slug: str('From get_portfolio.'), markdown: str('The whole write-up in Markdown.'), page_on: bool('Show the write-up page on the site. Defaults to true.') }, required: ['collection', 'slug', 'markdown'] },
    run(a) {
      const e = store.getEntry(a.collection, a.slug);
      if (!e) throw new Error(`No item with the slug "${a.slug}" in ${a.collection}.`);
      store.saveWriteup(a.collection, a.slug, a.markdown);
      store.saveEntry(a.collection, a.slug, { ...e, writeup: a.page_on !== false });
      return { saved: true, note: NOT_LIVE };
    },
  },
  {
    name: 'set_toolkit',
    description: 'Replace the toolkit: groups of tools and skills, like Languages, Web, Tools. Icons are matched automatically from item names; existing icons are kept.',
    inputSchema: {
      type: 'object',
      properties: {
        groups: { type: 'array', items: { type: 'object', properties: { label: str('Group name, up to 30 characters.'), items: { type: 'array', items: { type: 'object', properties: { name: str('Tool or skill, like TypeScript.') }, required: ['name'] } } }, required: ['label', 'items'] } },
        icons: bool('Show icons next to items (desktop only).'),
        iconStyle: { type: 'string', enum: ['mono', 'brand'], description: 'Icons in one colour or in their logo colours.' },
      },
      required: ['groups'],
    },
    run(a) {
      const t = store.getSingle('toolkit');
      const known = new Map(t.groups.flatMap((g) => g.items).map((i) => [i.name.toLowerCase(), i.icon]));
      const groups = a.groups.map((g) => ({ label: g.label, items: g.items.map((i) => ({ name: i.name, icon: known.has(i.name.toLowerCase()) ? known.get(i.name.toLowerCase()) : matchIcon(i.name) })) }));
      const saved = store.saveSingle('toolkit', { ...t, ...pick(a, ['icons', 'iconStyle']), groups });
      return { saved: true, toolkit: saved, note: NOT_LIVE };
    },
  },
  {
    name: 'update_sections',
    description: 'Rename the built-in sections (work, experience, toolkit), change the order of sections, or set the owner\'s own sections (a short text, or a simple list like Awards). "custom" replaces the whole list of own sections.',
    inputSchema: {
      type: 'object',
      properties: {
        labels: { type: 'object', properties: { work: str('Name for the projects section.'), experience: str('Name for the experience section.'), toolkit: str('Name for the toolkit section.') } },
        order: { type: 'array', items: { type: 'string' }, description: 'Section ids in order: work, experience, toolkit and own section ids.' },
        custom: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: str('Short lowercase id, like "awards".'),
              title: str('Shown name, up to 30 characters.'),
              kind: { type: 'string', enum: ['text', 'list'] },
              show: bool('Shown on the site.'),
              text: str('For kind "text": up to 600 characters.'),
              items: { type: 'array', items: { type: 'object', properties: { title: str('Item title.'), when: str('Like 2025.'), description: str('One line.'), link: str('Optional, https://.') }, required: ['title'] } },
            },
            required: ['id', 'title', 'kind'],
          },
        },
      },
    },
    run(a) {
      const s = store.getSingle('sections');
      const next = { ...s, ...pick(a, ['order', 'custom']) };
      if (a.labels) next.labels = { ...s.labels, ...a.labels };
      const saved = store.saveSingle('sections', next);
      return { saved: true, sections: saved, note: NOT_LIVE };
    },
  },
  {
    name: 'set_appearance',
    description: 'Change how the site looks. Only the fields you pass change.',
    inputSchema: {
      type: 'object',
      properties: {
        palette: { type: 'string', enum: ['paper', 'warm', 'cool', 'stone'] },
        mode: { type: 'string', enum: ['light', 'dark', 'auto'], description: 'auto follows each visitor\'s device.' },
        accent: str('Hex colour for links and highlights, like #2446c7.'),
        fonts: { type: 'string', enum: ['clean', 'editorial', 'friendly', 'technical'], description: 'clean = sans, editorial = serif, friendly = rounded, technical = grotesk.' },
        layout: { type: 'string', enum: ['sidebar', 'centred'] },
        photo: { type: 'string', enum: ['rounded', 'circle', 'square', 'none'] },
        density: { type: 'string', enum: ['comfortable', 'compact'] },
        projects: { type: 'string', enum: ['rows', 'feature', 'grid'], description: 'How projects show: rows, big images, or a two-column grid.' },
        links: { type: 'string', enum: ['text', 'icons', 'button'], description: 'Sidebar links as text, with icons, or a Get in touch button.' },
        accentStrength: { type: 'string', enum: ['subtle', 'bold'] },
        motion: bool('Subtle fade-in and link underlines.'),
        monogram: str('One or two letters for the browser tab icon. Empty for their initials.'),
      },
    },
    async run(a) {
      const t = store.getSingle('theme');
      const saved = store.saveSingle('theme', { ...t, ...pick(a, ['palette', 'mode', 'accent', 'fonts', 'layout', 'photo', 'density', 'projects', 'links', 'accentStrength', 'motion', 'monogram']) });
      await refreshImages({ favicon: true });
      const ratio = contrast(saved.accent, (PALETTES[saved.palette] || PALETTES.paper).light.bg);
      const readable = saved.mode === 'dark' || ratio >= 4.5 ? 'The accent is easy to read.' : 'The accent is hard to read on this background; suggest a darker colour.';
      return { saved: true, appearance: saved, readability: readable, note: NOT_LIVE };
    },
  },
  {
    name: 'update_seo',
    description: 'Change the page title (up to 70 characters, shown in search results and browser tabs) and description (up to 160 characters).',
    inputSchema: { type: 'object', properties: { title: str('Page title.'), description: str('Search description.') } },
    async run(a) {
      const saved = store.saveSingle('settings', { ...store.getSingle('settings'), ...pick(a, ['title', 'description']) });
      await refreshImages();
      return { saved: true, title: saved.title, description: saved.description, note: NOT_LIVE };
    },
  },
  {
    name: 'list_changes',
    description: 'List the changes waiting to be published: the same list the owner sees under See changes in the CMS.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      try {
        const { items } = await gitops.changes();
        return { waiting: items.map((i) => ({ item: i.label, change: i.state === 'new' ? 'added' : i.state === 'deleted' ? 'deleted' : i.summary || 'edited' })), note: items.length ? 'The owner publishes these from the CMS.' : 'Nothing waiting. Everything is published.' };
      } catch {
        return { waiting: [], note: "Changes can't be listed until the CMS has been set up (Welcome screen)." };
      }
    },
  },
  {
    name: 'check_site',
    description: 'Build every page to catch problems, the same check Publish runs. Takes up to a minute. Pass links: true to also test outside links.',
    inputSchema: { type: 'object', properties: { links: bool('Also test that outside links work. Slower.') } },
    async run(a) {
      try {
        readAll();
      } catch (e) {
        return { ok: false, problem: e.message };
      }
      const r = await runBuildCheck();
      const out = { ok: r.ok, pages: r.pages, seconds: r.seconds };
      if (!r.ok) out.problem = (r.log || '').split('\n').filter((l) => /error|failed|not found/i.test(l)).slice(0, 3).join(' ').slice(0, 400) || 'The build failed.';
      if (a.links) {
        const l = await checkLinks().catch(() => null);
        if (l) out.links = { checked: l.checked, broken: l.broken.map((b) => `${b.url} (${b.where.join(', ')})`), couldNotCheck: l.unknown.map((u) => u.url) };
      }
      return out;
    },
  },
];

// ---------- server ----------
const server = new Server({ name: 'portfolio', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] };
  try {
    const result = await tool.run(req.params.arguments || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: problem(e) }] };
  }
});

await server.connect(new StdioServerTransport());
