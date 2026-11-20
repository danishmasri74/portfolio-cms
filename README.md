# Make your own portfolio

A clean portfolio site you edit in a simple window on your computer. Free to put online. No coding.

1. **Download it.** Click the green **Code** button above, then **Download ZIP**. Unzip the folder anywhere you like.
2. **Double-click "Start Portfolio CMS"** in the folder.
3. **Follow the Welcome screen.** It asks for your name and a look, then you're editing.

Windows 10 or 11. If Node.js or Git are missing, the Start file offers to install them for you (it asks first). After the first time, use the **Portfolio CMS** shortcut on your desktop.

## What happens next

- **Start here** in the sidebar lists five steps to a site that's yours, and ticks them off as you go.
- Edits save as you type. Nothing goes online until you press **Publish** in the bottom bar. **See changes** lists what's waiting, with Undo for each.
- **Go online** puts your site on a free address like `yourname.pages.dev`. It needs a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, and the CMS walks you through it. Your own domain and a GitHub backup are optional, from the same page.
- The chip at the top shows whether your site is live and holds the maintenance switch.

## Make it yours

Open **Appearance** in the CMS to give the site your own look. The preview updates as you pick:

- **Palette** (Paper, Warm, Cool, Stone) and **Light, Dark or Auto**. Auto follows each visitor's device setting.
- **Accent colour** for links and highlights: a preset or any colour you like. The CMS warns you if it's hard to read.
- **Fonts:** Clean, Editorial (serif), Friendly or Technical.
- **Layout:** sidebar or centred, photo shape, and comfortable or compact spacing.
- **Browser tab icon:** your initials in your colours, or any one or two letters.
- **Projects** as rows, big images or a two-column grid. **Sidebar links** as text, with icons, or a "Get in touch" button. A **bold accent** and **subtle motion** if you like.

The share image for LinkedIn, WhatsApp and Discord follows your colours too.

**Sections** lets you rename Work, Experience and Toolkit (say "Projects" and "Education"), drag them into any order, and add your own: a short text like "Now", or a list like Awards or Certifications. Add a **headline** on the Profile page for one big line above your work.

## For developers

```
content/        your content: profile, projects, experience, toolkit, settings (JSON + Markdown)
site/           the Astro site that reads content/ and builds plain HTML
site/public/    photos, screenshots, résumé, share image
cms/            the local CMS (Node + Hono server, Alpine.js interface)
schema/         content rules shared by the site and the CMS
```

Prefer the terminal, or on Mac or Linux? You need Node.js 20+ and Git, then:

```bash
npm install
npm run cms
```

| Command | What it does |
|---|---|
| `npm run cms` | Start the CMS at `http://127.0.0.1:4000` |
| `npm run dev` | Site dev server only, on port 4321 |
| `npm run build` | Build the site into `site/dist` |
| `npm run preview` | Serve the built site |
| `npm run cms:shortcut` | Create the desktop shortcut again |

Publishing builds the site and uploads it to Cloudflare Pages with Wrangler, Cloudflare's official CLI. GitHub backup uses the GitHub CLI's device sign-in, so no password or token is stored by the CMS.

## Credits

Made by Danish Masri. Icons: [Simple Icons](https://simpleicons.org) (CC0) and [Lucide](https://lucide.dev) (ISC). Licensed under MIT, see [LICENSE](LICENSE).
