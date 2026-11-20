// Portfolio CMS front end (Alpine.js). One component drives every screen.
const clone = (o) => JSON.parse(JSON.stringify(o));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw Object.assign(new Error("The CMS isn't responding. Start it again from the desktop shortcut."), { offline: true });
  }
  const json = await res.json().catch(() => ({ ok: false, message: 'Unexpected response.' }));
  if (!json.ok) throw Object.assign(new Error(json.message || 'Something went wrong.'), { fields: json.fields || null, status: res.status });
  return json;
}

const DETAIL_ROWS = [
  ['location', 'Location', 'City, country'],
  ['pronouns', 'Pronouns', 'Your pronouns'],
  ['timezone', 'Timezone', 'Your timezone'],
  ['languages', 'Languages spoken', 'English, …'],
  ['learning', 'Currently learning', 'Rust and system design'],
  ['phone', 'Phone', 'Phone number'],
];

const blankProject = () => ({ title: '', year: new Date().getFullYear(), summary: '', stack: '', live: '', code: '', image: null, writeup: false, show: true });
const blankExperience = () => ({ title: '', org: '', start: new Date().toISOString().slice(0, 7), end: null, description: '', link: '', writeup: false, show: true });

document.addEventListener('alpine:init', () => {
  Alpine.data('cms', () => ({
    DETAIL_ROWS,
    ready: false,
    fatal: '',
    data: { profile: null, toolkit: null, settings: null, status: null, projects: [], experience: [], remote: '', branch: 'main', root: '' },
    setupDone: true,
    view: 'projects', // projects | project | experience | exp | profile | toolkit | settings | history | review | setup
    slug: null,
    isNew: false,
    tab: 'details',
    form: null,
    snap: '',
    writeup: '',
    writeupSnap: '',
    errors: {},
    saving: false,
    preview: { status: 'starting', url: null, log: [] },
    previewMode: 'desktop',
    nonce: 1,
    pane: { w: 600, h: 700 },
    changes: { items: [], ahead: 0, hasHead: true, undeployed: false, hosted: false },
    hosting: null,
    hostingForm: { project: '', domain: '', busy: '', error: '', changing: false },
    hostingTimer: null,
    busy: null,
    sync: { state: 'idle' },
    bar: null,
    result: null,
    lastCheck: null,
    history: [],
    commitMessage: '',
    picker: { open: false, g: -1, i: -1, q: '', kind: 'all', results: [], sel: null, loading: false },
    svg: {},
    hex: {}, // logo colours, for showing icons the way the site will
    modal: null,
    toast: '',
    drag: null,
    dropOn: null,
    resumeInfo: null,
    setupState: null,
    setupForm: { remote: '', repoName: 'portfolio', visibility: 'private', shortcut: true, busy: '', error: '' },
    ignoreHash: false,

    // ---------- lifecycle ----------
    async init() {
      try {
        await this.loadState();
      } catch (e) {
        this.fatal = e.message;
        return;
      }
      this.ready = true;
      window.addEventListener('hashchange', () => this.onHash());
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (this.canSave) this.save();
        }
        if (e.key === 'Escape') {
          if (this.picker.open) this.picker.open = false;
          else if (this.modal) this.modal = null;
        }
      });
      window.addEventListener('beforeunload', (e) => {
        if (this.dirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
      this.$nextTick(() => {
        const ro = new ResizeObserver(() => this.measure());
        if (this.$refs.pvb) ro.observe(this.$refs.pvb);
        this.measure();
      });
      if (!this.setupDone) location.hash = '#setup';
      await this.onHash(true);
      this.refreshChanges();
      this.loadHosting(true);
      this.loadExpiry();
      setInterval(() => this.refreshChanges(), 4000);
      setInterval(() => this.refreshPreview(), 3000);
      const windowId = Math.random().toString(36).slice(2);
      const ping = () => api('POST', '/api/ping', { id: windowId }).then(() => (this.lost = false)).catch(() => (this.lost = true));
      setInterval(ping, 10000);
      ping();
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ping());
      // Tell the CMS when the window closes, so it can stop in the background.
      window.addEventListener('pagehide', () => navigator.sendBeacon('/api/bye', windowId));
      // Outside links open in the default browser, not in this app window.
      document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        const href = a.href;
        if (!/^https?:/i.test(href) || href.startsWith(location.origin)) return;
        e.preventDefault();
        api('POST', '/api/open', { url: href }).catch(() => window.open(href, '_blank', 'noopener'));
      });
    },
    lost: false,
    expiry: null,
    async loadExpiry(refresh = false) {
      try {
        this.expiry = (await api('GET', `/api/domain-expiry${refresh ? '?refresh=1' : ''}`)).expiry;
        if (refresh) this.flash(this.expiry.ok ? 'Renewal date updated' : "Couldn't look up the date");
      } catch {}
    },

    async loadState() {
      const s = await api('GET', '/api/state');
      Object.assign(this.data, {
        profile: s.profile, toolkit: s.toolkit, settings: s.settings, status: s.status,
        projects: s.projects, experience: s.experience, remote: s.remote, branch: s.branch, root: s.root, previewPort: s.previewPort,
      });
      this.setupDone = s.setupDone;
      this.preview = s.preview;
      this.sync = s.sync;
      this.ensureSvgs(s.toolkit.groups.flatMap((g) => g.items.map((i) => i.icon)));
    },

    measure() {
      const el = this.$refs.pvb;
      if (el) this.pane = { w: el.clientWidth, h: el.clientHeight };
    },

    async refreshChanges() {
      try {
        const c = await api('GET', '/api/changes');
        this.changes = { items: c.items, ahead: c.ahead, hasHead: c.hasHead, undeployed: c.undeployed, hosted: c.hosted };
        this.busy = c.busy;
        this.sync = c.sync;
      } catch {}
    },
    async refreshPreview() {
      try {
        const { preview } = await api('GET', '/api/preview');
        const was = this.preview.status;
        this.preview = preview;
        if (was !== 'running' && preview.status === 'running') this.nonce++;
      } catch {}
    },

    // ---------- routing ----------
    parseHash() {
      const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean);
      const [a = 'projects', b, c] = parts;
      if (a === 'projects' && b) return { view: 'project', slug: b === 'new' ? null : b, isNew: b === 'new', tab: c === 'writeup' ? 'writeup' : 'details' };
      if (a === 'experience' && b) return { view: 'exp', slug: b === 'new' ? null : b, isNew: b === 'new', tab: c === 'writeup' ? 'writeup' : 'details' };
      const views = ['projects', 'experience', 'profile', 'toolkit', 'appearance', 'settings', 'history', 'review', 'setup', 'hosting'];
      return { view: views.includes(a) ? a : 'projects', slug: null, isNew: false, tab: 'details' };
    },
    hashFor(t) {
      if (t.view === 'project') return `#projects/${t.isNew ? 'new' : t.slug}${t.tab === 'writeup' ? '/writeup' : ''}`;
      if (t.view === 'exp') return `#experience/${t.isNew ? 'new' : t.slug}${t.tab === 'writeup' ? '/writeup' : ''}`;
      return `#${t.view}`;
    },
    go(hash) {
      location.hash = hash;
    },
    async onHash(first = false) {
      if (this.ignoreHash) {
        this.ignoreHash = false;
        return;
      }
      const t = this.parseHash();
      const sameForm = t.view === this.view && t.slug === this.slug && t.isNew === this.isNew;
      if (!first && sameForm) {
        this.tab = t.tab;
        return;
      }
      if (!first && this.dirty) {
        const back = this.hashFor({ view: this.view, slug: this.slug, isNew: this.isNew, tab: this.tab });
        this.ignoreHash = true;
        history.replaceState(null, '', back);
        this.ignoreHash = false;
        this.confirmBar(`Leave ${this.formName || 'this page'} without saving?`, 'Your edits will be lost.', 'Discard edits', () => {
          this.resetDirty();
          location.hash = this.hashFor(t);
        }, 'Keep editing');
        this.bar.whenDirty = true;
        return;
      }
      this.picker.open = false;
      this.errors = {};
      this.bar = null;
      Object.assign(this, { view: t.view, slug: t.slug, isNew: t.isNew, tab: t.tab });
      await this.loadView();
    },

    async loadView() {
      this.form = null;
      // Leaving Appearance: reload the preview so unsaved choices don't linger on it.
      if (this.view !== 'appearance' && this.themeSent) {
        this.themeSent = null;
        this.nonce++;
      }
      clearInterval(this.hostingTimer);
      this.hostingTimer = null;
      this.writeup = this.writeupSnap = '';
      try {
        if (this.view === 'projects' || this.view === 'experience') {
          const { items } = await api('GET', `/api/${this.view}`);
          this.data[this.view] = items;
        } else if (this.view === 'project' || this.view === 'exp') {
          const col = this.col;
          if (this.isNew) this.form = col === 'projects' ? blankProject() : blankExperience();
          else {
            const r = await api('GET', `/api/${col}/${this.slug}`);
            this.form = r.data;
            this.writeup = this.writeupSnap = r.writeup;
          }
        } else if (this.view === 'profile') {
          const { data } = await api('GET', '/api/profile');
          this.form = data;
        } else if (this.view === 'toolkit') {
          const { data } = await api('GET', '/api/toolkit');
          this.form = data;
          this.ensureSvgs(data.groups.flatMap((g) => g.items.map((i) => i.icon)));
        } else if (this.view === 'appearance') {
          const [t, opts] = await Promise.all([api('GET', '/api/theme'), this.themeOpts ? null : api('GET', '/api/theme/options')]);
          if (opts) this.themeOpts = opts;
          this.form = t.data;
          this.themeCheck = null;
          this.themeLive();
        } else if (this.view === 'settings') {
          const [s, st] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/state')]);
          this.data.status = st.status;
          this.data.remote = st.remote;
          this.form = { settings: s.data, status: st.status, previewPort: st.previewPort };
        } else if (this.view === 'history' || this.view === 'review') {
          this.history = (await api('GET', '/api/history')).items;
          if (this.view === 'review') {
            await this.refreshChanges();
            this.commitMessage = this.defaultMessage();
          }
        } else if (this.view === 'setup') {
          await this.loadSetup();
        } else if (this.view === 'hosting') {
          this.hostingForm.error = '';
          await this.loadHosting();
          let tick = 0;
          // Check often while waiting on something, rarely once everything is live.
          this.hostingTimer = setInterval(() => {
            tick++;
            const waiting = this.hosting?.loginPending || ['add', 'nameservers', 'ssl'].includes(this.domainState);
            if (this.view === 'hosting' && !this.hostingForm.busy && (waiting || tick % 10 === 0)) this.loadHosting(true);
          }, 6000);
        }
      } catch (e) {
        if (e.status === 404) {
          this.flash("That item doesn't exist any more.");
          return this.go(this.view === 'exp' ? '#experience' : '#projects');
        }
        this.flash(e.message);
      }
      this.snap = this.form ? JSON.stringify(this.form) : '';
    },

    get col() {
      return this.view === 'exp' || this.view === 'experience' ? 'experience' : 'projects';
    },
    get dirty() {
      return !!this.form && (JSON.stringify(this.form) !== this.snap || this.writeup !== this.writeupSnap);
    },
    get canSave() {
      return ['project', 'exp', 'profile', 'toolkit', 'appearance', 'settings'].includes(this.view) && !!this.form;
    },
    get formName() {
      if (this.view === 'project' || this.view === 'exp') return this.form?.title || (this.isNew ? 'the new entry' : 'this entry');
      return { profile: 'Profile', toolkit: 'Toolkit', appearance: 'Appearance', settings: 'Settings' }[this.view] || '';
    },
    resetDirty() {
      this.snap = this.form ? JSON.stringify(this.form) : '';
      this.writeupSnap = this.writeup;
    },
    navOn(name) {
      if (name === 'projects') return this.view === 'projects' || this.view === 'project';
      if (name === 'experience') return this.view === 'experience' || this.view === 'exp';
      return this.view === name;
    },
    sectionDirty(name) {
      return this.changes.items.some((i) => (name === 'projects' || name === 'experience' ? i.kind === name : i.key === name || (name === 'settings' && i.key === 'status')));
    },
    itemEdited(col, slug) {
      return this.changes.items.some((i) => i.key === `${col}/${slug}`);
    },

    // ---------- saving ----------
    err(path) {
      return this.errors[path] || '';
    },
    async save() {
      if (this.saving) return;
      this.saving = true;
      this.errors = {};
      try {
        if (this.view === 'project' || this.view === 'exp') {
          const col = this.col;
          if (this.form.end === '') this.form.end = null;
          if (this.isNew) {
            const { data } = await api('POST', `/api/${col}`, this.form);
            if (this.writeup.trim()) await api('PUT', `/api/${col}/${data.slug}/writeup`, { text: this.writeup });
            this.form = data;
            this.resetDirty();
            this.go(`#${col}/${data.slug}${this.tab === 'writeup' ? '/writeup' : ''}`);
          } else {
            const { data } = await api('PUT', `/api/${col}/${this.slug}`, this.form);
            if (this.writeup !== this.writeupSnap) await api('PUT', `/api/${col}/${this.slug}/writeup`, { text: this.writeup });
            this.form = data;
          }
        } else if (this.view === 'profile') {
          this.form = (await api('PUT', '/api/profile', this.form)).data;
          this.data.profile = this.form;
        } else if (this.view === 'toolkit') {
          const clean = clone(this.form);
          clean.groups.forEach((g) => g.items.forEach((it) => delete it.auto));
          this.form = (await api('PUT', '/api/toolkit', clean)).data;
          this.ensureSvgs(this.form.groups.flatMap((g) => g.items.map((i) => i.icon)));
        } else if (this.view === 'appearance') {
          this.form = (await api('PUT', '/api/theme', this.form)).data;
        } else if (this.view === 'settings') {
          const settings = (await api('PUT', '/api/settings', this.form.settings)).data;
          let status = this.form.status;
          try {
            status = (await api('PUT', '/api/status', this.form.status)).data;
          } catch (e) {
            if (e.fields) e.fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`status.${k}`, v]));
            throw e;
          }
          if (Number(this.form.previewPort) !== Number(this.data.previewPort)) {
            await api('PUT', '/api/setup/config', { previewPort: Number(this.form.previewPort) });
            this.data.previewPort = Number(this.form.previewPort);
            await api('POST', '/api/preview/restart');
          }
          this.form = { ...this.form, settings, status };
          this.data.settings = settings;
        }
        this.resetDirty();
        if (this.bar?.whenDirty) this.bar = null;
        this.result = null;
        this.flash('Saved');
        this.nonce++;
        this.refreshChanges();
        return true;
      } catch (e) {
        if (e.fields) {
          this.errors = this.view === 'settings' && !Object.keys(e.fields).some((k) => k.startsWith('status.') || k === 'previewPort')
            ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`settings.${k}`, v]))
            : e.fields;
          this.$nextTick(() => document.querySelector('.err input, .err textarea')?.focus());
        } else this.flash(e.message);
        return false;
      } finally {
        this.saving = false;
      }
    },
    cancelEdits() {
      if (this.isNew) return this.go(this.view === 'exp' ? '#experience' : '#projects');
      this.form = JSON.parse(this.snap);
      this.writeup = this.writeupSnap;
      this.errors = {};
    },
    get errorCount() {
      return Object.keys(this.errors).length;
    },

    async removeEntry() {
      this.confirmBar(`Delete ${this.form.title}?`, 'It disappears from the site when you publish. You can undo with Discard until then.', 'Delete', async () => {
        await api('DELETE', `/api/${this.col}/${this.slug}`);
        this.resetDirty();
        this.form = null;
        this.flash('Deleted');
        this.refreshChanges();
        this.nonce++;
        this.go(this.col === 'experience' ? '#experience' : '#projects');
      });
    },

    async toggleShow(col, item) {
      try {
        const { data } = await api('GET', `/api/${col}/${item.slug}`);
        await api('PUT', `/api/${col}/${item.slug}`, { ...data, show: !data.show });
        item.show = !data.show;
        this.nonce++;
        this.refreshChanges();
      } catch (e) {
        this.flash(e.message);
      }
    },

    // ---------- drag and drop ----------
    dragStart(list, i, e) {
      this.drag = { list, i };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    },
    dragOver(list, i, e) {
      if (!this.drag || this.drag.list !== list) return;
      e.preventDefault();
      this.dropOn = `${list}:${i}`;
    },
    async dropAt(list, i) {
      const d = this.drag;
      this.drag = null;
      this.dropOn = null;
      if (!d || d.list !== list || d.i === i) return;
      const arr = this.listFor(list);
      const [moved] = arr.splice(d.i, 1);
      arr.splice(i, 0, moved);
      if (list === 'projects' || list === 'experience') {
        await api('PUT', `/api/${list}/order`, { slugs: arr.map((x) => x.slug) });
        this.nonce++;
        this.refreshChanges();
      }
    },
    dragEnd() {
      this.drag = null;
      this.dropOn = null;
    },
    listFor(list) {
      if (list === 'projects' || list === 'experience') return this.data[list];
      if (list === 'links') return this.form.links;
      if (list === 'groups') return this.form.groups;
      if (list.startsWith('items:')) return this.form.groups[Number(list.slice(6))].items;
      return [];
    },

    // ---------- uploads ----------
    async upload(kind, file, extra = {}) {
      if (!file) return null;
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      try {
        return await api('POST', '/api/upload', fd);
      } catch (e) {
        this.flash(e.message);
        return null;
      }
    },
    async uploadProjectImage(file) {
      const r = await this.upload('project', file, { slug: this.slug || this.form.title || 'project' });
      if (r) {
        this.form.image = r.src;
        this.imageInfo = r;
      }
    },
    imageInfo: null,
    async uploadPhoto(file) {
      const r = await this.upload('photo', file);
      if (r) this.form.photo = { src: r.src, focusX: 50, focusY: 30 };
    },
    async uploadResume(file) {
      const r = await this.upload('resume', file);
      if (r) {
        this.form.resume = { ...this.form.resume, src: r.src, updated: r.updated };
        this.resumeInfo = r;
      }
    },
    async uploadShare(file) {
      const r = await this.upload('og', file);
      if (r) {
        this.form.settings.shareImage = 'custom';
        this.nonce++;
      }
    },
    setFocal(e) {
      const box = e.currentTarget.getBoundingClientRect();
      this.form.photo.focusX = Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)));
      this.form.photo.focusY = Math.round(Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)));
    },
    focalDrag(e) {
      if (e.buttons === 1) this.setFocal(e);
    },
    initials(name) {
      return String(name || '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    },

    // ---------- markdown ----------
    md(before, after = '', placeholder = '') {
      const ta = this.$refs.md;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = this.writeup.slice(s, e) || placeholder;
      this.writeup = this.writeup.slice(0, s) + before + sel + after + this.writeup.slice(e);
      this.$nextTick(() => {
        ta.focus();
        ta.setSelectionRange(s + before.length, s + before.length + sel.length);
      });
    },
    mdLine(prefix) {
      const ta = this.$refs.md;
      const s = ta.selectionStart;
      const lineStart = this.writeup.lastIndexOf('\n', s - 1) + 1;
      this.writeup = this.writeup.slice(0, lineStart) + prefix + this.writeup.slice(lineStart);
      this.$nextTick(() => {
        ta.focus();
        ta.setSelectionRange(s + prefix.length, s + prefix.length);
      });
    },
    async mdImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const r = await this.upload('writeup', file, { collection: this.col, slug: this.slug || this.form.title || 'item' });
      if (r) this.md(`\n![`, `](${r.src})\n`, 'Describe the image');
    },
    onMdPaste(e) {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        this.mdImage(file);
      }
    },
    onMdDrop(e) {
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) this.mdImage(file);
    },
    get words() {
      return this.writeup.trim() ? this.writeup.trim().split(/\s+/).length : 0;
    },

    // ---------- toolkit + icons ----------
    iconKey(icon) {
      return icon ? `${icon.set}:${icon.name}` : '';
    },
    async ensureSvgs(icons) {
      const missing = icons.filter((i) => i && !(this.iconKey(i) in this.svg));
      if (!missing.length) return;
      try {
        const { svgs, hexes = [] } = await api('POST', '/api/icons/svg', { icons: missing });
        missing.forEach((i, n) => {
          this.svg[this.iconKey(i)] = svgs[n];
          this.hex[this.iconKey(i)] = hexes[n] || null;
        });
      } catch {}
    },
    addGroup() {
      this.form.groups.push({ label: '', items: [] });
      this.$nextTick(() => [...document.querySelectorAll('.tgh input')].pop()?.focus());
    },
    addItem(gi) {
      this.form.groups[gi].items.push({ name: '', icon: null, auto: true });
      this.$nextTick(() => document.querySelectorAll(`[data-g="${gi}"] .it input`)?.[this.form.groups[gi].items.length - 1]?.focus());
    },
    async autoIcon(item) {
      if (!item.auto || !item.name.trim()) return;
      const { results } = await api('POST', '/api/icons/match', { names: [item.name] });
      if (results[0]) {
        item.icon = results[0];
        this.ensureSvgs([results[0]]);
      }
      item.auto = false;
    },
    openPicker(gi, ii) {
      if (this.picker.open && this.picker.g === gi && this.picker.i === ii) return (this.picker.open = false);
      const item = this.form.groups[gi].items[ii];
      this.picker = { open: true, g: gi, i: ii, q: item.name, kind: 'all', results: [], sel: item.icon, loading: true, forName: item.name };
      this.searchIcons();
      this.$nextTick(() => document.querySelector('.pk input')?.select());
    },
    searchTimer: null,
    searchIcons() {
      clearTimeout(this.searchTimer);
      this.picker.loading = true;
      this.searchTimer = setTimeout(async () => {
        const q = this.picker.q;
        try {
          const { results } = await api('GET', `/api/icons?q=${encodeURIComponent(q)}&kind=${this.picker.kind}`);
          if (q !== this.picker.q) return;
          results.forEach((r) => (this.svg[`${r.set}:${r.name}`] = r.svg));
          const cur = this.form.groups[this.picker.g]?.items[this.picker.i]?.icon;
          // Keep the item's current icon visible at the start, even if the search doesn't match it.
          if (cur && this.svg[this.iconKey(cur)] && !results.some((r) => this.iconKey(r) === this.iconKey(cur)) && (this.picker.kind === 'all' || this.picker.kind === cur.set)) {
            results.unshift({ set: cur.set, name: cur.name, title: cur.name.replace(/-/g, ' '), svg: this.svg[this.iconKey(cur)], current: true });
          }
          this.picker.results = results;
          if (!this.picker.sel || !results.some((r) => this.iconKey(r) === this.iconKey(this.picker.sel))) this.picker.sel = cur && results.some((r) => this.iconKey(r) === this.iconKey(cur)) ? cur : results[0] ? { set: results[0].set, name: results[0].name } : null;
        } finally {
          this.picker.loading = false;
        }
      }, 160);
    },
    get pickerSelTitle() {
      const r = this.picker.results.find((x) => this.iconKey(x) === this.iconKey(this.picker.sel));
      return r ? r.title : '';
    },
    useIcon(icon) {
      const item = this.form.groups[this.picker.g].items[this.picker.i];
      item.icon = icon ? { set: icon.set, name: icon.name } : null;
      item.auto = false;
      this.picker.open = false;
    },

    // ---------- appearance ----------
    themeOpts: null,
    themeCheck: null,
    themeTimer: null,
    themeSent: null,
    /** Show unsaved Appearance choices in the preview straight away (the preview page listens for this). */
    themeLive() {
      clearTimeout(this.themeTimer);
      if (this.view !== 'appearance' || !this.form) return;
      const form = clone(this.form);
      this.themeTimer = setTimeout(async () => {
        try {
          const r = await api('POST', '/api/theme/preview', form);
          this.themeCheck = r;
          this.themeSent = { type: 'portfolio-theme', css: r.css, attrs: r.attrs };
          this.sendTheme();
        } catch {}
      }, 120);
    },
    // A plain copy: the browser can't send Alpine's reactive objects to another page.
    sendTheme() {
      if (this.themeSent) this.$refs.frame?.contentWindow?.postMessage(JSON.parse(JSON.stringify(this.themeSent)), '*');
    },
    /** The preview reloaded: put the unsaved look back on it. */
    framed() {
      if (this.view === 'appearance') this.sendTheme();
    },
    get accentNote() {
      const c = this.themeCheck;
      if (!c || this.form?.mode === 'dark') return { ok: true, text: 'Easy to read' };
      if (c.contrast >= 4.5) return { ok: true, text: 'Easy to read' };
      if (c.contrast >= 3) return { ok: false, text: 'A bit light for links and small text. A darker shade reads better.' };
      return { ok: false, text: 'Hard to read on this background. Pick a darker colour.' };
    },

    // ---------- preview ----------
    get previewPath() {
      if ((this.view === 'project' || this.view === 'exp') && this.tab === 'writeup' && this.form?.writeup && this.form.show && !this.isNew)
        return `/${this.col}/${this.slug}/`;
      return '/';
    },
    get previewHl() {
      if ((this.view === 'project' || this.view === 'exp') && this.slug && this.previewPath === '/') return `${this.col}/${this.slug}`;
      if (this.view === 'profile' || this.view === 'toolkit') return this.view;
      return '';
    },
    get previewSrc() {
      if (!this.preview.url) return 'about:blank';
      const q = new URLSearchParams({ t: String(this.nonce) });
      if (this.previewHl) q.set('hl', this.previewHl);
      return `${this.preview.url}${this.previewPath}?${q}`;
    },
    get frameStyle() {
      const { w, h } = this.pane;
      if (this.previewMode === 'phone') {
        const fw = 402, fh = 856;
        const s = Math.min(1, (w - 32) / fw, (h - 32) / fh);
        return `width:${fw}px;height:${fh}px;transform:scale(${s});left:${Math.max(0, (w - fw * s) / 2)}px;top:16px`;
      }
      const s = w / 1280;
      return `width:1280px;height:${Math.ceil(h / s)}px;transform:scale(${s})`;
    },
    restartPreview() {
      api('POST', '/api/preview/restart').then((r) => (this.preview = r.preview));
    },

    // ---------- bottom bar ----------
    confirmBar(text, sub, yes, fn, no = 'Cancel', tone = 'warn') {
      this.bar = {
        tone, text, sub,
        actions: [
          { label: no, kind: 'ghost', fn: () => (this.bar = null) },
          { label: yes, kind: 'dark', fn: async () => { this.bar = null; await fn(); } },
        ],
      };
    },
    get barView() {
      // Prompts about unsaved edits go away by themselves once the edits are saved or undone.
      if (this.bar && !(this.bar.whenDirty && !this.dirty)) return this.bar;
      if (this.busy === 'publishing') return { tone: 'busy', text: 'Publishing…', sub: this.changes.hosted ? 'Building the site and uploading it to Cloudflare.' : 'Checking the site and sending it to GitHub.' };
      if (this.busy === 'checking') return { tone: 'busy', text: 'Checking…', sub: 'Building every page to make sure nothing is broken.' };
      if (this.result) return this.result;
      const n = this.changes.items.length;
      if (n) {
        return {
          tone: 'warn',
          text: `${n} unpublished change${n === 1 ? '' : 's'}`,
          sub: this.changes.items.map((i) => i.label).join(', '),
          actions: [
            { label: 'Discard', kind: 'ghost', fn: () => this.discardAll(), show: this.changes.hasHead },
            { label: 'Check', kind: '', fn: () => this.runCheck() },
            { label: 'Review', kind: '', fn: () => this.go('#review') },
            { label: 'Publish ▸', kind: 'dark', fn: () => this.quickPublish() },
          ],
        };
      }
      if (this.changes.undeployed) {
        return { tone: 'warn', text: 'Saved, not live yet', sub: 'The latest version is in history but not on your site.', actions: [{ label: 'Publish ▸', kind: 'dark', fn: () => this.retrySync() }] };
      }
      if (this.changes.ahead) {
        return { tone: 'warn', text: `${this.changes.ahead} publish${this.changes.ahead === 1 ? '' : 'es'} waiting to upload`, sub: 'Saved in history but not on GitHub yet.', actions: [{ label: 'Retry', kind: 'dark', fn: () => this.retrySync() }] };
      }
      return {
        tone: 'ok',
        text: 'Everything published',
        sub: this.history[0] ? `Last publish ${this.fmtDate(this.history[0].date)}` : '',
        actions: [{ label: 'Check', kind: '', fn: () => this.runCheck() }, ...(this.liveUrl ? [{ label: 'View live ↗', kind: '', href: this.liveUrl }] : [])],
      };
    },
    discardAll() {
      const labels = this.changes.items.map((i) => i.label);
      this.confirmBar(`Discard ${labels.length} unpublished change${labels.length === 1 ? '' : 's'}?`, `${labels.join(', ')} go back to the live version.`, 'Discard', async () => {
        try {
          await api('POST', '/api/discard', {});
          await this.afterDiscard();
        } catch (e) {
          this.flash(e.message);
        }
      });
    },
    async discardOne(item) {
      try {
        await api('POST', '/api/discard', { keys: [item.key] });
        await this.afterDiscard();
      } catch (e) {
        this.flash(e.message);
      }
    },
    async afterDiscard() {
      this.resetDirty();
      await this.loadState();
      await this.refreshChanges();
      await this.loadView();
      this.nonce++;
      this.flash('Discarded');
    },
    async runCheck() {
      if (this.dirty) return this.needSave(() => this.runCheck());
      this.result = null;
      this.busy = 'checking';
      try {
        const { check } = await api('POST', '/api/check');
        this.lastCheck = { ...check, at: new Date().toISOString() };
        const broken = check.links?.broken || [];
        const built = `${check.pages ? `${check.pages} pages built` : 'All pages built'} in ${check.seconds} s`;
        if (!check.ok) this.result = { tone: 'bad', text: 'Check failed', sub: check.message, actions: [{ label: 'Retry', kind: 'dark', fn: () => this.runCheck() }] };
        else if (broken.length) {
          this.result = {
            tone: 'warn',
            text: `${broken.length} link${broken.length === 1 ? ' looks' : 's look'} broken`,
            sub: broken.map((b) => `${b.where[0]}: ${b.reason}`).join(' · '),
            actions: [{ label: 'See details', kind: '', fn: () => { this.result = null; this.go('#review'); } }, { label: 'OK', kind: 'ghost', fn: () => (this.result = null) }],
          };
        } else {
          const linkNote = check.links?.offline ? " Links weren't checked because you're offline." : check.links ? ` ${check.links.checked} links working.` : '';
          this.result = { tone: 'ok', text: 'Check passed', sub: `${built}, nothing broken.${linkNote}`, actions: [{ label: 'OK', kind: 'ghost', fn: () => (this.result = null) }] };
        }
      } catch (e) {
        this.flash(e.message);
      } finally {
        this.busy = null;
      }
    },
    needSave(then) {
      this.bar = {
        whenDirty: true,
        tone: 'warn',
        text: `Save ${this.formName} first?`,
        sub: 'Unsaved edits are not included otherwise.',
        actions: [
          { label: 'Cancel', kind: 'ghost', fn: () => (this.bar = null) },
          { label: 'Save and continue', kind: 'pri', fn: async () => { this.bar = null; if (await this.save()) then(); } },
        ],
      };
    },
    quickPublish() {
      if (!this.data.settings?.quickPublish) return this.go('#review');
      this.publish('');
    },
    async publish(message) {
      if (this.dirty) return this.needSave(() => this.publish(message));
      this.result = null;
      this.busy = 'publishing';
      try {
        const r = await api('POST', '/api/publish', { message });
        this.handlePublish(r);
      } catch (e) {
        this.flash(e.message);
      } finally {
        this.busy = null;
        this.loadHosting(true);
        await this.refreshChanges();
        this.history = (await api('GET', '/api/history').catch(() => ({ items: this.history }))).items;
      }
    },
    get liveUrl() {
      const h = this.hosting;
      if (this.changes.hosted && h) {
        if (h.domain && h.pagesDomains?.some((d) => d.name === h.domain && d.status === 'active')) return `https://${h.domain}`;
        if (h.subdomain) return `https://${h.subdomain}`;
      }
      return this.data.remote ? this.data.settings?.siteUrl : '';
    },
    handlePublish(r) {
      const live = this.liveUrl || r.url || this.data.settings?.siteUrl;
      const domain = (live || '').replace(/^https?:\/\//, '');
      if (r.result === 'published') {
        const backup = r.backupFailed ? " GitHub backup didn't upload. It retries on the next publish." : '';
        this.result = { tone: 'ok', text: `Published at ${this.fmtTime(r.at)}`, sub: `Live on ${domain} ${this.changes.hosted ? 'in a few seconds' : 'in about a minute'}.${backup}`, actions: [{ label: 'View live ↗', kind: '', href: live }, { label: 'OK', kind: 'ghost', fn: () => (this.result = null) }] };
        if (this.view === 'review') this.go('#projects');
      } else if (r.result === 'local') {
        this.result = { tone: 'warn', text: 'Saved to history', sub: 'Connect GitHub in Settings to put the site online.', actions: [{ label: 'Open Settings', kind: '', fn: () => { this.result = null; this.go('#settings'); } }] };
      } else if (r.result === 'nothing') {
        this.flash('Nothing to publish');
      } else if (r.result === 'check-failed') {
        this.lastCheck = { ...r.check, at: new Date().toISOString() };
        this.result = { tone: 'bad', text: 'Publish stopped: Check failed', sub: r.check.message, actions: [{ label: 'Retry', kind: 'dark', fn: () => this.publish('') }] };
      } else if (r.result === 'deploy-failed') {
        const m = {
          network: ["Couldn't reach Cloudflare", "Your changes are saved. Retry when you're back online.", 'Retry'],
          auth: ['Cloudflare needs you to sign in again', 'Reconnect in Hosting, then publish.', 'Open Hosting'],
          build: ['Publish stopped: the site failed to build', r.message, 'Retry'],
          setup: ["Hosting isn't set up yet", 'Create the site in Hosting first.', 'Open Hosting'],
        }[r.reason] || ['Upload to Cloudflare failed', r.message || 'Cloudflare reported an error.', 'Retry'];
        const toHosting = m[2] === 'Open Hosting';
        this.result = { tone: 'bad', text: m[0], sub: m[1], actions: [{ label: m[2], kind: 'dark', fn: () => { this.result = null; if (toHosting) this.go('#hosting'); else this.retrySync(); } }] };
      } else if (r.result === 'push-failed') {
        const m = {
          network: ["Couldn't reach GitHub", 'Your changes are saved and still unpublished.', 'Retry'],
          behind: ['GitHub has newer changes from another device', "They'll be merged with yours.", 'Pull and publish'],
          auth: ["GitHub didn't accept the sign-in", 'Check the connection in Settings, then retry.', 'Retry'],
          conflict: ['Your changes clash with newer ones on GitHub', 'Open the folder in a git tool to resolve it, then retry.', 'Retry'],
          unknown: ['Publishing failed', r.message || 'Git reported an error.', 'Retry'],
        }[r.reason || 'unknown'];
        this.result = { tone: r.reason === 'behind' ? 'warn' : 'bad', text: m[0], sub: m[1], actions: [{ label: m[2], kind: 'dark', fn: () => this.retrySync() }] };
      }
    },
    async retrySync() {
      this.result = null;
      this.busy = 'publishing';
      try {
        this.handlePublish({ ...(await api('POST', '/api/sync/retry')), at: new Date().toISOString() });
      } catch (e) {
        this.flash(e.message);
      } finally {
        this.busy = null;
        this.loadHosting(true);
        this.refreshChanges();
      }
    },
    defaultMessage() {
      const names = this.changes.items.map((i) => (i.kind === 'single' ? i.label.toLowerCase() : i.label));
      if (!names.length) return '';
      if (names.length === 1) return `Update ${names[0]}`;
      return `Update ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    },
    revert(h) {
      this.confirmBar(`Go back to "${h.message}"?`, 'Content returns to that version as unpublished changes. Nothing goes online until you publish.', 'Revert', async () => {
        try {
          await api('POST', '/api/revert', { hash: h.hash });
          await this.afterDiscard();
          this.flash('Reverted. Review and publish when ready.');
        } catch (e) {
          this.flash(e.message);
        }
      });
    },

    // ---------- maintenance ----------
    async setMaintenance(on) {
      this.modal = null;
      this.busy = 'publishing';
      try {
        const r = await api('POST', '/api/maintenance', { on });
        this.data.status = r.status;
        if (this.form?.status) {
          this.form.status.maintenance = r.status.maintenance;
          const snap = JSON.parse(this.snap);
          snap.status.maintenance = r.status.maintenance;
          this.snap = JSON.stringify(snap);
        }
        if (r.result === 'published') this.result = { tone: on ? 'warn' : 'ok', text: on ? 'Maintenance mode is live' : 'Your portfolio is back', sub: `Visitors see the change in about a minute.`, actions: [{ label: 'OK', kind: 'ghost', fn: () => (this.result = null) }] };
        else this.handlePublish(r);
        this.nonce++;
      } catch (e) {
        this.flash(e.message);
      } finally {
        this.busy = null;
        this.refreshChanges();
      }
    },

    // ---------- title bar ----------
    get renewal() {
      if (this.expiry?.reason === 'no-domain') return null;
      const d = this.expiry?.ok ? this.expiry.expires : this.data.settings?.domainRenews;
      if (!d) return null;
      const days = Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
      if (days > 30) return null;
      const domain = this.expiry?.domain || (this.data.settings.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'Your domain';
      return { days, text: days < 0 ? `${domain} expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? `${domain} expires today` : `${domain} expires in ${days} day${days === 1 ? '' : 's'}` };
    },
    get syncText() {
      const s = this.sync || {};
      if (this.lost) return ['The CMS stopped. Open it again from the desktop shortcut.', 'var(--bad)'];
      if (this.changes.hosted && this.hosting?.lastDeployAt && s.state !== 'pulling') return [`Live · last upload ${this.fmtDate(this.hosting.lastDeployAt)}`, 'var(--ok)'];
      if (s.state === 'pulling') return ['Getting the latest from GitHub…', 'var(--accent)'];
      if (s.state === 'offline') return ['Offline · changes are saved on this laptop', '#a0a2a6'];
      if (s.state === 'error') return ['Last upload failed', 'var(--bad)'];
      if (!this.data.remote) return ['Not connected to GitHub yet', '#a0a2a6'];
      if (s.state === 'local') return ['Connected to GitHub · nothing uploaded yet', '#a0a2a6'];
      return [`Up to date with GitHub${s.at ? ` · ${this.fmtTime(s.at)}` : ''}`, 'var(--ok)'];
    },
    async quit() {
      if (this.dirty) {
        this.confirmBar('Quit without saving?', `Your edits to ${this.formName} will be lost.`, 'Quit', () => this.doQuit(), 'Keep editing');
        this.bar.whenDirty = true;
        return;
      }
      this.doQuit();
    },
    async doQuit() {
      this.resetDirty();
      await api('POST', '/api/quit').catch(() => {});
      this.fatal = 'The CMS has stopped. You can close this window.';
      setTimeout(() => window.close(), 300);
    },

    // ---------- setup ----------
    async loadSetup() {
      this.setupState = (await api('GET', '/api/setup')).checks;
    },
    async setupAction(fn) {
      this.setupForm.error = '';
      this.setupForm.busy = fn;
      try {
        if (fn === 'init') await api('POST', '/api/setup/init');
        if (fn === 'remote') await api('POST', '/api/setup/remote', { url: this.setupForm.remote });
        if (fn === 'gh') await api('POST', '/api/setup/gh-create', { name: this.setupForm.repoName, visibility: this.setupForm.visibility });
        if (fn === 'preview') await api('POST', '/api/preview/restart');
        await this.loadSetup();
        await this.loadState();
      } catch (e) {
        this.setupForm.error = e.message;
      } finally {
        this.setupForm.busy = '';
      }
    },
    async finishSetup() {
      this.setupForm.busy = 'finish';
      this.setupForm.error = '';
      try {
        if (!this.setupState.repo.hasHead) await api('POST', '/api/setup/init');
        if (this.setupForm.shortcut && !this.setupState.shortcut.ok) await api('POST', '/api/setup/shortcut');
        await api('POST', '/api/setup/done');
        this.setupDone = true;
        await this.loadState();
        this.go('#projects');
      } catch (e) {
        this.setupForm.error = e.message;
      } finally {
        this.setupForm.busy = '';
      }
    },

    // ---------- hosting ----------
    async loadHosting(quiet = false) {
      try {
        this.hosting = (await api('GET', '/api/hosting')).hosting;
        if (!this.hostingForm.project) this.hostingForm.project = this.slugName(this.data.profile?.name);
        if (!this.hostingForm.domain) this.hostingForm.domain = (this.data.settings?.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      } catch (e) {
        if (!quiet) this.hostingForm.error = e.message;
      }
    },
    slugName(name) {
      return String(name || 'portfolio').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'portfolio';
    },
    async hostingAction(name) {
      this.hostingForm.error = '';
      this.hostingForm.busy = name;
      try {
        if (name === 'login') await api('POST', '/api/hosting/login');
        if (name === 'cancel') await api('POST', '/api/hosting/login/cancel');
        if (name === 'logout') await api('POST', '/api/hosting/logout');
        if (name === 'project') {
          await api('POST', '/api/hosting/project', { name: this.hostingForm.project.trim() });
          await this.loadState();
          this.loadExpiry(true);
        }
        if (name === 'domain') {
          await api('POST', '/api/hosting/domain', { domain: this.hostingForm.domain });
          this.hostingForm.changing = false;
          await this.loadState();
          this.loadExpiry(true);
        }
        if (name === 'remove') {
          await api('DELETE', '/api/hosting/domain');
          await this.loadState();
          this.loadExpiry(true);
        }
        if (name === 'deploy') {
          this.result = null;
          this.busy = 'publishing';
          try {
            const r = await api('POST', '/api/hosting/deploy');
            this.handlePublish({ ...r, at: r.at || new Date().toISOString() });
          } finally {
            this.busy = null;
          }
        }
        await this.loadHosting();
        this.refreshChanges();
      } catch (e) {
        this.hostingForm.error = e.message;
      } finally {
        this.hostingForm.busy = '';
      }
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.flash('Copied');
      } catch {
        this.flash(text);
      }
    },
    get domainState() {
      const h = this.hosting;
      if (!h?.domain || this.hostingForm.changing) return 'none';
      if (!h.zone) return 'add';
      if (h.zone.status !== 'active') return 'nameservers';
      const ds = h.pagesDomains || [];
      if (ds.length && ds.every((d) => d.status === 'active')) return 'live';
      return 'ssl';
    },

    // ---------- helpers ----------
    flash(msg) {
      this.toast = msg;
      clearTimeout(this._t);
      this._t = setTimeout(() => (this.toast = ''), 2600);
    },
    fmtTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    fmtDate(iso) {
      const d = new Date(iso);
      return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${this.fmtTime(iso)}`;
    },
    fmtRange(start, end) {
      if (!start) return '';
      const [sy, sm] = start.split('-').map(Number);
      if (!end) return `${MONTHS[sm - 1]} ${sy} – now`;
      const [ey, em] = end.split('-').map(Number);
      if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sy}`;
      if (sy === ey) return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${sy}`;
      return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
    },
    fmtDay(ymd) {
      if (!ymd) return '';
      const [y, m, d] = ymd.split('-').map(Number);
      return `${d} ${MONTHS[m - 1]} ${y}`;
    },
    fmtSize(b) {
      return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
    },
    fileName(p) {
      return (p || '').split('/').pop();
    },
    count(s, max) {
      const n = (s || '').length;
      return { text: `${n} / ${max}`, over: n > max };
    },
  }));
});
