// The look of the site: palettes, font pairings and the CSS they become.
// Shared by the Astro site (to style pages) and the CMS (to show the choices).

/** Colour tokens for each palette, light and dark. "paper" light is the original design. */
export const PALETTES = {
  paper: {
    label: 'Paper',
    light: { bg: '#fbfbfa', text: '#17181a', body: '#3a3d42', soft: '#4a4d52', muted: '#6b6e73', faint: '#85888d', rule: '#e2e3e1', 'rule-soft': '#eeefed', placeholder: '#e4e6e3', surface: '#eceeeb', code: '#f0f1ef', ok: '#1e9e6a' },
    dark: { bg: '#131415', text: '#ececea', body: '#c9cbc8', soft: '#babcb9', muted: '#9b9e9f', faint: '#828587', rule: '#2b2d2f', 'rule-soft': '#202224', placeholder: '#26282a', surface: '#1f2123', code: '#1d1f21', ok: '#3fbf8a' },
  },
  warm: {
    label: 'Warm',
    light: { bg: '#faf6ef', text: '#1e1a15', body: '#423b33', soft: '#51493f', muted: '#766d62', faint: '#8c8377', rule: '#e7dfd2', 'rule-soft': '#f1eadf', placeholder: '#e9e0d2', surface: '#efe7da', code: '#f1eadf', ok: '#3d8f4f' },
    dark: { bg: '#18140f', text: '#f0eadf', body: '#d2c9bb', soft: '#c2b9ab', muted: '#a3998c', faint: '#878074', rule: '#302a23', 'rule-soft': '#241f19', placeholder: '#2c261f', surface: '#231e18', code: '#221d17', ok: '#6cc27e' },
  },
  cool: {
    label: 'Cool',
    light: { bg: '#f6f8fb', text: '#131822', body: '#353c48', soft: '#444b58', muted: '#636b79', faint: '#7c8492', rule: '#dde3ea', 'rule-soft': '#eaeef3', placeholder: '#dfe5ec', surface: '#e6ebf1', code: '#e9eef4', ok: '#1f9a73' },
    dark: { bg: '#0f141b', text: '#e7ecf3', body: '#c3cbd6', soft: '#b3bbc7', muted: '#909aa7', faint: '#76808d', rule: '#242c37', 'rule-soft': '#1a212b', placeholder: '#202834', surface: '#18202a', code: '#172029', ok: '#46c497' },
  },
  stone: {
    label: 'Stone',
    light: { bg: '#ffffff', text: '#111111', body: '#333333', soft: '#444444', muted: '#666666', faint: '#7d7d7d', rule: '#e2e2e2', 'rule-soft': '#efefef', placeholder: '#e6e6e6', surface: '#eeeeee', code: '#f2f2f2', ok: '#1e9e6a' },
    dark: { bg: '#0c0c0c', text: '#f2f2f2', body: '#cccccc', soft: '#bdbdbd', muted: '#9c9c9c', faint: '#808080', rule: '#272727', 'rule-soft': '#1b1b1b', placeholder: '#232323', surface: '#1a1a1a', code: '#191919', ok: '#3fbf8a' },
  },
};

/** Font pairings. Every family here is installed from @fontsource and imported by the site. */
export const FONTS = {
  clean: {
    label: 'Clean',
    note: 'Instrument Sans + JetBrains Mono',
    sans: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    display: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  },
  editorial: {
    label: 'Editorial',
    note: 'Newsreader + IBM Plex Mono',
    sans: "'Newsreader', Georgia, 'Times New Roman', serif",
    display: "'Newsreader', Georgia, 'Times New Roman', serif",
    mono: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
  },
  friendly: {
    label: 'Friendly',
    note: 'Nunito + JetBrains Mono',
    sans: "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",
    display: "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  },
  technical: {
    label: 'Technical',
    note: 'Space Grotesk + IBM Plex Mono',
    sans: "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
    display: "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
  },
};

export const ACCENTS = ['#2446c7', '#0f766e', '#15803d', '#b45309', '#c2410c', '#be123c', '#7c3aed', '#17181a'];

export const DEFAULT_THEME = {
  palette: 'paper',
  mode: 'light',
  accent: '#2446c7',
  fonts: 'clean',
  layout: 'sidebar',
  photo: 'rounded',
  density: 'comfortable',
  monogram: '',
};

// ---------- colour maths ----------
const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two hex colours (1 to 21). */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Mix the accent toward white (or black) until it reads well on the background. */
export function readableOn(accent, bg, min = 4.5) {
  const towards = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  const start = hexToRgb(accent);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = rgbToHex(start.map((v, i) => v + (towards[i] - v) * t));
    if (contrast(c, bg) >= min) return c;
  }
  return rgbToHex(towards);
}

// ---------- CSS ----------
export const resolveTheme = (theme) => ({ ...DEFAULT_THEME, ...(theme || {}) });
const tokens = (set) => Object.entries(set).map(([k, v]) => `--${k}:${v}`).join(';');

/** Palette tokens for the theme's light and dark looks, with the accent made readable on each. */
export function themeColors(theme) {
  const t = resolveTheme(theme);
  const p = PALETTES[t.palette] || PALETTES.paper;
  return {
    light: { ...p.light, accent: t.accent },
    dark: { ...p.dark, accent: readableOn(t.accent, p.dark.bg) },
  };
}

/** The :root CSS for a theme. Auto puts dark colours behind the visitor's device setting. */
export function themeCss(theme) {
  const t = resolveTheme(theme);
  const f = FONTS[t.fonts] || FONTS.clean;
  const { light, dark } = themeColors(t);
  const fonts = `--sans:${f.sans};--display:${f.display};--mono:${f.mono}`;
  // Logo colours come in as --logo. Ones too dark (or too light) for the background fall back to the body colour.
  const lowDark = '.toolkit .ic.logo.low-dark{color:var(--body)}';
  const lowLight = '.toolkit .ic.logo.low-light{color:var(--body)}';
  if (t.mode === 'dark') return `:root{${tokens(dark)};${fonts};color-scheme:dark}${lowDark}`;
  if (t.mode === 'auto') {
    return `:root{${tokens(light)};${fonts};color-scheme:light dark}${lowLight}@media (prefers-color-scheme: dark){:root{${tokens(dark)}}.toolkit .ic.logo.low-light{color:var(--logo)}${lowDark}}`;
  }
  return `:root{${tokens(light)};${fonts};color-scheme:light}${lowLight}`;
}

/** Whether a logo colour is hard to see on the theme's light and dark backgrounds. */
export function logoVisibility(hex, theme) {
  const { light, dark } = themeColors(theme);
  return { lowLight: contrast(hex, light.bg) < 2, lowDark: contrast(hex, dark.bg) < 2 };
}
