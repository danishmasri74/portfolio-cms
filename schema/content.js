// Single source of truth for the shape of everything in /content.
// Used by the Astro site (to read content) and by the CMS (to validate before saving).
import { z } from 'zod';

const url = z.string().trim().refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), {
  message: 'Start the address with https://',
});
const year = z.coerce.number().int().min(1990, 'Use a 4-digit year, like 2025.').max(2100, 'Use a 4-digit year, like 2025.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month and year.');
const imagePath = z.string().regex(/^\/images\/[\w\-./]+$/).nullable().default(null);
const icon = z
  .object({ set: z.enum(['si', 'lucide']), name: z.string().min(1) })
  .nullable()
  .default(null);

export const detailSchema = z.object({
  value: z.string().trim().max(80).default(''),
  show: z.boolean().default(false),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(60),
  role: z.string().trim().min(1, 'Enter a role, like "Software engineering student".').max(80),
  bio: z.string().trim().max(400, 'Keep the bio under 400 characters.').default(''),
  // One line shown big above the work. Optional.
  headline: z.string().trim().max(120, 'Keep the headline under 120 characters.').default(''),
  photo: z
    .object({ src: imagePath, focusX: z.number().min(0).max(100).default(50), focusY: z.number().min(0).max(100).default(30) })
    .default({ src: null, focusX: 50, focusY: 30 }),
  details: z
    .object({
      location: detailSchema,
      pronouns: detailSchema,
      timezone: detailSchema,
      languages: detailSchema,
      learning: detailSchema,
      phone: detailSchema,
    })
    .default({
      location: { value: '', show: false },
      pronouns: { value: '', show: false },
      timezone: { value: '', show: false },
      languages: { value: '', show: false },
      learning: { value: '', show: false },
      phone: { value: '', show: false },
    }),
  availability: z
    .object({ show: z.boolean().default(false), text: z.string().trim().max(120).default('') })
    .default({ show: false, text: '' }),
  links: z
    .array(z.object({ label: z.string().trim().min(1, 'Give the link a label.').max(30), url: url.refine((v) => v !== '', 'Enter the address.'), show: z.boolean().default(true) }))
    .default([]),
  email: z.object({ value: z.string().trim().max(120).default(''), show: z.boolean().default(true) }).default({ value: '', show: true }),
  resume: z
    .object({ src: z.string().regex(/^\/files\/[\w\-.]+\.pdf$/).nullable().default(null), show: z.boolean().default(true), updated: z.string().default('') })
    .default({ src: null, show: true, updated: '' }),
});

export const projectSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(60),
  year,
  summary: z.string().trim().min(1, 'Write a one or two sentence summary.').max(180, 'Keep the summary under 180 characters.'),
  stack: z.string().trim().max(120).default(''),
  live: url.default(''),
  code: url.default(''),
  image: imagePath,
  writeup: z.boolean().default(false),
  show: z.boolean().default(true),
  order: z.number().default(0),
});

export const experienceSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title.').max(80),
    org: z.string().trim().max(80).default(''),
    start: month,
    end: month.nullable().default(null), // null = current
    description: z.string().trim().max(180, 'Keep the description under 180 characters.').default(''),
    link: url.default(''),
    writeup: z.boolean().default(false),
    show: z.boolean().default(true),
    order: z.number().default(0),
  })
  .refine((e) => !e.end || e.end >= e.start, { message: 'End date is before the start date.', path: ['end'] });

export const toolkitSchema = z.object({
  icons: z.boolean().default(true),
  iconStyle: z.enum(['mono', 'brand']).default('mono'),
  groups: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Name the group.').max(30),
        items: z.array(z.object({ name: z.string().trim().min(1).max(40), icon })).default([]),
      }),
    )
    .default([]),
});

export const settingsSchema = z.object({
  title: z.string().trim().min(1).max(70),
  description: z.string().trim().max(200).default(''),
  shareImage: z.enum(['generated', 'custom']).default('generated'),
  checkBeforePublish: z.boolean().default(true),
  quickPublish: z.boolean().default(true),
  // Empty until the site has an address (a free name.pages.dev one or your own domain).
  siteUrl: z.string().trim().default(''),
  // Only used by the CMS, to remind you before the domain expires.
  domainRenews: z.union([z.literal(''), z.iso.date({ message: 'Pick a date.' })]).default(''),
});

