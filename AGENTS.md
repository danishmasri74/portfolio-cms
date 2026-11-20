# Guide for AI assistants

This folder is a personal portfolio: a static Astro site plus a small CMS that runs on the owner's computer. The owner edits content in the CMS and presses **Publish** to put it online. Help them by editing content, never by publishing.

## The easy way: use the MCP tools

If the `portfolio` MCP tools are available (Claude Desktop, Claude Code and other MCP apps), use them. They check every change against the content rules and save it the same way the CMS does. Start with `get_portfolio` to see what's there.

## Where things live

```
content/            what the owner edits. The only folder you should change.
  profile.json      name, role, bio, headline, details, links, email, photo, résumé
  projects/*.json   one file per project; a matching .md file is its write-up
  experience/*.json one file per job, degree or role; .md for a write-up
  toolkit.json      groups of tools and skills, with icons
  sections.json     section names, their order, and the owner's own sections
  theme.json        the look: palette, light or dark, accent, fonts, layout
  settings.json     page title, description, site address
  status.json       maintenance mode (don't change this)
schema/content.js   the rules for every file above: limits, required fields, formats
site/               the Astro site that reads content/ (don't change unless asked)
cms/                the CMS itself (don't change unless asked)
```

## Rules

- **Follow `schema/content.js`.** For example: a project summary is at most 180 characters, links start with `https://`, and dates are `YYYY-MM`. Keep JSON formatted with two-space indents.
- **Images and the résumé go through the CMS.** It resizes and names them. Don't add files to `site/public/` yourself.
- **Never publish.** Don't commit, push, deploy, or turn maintenance on or off. The owner reviews changes in the CMS (See changes) and presses Publish.
- **Never touch `cms/.local/`.** It holds this computer's private settings.
- **Write like the owner.** Short, plain sentences in the first person. No buzzwords, no exclamation marks, nothing made up: ask for facts you don't have.
- **Check your work** with `npm run build` when you edit files directly. It fails with a clear message if a rule is broken.
