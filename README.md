# Portfolio CMS

A personal portfolio site with a small CMS that runs on your own computer. You edit your profile, projects and experience in a simple window, and **Publish** puts the site online. There's no database and no server to pay for.

```
content/        your content: profile, projects, experience, toolkit, settings (JSON + Markdown)
site/           the Astro site that reads content/ and builds plain HTML
site/public/    photos, screenshots, résumé, share image
cms/            the local CMS (Node + Hono server, Alpine.js interface)
schema/         content rules shared by the site and the CMS
```

## What you need

- **Windows** (the desktop shortcut is Windows-only; on Mac or Linux you can still run `npm run cms` in a terminal)
- [Node.js](https://nodejs.org) 20 or newer
- [Git](https://git-scm.com)
- A free [GitHub](https://github.com) account, and optionally the [GitHub CLI](https://cli.github.com)
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account to put the site online

## Get your own copy

1. On this repository's GitHub page, click **Use this template → Create a new repository**. Make it private if you like.
   Don't just clone this repository: you can't publish to it, and the CMS will tell you so.
2. Clone your new repository and start the CMS:

```bash
git clone https://github.com/<you>/<your-repo>.git
cd <your-repo>
npm install
npm run cms
```

The CMS opens at `http://127.0.0.1:4000` with a live preview of the site. The first launch checks Git and GitHub and offers to add a **Portfolio CMS** shortcut to your desktop. After that, the shortcut starts the CMS without a console window. It stops by itself a minute after you close its window, or you can use **Quit**.

Replace the sample profile, project and experience with your own, then go online.

Edits save as you type, and nothing goes online until you press **Publish** in the bottom bar. **See changes** lists what's waiting, with Undo for each. The chip at the top shows whether your site is live and holds the maintenance switch.

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

## Putting it online (Cloudflare Pages)

Everything happens in the CMS, under **Hosting** in the sidebar:

1. **Connect Cloudflare.** A Cloudflare page opens in your browser. Sign in, then click Allow. The CMS uses Wrangler, Cloudflare's official CLI, and only asks to manage Pages sites and read your domains.
2. **Create site.** This makes a Cloudflare Pages project with a free address like `yourname.pages.dev`. That address becomes your site address straight away, so **you don't need a domain**.
3. **Publish.** Your site is live on `yourname.pages.dev` within seconds.

### Optional: your own domain

If you buy a domain (from any registrar, like Hostinger or Porkbun):

1. In Hosting, enter it under **Use domain**.
2. In the Cloudflare dashboard, click **Add a domain** and add it on the Free plan. This is the one step the CMS can't do for you.
3. Paste the two nameservers the CMS shows into your registrar.

The CMS waits until DNS has switched, then connects the domain and its `www.` version and sets up SSL. The domain becomes your site address, and the CMS reminds you 30 days before it expires. **Remove domain** switches back to the free address.

Every publish also pushes to your GitHub repository, as a backup.

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Site dev server only, on port 4321 |
| `npm run build` | Build the site into `site/dist` |
| `npm run preview` | Serve the built site |
| `npm run cms:shortcut` | Create the desktop shortcut again |

## Credits

Made by Danish Masri. Icons: [Simple Icons](https://simpleicons.org) (CC0) and [Lucide](https://lucide.dev) (ISC). Licensed under MIT, see [LICENSE](LICENSE).