export const statusSchema = z.object({
  maintenance: z.boolean().default(false),
  message: z.string().trim().max(200).default("I'm rebuilding this site. Back in a few days."),
  showEmail: z.boolean().default(true),
  showResume: z.boolean().default(false),
  showPhoto: z.boolean().default(true),
  showLinks: z.boolean().default(true),
});

// The site's look. Every default matches the original design.
export const themeSchema = z.object({
  palette: z.enum(['paper', 'warm', 'cool', 'stone']).default('paper'),
  mode: z.enum(['light', 'dark', 'auto']).default('light'),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour.').default('#2446c7'),
  fonts: z.enum(['clean', 'editorial', 'friendly', 'technical']).default('clean'),
  layout: z.enum(['sidebar', 'centred']).default('sidebar'),
  photo: z.enum(['rounded', 'circle', 'square', 'none']).default('rounded'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  // Letters on the browser-tab icon. Empty = first letters of the first and last name.
  monogram: z.string().trim().max(2, 'Use one or two letters.').default(''),
  projects: z.enum(['rows', 'feature', 'grid']).default('rows'),
  links: z.enum(['text', 'icons', 'button']).default('text'),
  accentStrength: z.enum(['subtle', 'bold']).default('subtle'),
  motion: z.boolean().default(false),
});

// Section names and order, plus the owner's own sections (a paragraph or a simple list).
export const BUILT_IN_SECTIONS = ['work', 'experience', 'toolkit'];
const sectionItem = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(80),
  when: z.string().trim().max(30).default(''),
  description: z.string().trim().max(180, 'Keep it under 180 characters.').default(''),
  link: url.default(''),
});
const customSection = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  title: z.string().trim().min(1, 'Name the section.').max(30, 'Keep the name under 30 characters.'),
  kind: z.enum(['text', 'list']).default('list'),
  show: z.boolean().default(true),
  text: z.string().trim().max(600, 'Keep it under 600 characters.').default(''),
  items: z.array(sectionItem).max(30).default([]),
});
const label = (fallback) => z.string().trim().max(30, 'Keep the name under 30 characters.').default(fallback).transform((v) => v || fallback);
export const sectionsSchema = z
  .object({
    order: z.array(z.string()).default(BUILT_IN_SECTIONS),
    labels: z
      .object({ work: label('Work'), experience: label('Experience'), toolkit: label('Toolkit') })
      .default({ work: 'Work', experience: 'Experience', toolkit: 'Toolkit' }),
    custom: z.array(customSection).max(8, 'Up to 8 of your own sections.').default([]),
  })
  .refine((s) => new Set(s.custom.map((c) => c.id)).size === s.custom.length, { message: 'Two sections have the same id.', path: ['custom'] })
  // Keep the order honest: drop unknown ids and add any missing section at the end, so nothing disappears by accident.
  .transform((s) => {
    const ids = [...BUILT_IN_SECTIONS, ...s.custom.map((c) => c.id)];
    const order = [...new Set(s.order.filter((id) => ids.includes(id)))];
    for (const id of ids) if (!order.includes(id)) order.push(id);
    return { ...s, order };
  });

export const schemas = {
  profile: profileSchema,
  toolkit: toolkitSchema,
  settings: settingsSchema,
  status: statusSchema,
  theme: themeSchema,
  sections: sectionsSchema,
  projects: projectSchema,
  experience: experienceSchema,
};

/** Turn a zod error into { "field.path": "message" } for the CMS forms. */
export function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2025-03","2025-11" -> "Mar – Nov 2025"; "2024-09",null -> "Sep 2024 – now" */
export function formatRange(start, end) {
  const [sy, sm] = start.split('-').map(Number);
  if (!end) return `${MONTHS[sm - 1]} ${sy} – now`;
  const [ey, em] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${sy}`;
  return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
}

/** The site address without a trailing slash, or '' when none is set yet. */
export const siteBase = (settings) => String(settings?.siteUrl || '').trim().replace(/\/+$/, '');
