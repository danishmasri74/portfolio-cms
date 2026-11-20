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
  if (!json.ok) throw Object.assign(new Error(json.message || 'Something went wrong.'), { fields: json.fields || null, reason: json.reason || null, status: res.status });
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
    // Autosave: edits save on their own after a short pause. Undo goes back to how the page was when opened.
    saveState: 'idle', // idle | pending | saving | saved | error | needs-title
    autoTimer: null,
    pageStart: '',
    pageWasNew: false,
    writeupStart: '',
    panel: false,
    siteMenu: false,
    maintForm: null,
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
      this.$watch('form', () => this.queueSave());
      this.$watch('writeup', () => this.queueSave());
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.flushSave();
        }
        if (e.key === 'Escape') {
          if (this.picker.open) this.picker.open = false;
          else if (this.modal) this.modal = null;
          else if (this.siteMenu) this.siteMenu = false;
          else if (this.panel) this.panel = false;
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
        startHidden: s.startHidden,
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
      const views = ['start', 'projects', 'experience', 'profile', 'toolkit', 'sections', 'appearance', 'settings', 'history', 'setup', 'hosting', 'domain', 'github'];
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
        // Save what's waiting before leaving. Only stop if something can't be saved yet.
        const back = this.hashFor({ view: this.view, slug: this.slug, isNew: this.isNew, tab: this.tab });
        this.ignoreHash = true;
        history.replaceState(null, '', back);
        this.ignoreHash = false;
        if (await this.flushSave()) {
          location.hash = this.hashFor(t);
          return;
        }
        this.confirmBar(this.isNew && this.saveState === 'needs-title' ? 'Leave without adding this?' : "Some edits can't be saved yet", this.isNew && this.saveState === 'needs-title' ? 'It needs a title before it can be saved.' : 'Fix the highlighted field, or leave and lose those edits.', 'Leave anyway', () => {
          this.resetDirty();
          location.hash = this.hashFor(t);
        }, 'Stay');
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
      clearTimeout(this.autoTimer);
      this.saveState = 'idle';
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
        } else if (this.view === 'sections') {
          this.form = (await api('GET', '/api/sections')).data;
          this.openSec = null;
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
          this.form = { settings: s.data };
          this.portInput = st.previewPort;
        } else if (this.view === 'history') {
          this.history = (await api('GET', '/api/history')).items;
        } else if (this.view === 'setup') {
          await this.loadWelcome();
        } else if (this.view === 'start') {
          await this.loadState();
          this.loadHosting(true);
        } else if (this.view === 'github') {
          await this.loadGithub();
          this.hostingTimer = setInterval(() => {
            if (this.view === 'github' && this.gh?.login?.pending) this.loadGithub();
          }, 3000);
        } else if (this.view === 'hosting' || this.view === 'domain') {
          this.hostingForm.error = '';
          await this.loadHosting();
          let tick = 0;
          // Check often while waiting on something, rarely once everything is live.
          this.hostingTimer = setInterval(() => {
            tick++;
            const waiting = this.hosting?.loginPending || ['add', 'nameservers', 'ssl'].includes(this.domainState);
            if ((this.view === 'hosting' || this.view === 'domain') && !this.hostingForm.busy && (waiting || tick % 10 === 0)) this.loadHosting(true);
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
      this.pageStart = this.snap;
      this.pageWasNew = this.isNew;
      this.writeupStart = this.writeup;
    },

    get col() {
      return this.view === 'exp' || this.view === 'experience' ? 'experience' : 'projects';
    },
    get dirty() {
      return !!this.form && (JSON.stringify(this.form) !== this.snap || this.writeup !== this.writeupSnap);
    },
    get canSave() {
      return ['project', 'exp', 'profile', 'toolkit', 'sections', 'appearance', 'settings'].includes(this.view) && !!this.form;
    },
    get formName() {
      if (this.view === 'project' || this.view === 'exp') return this.form?.title || (this.isNew ? 'the new entry' : 'this entry');
      return { profile: 'Profile', toolkit: 'Toolkit', sections: 'Sections', appearance: 'Appearance', settings: 'Settings' }[this.view] || '';
    },
    resetDirty() {
      this.snap = this.form ? JSON.stringify(this.form) : '';
      this.writeupSnap = this.writeup;
    },
    // ---------- autosave ----------
    queueSave() {
      if (!this.canSave) return;
      if (!this.dirty) {
        // Edited back to what's already saved: nothing to do, so clear any old error.
        if (this.saveState === 'error' || this.saveState === 'pending' || this.saveState === 'needs-title') {
          clearTimeout(this.autoTimer);
          this.errors = {};
          this.saveState = this.isNew ? 'idle' : 'saved';
        }
        return;
      }
      clearTimeout(this.autoTimer);
      this.saveState = this.isNew && !String(this.form.title || '').trim() ? 'needs-title' : 'pending';
      if (this.saveState === 'needs-title') return;
      this.autoTimer = setTimeout(() => this.save(), 700);
    },
    /** Save now if anything is waiting. Resolves true when nothing is left unsaved. */
    async flushSave() {
      clearTimeout(this.autoTimer);
      if (!this.canSave || !this.dirty) return true;
      if (this.isNew && !String(this.form.title || '').trim()) return false;
      while (this.saving) await new Promise((r) => setTimeout(r, 60));
      if (!this.dirty) return true;
      return this.save();
    },
    get canUndo() {
      return !!this.form && !this.pageWasNew && (JSON.stringify(this.form) !== this.pageStart || this.writeup !== this.writeupStart);
    },
    undoPage() {
      this.form = JSON.parse(this.pageStart);
      this.writeup = this.writeupStart;
      this.errors = {};
      this.flash('Back to how it was when you opened it');
    },
    get saveText() {
      return {
        pending: 'Saving…',
        saving: 'Saving…',
        saved: '✓ Saved',
        error: 'Not saved · fix the highlighted field',
        'needs-title': 'Add a title to save',
      }[this.saveState] || '';
    },
    navOn(name) {
      if (name === 'hosting') return ['hosting', 'domain', 'github'].includes(this.view);
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
      if (this.saving || !this.form) return false;
      this.saving = true;
      this.saveState = 'saving';
      // What gets saved. The form itself is never replaced by the server's copy, so typing is never interrupted.
      const sent = JSON.stringify(this.form);
      const sentWriteup = this.writeup;
      const view = this.view;
      try {
        if (view === 'project' || view === 'exp') {
          const col = this.col;
          const body = JSON.parse(sent);
          if (body.end === '') body.end = null;
          if (this.isNew) {
            const { data } = await api('POST', `/api/${col}`, body);
            if (sentWriteup.trim()) await api('PUT', `/api/${col}/${data.slug}/writeup`, { text: sentWriteup });
            // Now it exists: switch to its own address without reloading the page you're typing in.
            this.isNew = false;
            this.slug = data.slug;
            this.ignoreHash = true;
            history.replaceState(null, '', `#${col}/${data.slug}${this.tab === 'writeup' ? '/writeup' : ''}`);
            this.ignoreHash = false;
          } else {
            await api('PUT', `/api/${col}/${this.slug}`, body);
            if (sentWriteup !== this.writeupSnap) await api('PUT', `/api/${col}/${this.slug}/writeup`, { text: sentWriteup });
          }
        } else if (view === 'profile') {
          this.data.profile = (await api('PUT', '/api/profile', JSON.parse(sent))).data;
        } else if (view === 'toolkit') {
          const clean = JSON.parse(sent);
          clean.groups.forEach((g) => g.items.forEach((it) => delete it.auto));
          const saved = (await api('PUT', '/api/toolkit', clean)).data;
          // New items get an icon on the server: copy just those across.
          saved.groups.forEach((g, gi) => g.items.forEach((it, ii) => {
            const mine = this.form.groups[gi]?.items[ii];
            if (mine && mine.icon === undefined) mine.icon = it.icon;
          }));
          this.ensureSvgs(saved.groups.flatMap((g) => g.items.map((i) => i.icon)));
        } else if (view === 'sections') {
          await api('PUT', '/api/sections', JSON.parse(sent));
        } else if (view === 'appearance') {
          await api('PUT', '/api/theme', JSON.parse(sent));
        } else if (view === 'settings') {
          this.data.settings = (await api('PUT', '/api/settings', JSON.parse(sent).settings)).data;
        }
        if (this.view !== view) return true;
        this.snap = JSON.stringify(this.form) === sent ? JSON.stringify(this.form) : sent;
        this.writeupSnap = sentWriteup;
        this.errors = {};
        this.saveState = this.dirty ? 'pending' : 'saved';
        if (this.bar?.whenDirty) this.bar = null;
        if (view !== 'appearance') this.nonce++;
        this.refreshChanges();
        return true;
      } catch (e) {
        if (e.fields) {
          this.errors = view === 'settings' ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`settings.${k}`, v])) : e.fields;
          this.saveState = 'error';
        } else {
          this.saveState = 'error';
          this.flash(e.message);
        }
        return false;
      } finally {
        this.saving = false;
        // More typing happened while saving: save again shortly.
        if (this.saveState === 'pending') this.queueSave();
      }
    },
    portInput: 4321,
    async applyPort() {
      const port = Number(this.portInput);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) return this.flash('Use a number between 1024 and 65535.');
      if (port === Number(this.data.previewPort)) return;
      await api('PUT', '/api/setup/config', { previewPort: port });
      this.data.previewPort = port;
      await api('POST', '/api/preview/restart');
      this.flash('Preview restarted on the new port');
    },
    get errorCount() {
      return Object.keys(this.errors).length;
    },

    async removeEntry() {
      this.confirmBar(`Delete ${this.form.title}?`, 'It leaves your site when you publish. Until then, Undo it in the Publish panel.', 'Delete', async () => {
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
      if (list === 'order') return this.form.order;
      if (list.startsWith('secitems:')) return this.sec(list.slice(9))?.items || [];
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

    // ---------- sections ----------
    openSec: null,
    isBuiltIn(id) {
      return ['work', 'experience', 'toolkit'].includes(id);
    },
    builtInName(id) {
      return { work: 'Work', experience: 'Experience', toolkit: 'Toolkit' }[id];
    },
    builtInWhat(id) {
      return { work: 'Your projects', experience: 'Your experience', toolkit: 'Your toolkit' }[id];
    },
    sec(id) {
      return this.form?.custom?.find((c) => c.id === id);
    },
    secIndex(id) {
      return this.form.custom.findIndex((c) => c.id === id);
    },
    addSection(kind) {
      if (this.form.custom.length >= 8) return this.flash('Up to 8 of your own sections.');
      const id = 's' + Date.now().toString(36);
      this.form.custom.push({ id, title: '', kind, show: true, text: '', items: kind === 'list' ? [{ title: '', when: '', description: '', link: '' }] : [] });
      this.form.order.push(id);
      this.openSec = id;
      this.$nextTick(() => document.getElementById(`sec-t-${id}`)?.focus());
    },
    removeSection(id) {
      const s = this.sec(id);
      this.confirmBar(`Remove ${s?.title || 'this section'}?`, 'It goes when you save. You can still Cancel before that.', 'Remove', () => {
        this.form.custom.splice(this.secIndex(id), 1);
        this.form.order.splice(this.form.order.indexOf(id), 1);
        if (this.openSec === id) this.openSec = null;
      });
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
      if (this.busy === 'publishing') return { tone: 'busy', text: 'Publishing…', sub: 'Checking your site, then putting it online.' };
      if (this.busy === 'checking') return { tone: 'busy', text: 'Checking your site…', sub: 'Building every page.' };
      if (this.result) return this.result;
      const n = this.changes.items.length;
      if (n) {
        return {
          tone: 'warn',
          text: `${n} change${n === 1 ? '' : 's'} not live yet`,
          sub: this.changes.items.map((i) => i.label).join(', '),
          actions: [
            { label: 'See changes', kind: '', fn: () => this.openPanel() },
            { label: 'Publish', kind: 'pri', fn: () => this.publish('') },
          ],
        };
      }
      if (this.changes.undeployed) {
        return { tone: 'warn', text: "Your last publish isn't live yet", sub: 'It was saved but not uploaded to your site.', actions: [{ label: 'Publish', kind: 'pri', fn: () => this.retrySync() }] };
      }
      if (this.changes.ahead) {
        return { tone: 'warn', text: 'Waiting to back up to GitHub', sub: `${this.changes.ahead} version${this.changes.ahead === 1 ? '' : 's'} not backed up yet.`, actions: [{ label: 'Try again', kind: 'pri', fn: () => this.retrySync() }] };
      }
      // Nothing waiting, but the site isn't online yet: say so, and point the way.
      if (!this.changes.hosted && !this.data.remote) {
        return { tone: 'idle', text: 'Everything is saved', sub: "Your site isn't online yet.", actions: [{ label: 'Go online', kind: '', fn: () => this.go('#hosting') }] };
      }
      return {
        tone: 'ok',
        text: 'Everything is live',
        sub: this.history[0] ? `Last published ${this.fmtDate(this.history[0].date)}` : '',
        actions: this.liveUrl ? [{ label: 'View site ↗', kind: '', href: this.liveUrl }] : [],
      };
    },
    // ---------- publish panel ----------
    async openPanel() {
      if (!(await this.flushSave())) return this.flash('Fix the highlighted field first.');
      this.siteMenu = false;
      this.panel = true;
      this.commitMessage = '';
      await this.refreshChanges();
      // Check the site by itself, unless nothing changed since the last check.
      const sig = JSON.stringify(this.changes.items.map((i) => i.key + (i.summary || '')));
      if (this.changes.items.length && (!this.lastCheck || this.lastCheck.sig !== sig) && !this.busy) this.runCheck(sig);
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
      this.flash('Undone');
    },
    async runCheck(sig = '') {
      this.busy = 'checking';
      try {
        const { check } = await api('POST', '/api/check');
        this.lastCheck = { ...check, sig, at: new Date().toISOString() };
      } catch (e) {
        this.flash(e.message);
      } finally {
        this.busy = null;
      }
    },
    async publish(message) {
      if (!(await this.flushSave())) return this.flash('Fix the highlighted field first.');
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
        const backup = r.backupFailed ? " The GitHub backup didn't upload. It tries again next time." : '';
        this.panel = false;
        this.result = { tone: 'ok', text: `Published at ${this.fmtTime(r.at)}`, sub: `Live on ${domain} ${this.changes.hosted ? 'in a few seconds' : 'in about a minute'}.${backup}`, actions: [{ label: 'View site ↗', kind: '', href: live }, { label: 'OK', kind: 'ghost', fn: () => (this.result = null) }] };
      } else if (r.result === 'local') {
        this.panel = false;
        this.result = { tone: 'warn', text: 'Saved as a version', sub: 'Set up GitHub backup and Hosting to put it online.', actions: [{ label: 'Open Settings', kind: '', fn: () => { this.result = null; this.go('#settings'); } }] };
      } else if (r.result === 'nothing') {
        this.flash('Nothing to publish');
      } else if (r.result === 'check-failed') {
        this.lastCheck = { ...r.check, at: new Date().toISOString() };
        this.panel = true;
        this.result = { tone: 'bad', text: "Couldn't publish: a page didn't build", sub: r.check.message, actions: [{ label: 'Try again', kind: 'pri', fn: () => this.publish('') }] };
      } else if (r.result === 'deploy-failed') {
        const m = {
          network: ["Couldn't reach Cloudflare", "Your changes are kept. Try again when you're back online.", 'Try again'],
          auth: ['Cloudflare needs you to sign in again', 'Reconnect in Hosting, then publish.', 'Open Hosting'],
          build: ["Couldn't publish: the site didn't build", r.message, 'Try again'],
          setup: ["Hosting isn't set up yet", 'Create the site in Hosting first.', 'Open Hosting'],
        }[r.reason] || ["Couldn't upload to Cloudflare", r.message || 'Cloudflare reported an error.', 'Try again'];
        const toHosting = m[2] === 'Open Hosting';
        this.result = { tone: 'bad', text: m[0], sub: m[1], actions: [{ label: m[2], kind: 'pri', fn: () => { this.result = null; if (toHosting) this.go('#hosting'); else this.retrySync(); } }] };
      } else if (r.result === 'push-failed') {
        const m = {
          network: ["Couldn't reach GitHub", "Your changes are kept. Try again when you're back online.", 'Try again'],
          behind: ['GitHub has newer changes from another device', "They'll be combined with yours.", 'Combine and publish'],
          auth: ["GitHub didn't accept the sign-in", 'Check GitHub backup in Settings, then try again.', 'Try again'],
          conflict: ['Your changes clash with newer ones on GitHub', 'Open the folder in a git tool to sort it out, then try again.', 'Try again'],
          unknown: ["Couldn't publish", r.message || 'Git reported an error.', 'Try again'],
        }[r.reason || 'unknown'];
        this.result = { tone: r.reason === 'behind' ? 'warn' : 'bad', text: m[0], sub: m[1], actions: [{ label: m[2], kind: 'pri', fn: () => this.retrySync() }] };
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
    versionName(h) {
      return !h.message || /^(init|first version of the portfolio)$/i.test(h.message) ? 'First version' : h.message;
    },
    revert(h) {
      this.confirmBar(`Restore the version from ${this.fmtDate(h.date)}?`, 'It comes back as changes you can publish. Nothing changes online until then.', 'Restore', async () => {
        try {
          await api('POST', '/api/revert', { hash: h.hash });
          await this.afterDiscard();
          this.flash("Restored. Publish when you're ready.");
        } catch (e) {
          this.flash(e.message);
        }
      });
    },

    // ---------- maintenance ----------
    /** Open the maintenance dialog: 'maint-on', 'maint-off' or 'maint-edit'. */
    openMaint(kind) {
      this.siteMenu = false;
      this.maintForm = clone(this.data.status);
      this.errors = {};
      this.modal = kind;
    },
    async saveMaintMessage() {
      try {
        this.data.status = (await api('PUT', '/api/status', { ...this.maintForm, maintenance: this.data.status.maintenance })).data;
        return true;
      } catch (e) {
        if (e.fields) this.errors = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`status.${k}`, v]));
        else this.flash(e.message);
        return false;
      }
    },
    async confirmMaint() {
      if (this.modal === 'maint-edit') {
        if (await this.saveMaintMessage()) {
          this.modal = null;
          this.refreshChanges();
          this.flash(this.data.status.maintenance ? 'Message saved. Publish to show it.' : 'Message saved');
        }
        return;
      }
      if (this.modal === 'maint-on' && !(await this.saveMaintMessage())) return;
      this.setMaintenance(this.modal === 'maint-on');
    },
    async setMaintenance(on) {
      this.modal = null;
      this.busy = 'publishing';
      try {
        const r = await api('POST', '/api/maintenance', { on });
        this.data.status = r.status;
        if (r.result === 'published') this.result = { tone: on ? 'warn' : 'ok', text: on ? 'Maintenance is on' : 'Your portfolio is back', sub: 'Visitors see the change in about a minute.', actions: [{ label: 'OK', kind: 'ghost', fn: () => (this.result = null) }] };
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
    /** The site's state for the top bar: one word on the chip, details in its menu. */
    get siteStatus() {
      const s = this.sync || {};
      if (this.lost) return { text: 'CMS stopped', tone: 'bad', title: 'The CMS stopped', detail: 'Open it again from the desktop shortcut.' };
      const notes = [];
      if (s.state === 'pulling') notes.push('Getting the latest from GitHub…');
      if (s.state === 'offline') notes.push("You're offline. Edits are kept on this computer.");
      if (s.state === 'error') notes.push("The last GitHub backup didn't upload.");
      if (this.data.status?.maintenance) return { text: 'Maintenance', tone: 'warn', title: 'Maintenance is on', detail: 'Visitors see your short message instead of your portfolio.', notes };
      if (this.changes.hosted && this.hosting?.lastDeployAt) return { text: 'Live', tone: 'ok', title: 'Your site is live', detail: `Last published ${this.fmtDate(this.hosting.lastDeployAt)}`, notes };
      if (this.data.remote && this.data.settings?.siteUrl && !this.changes.hosted) return { text: 'Live', tone: 'ok', title: 'Your site is live', detail: 'Published through GitHub.', notes };
      return { text: 'Not online yet', tone: 'idle', title: 'Not online yet', detail: 'Open Hosting to put your site online. It takes a few minutes and costs nothing.', notes, hosting: true };
    },
    async quit() {
      if (!(await this.flushSave())) {
        this.confirmBar("Some edits can't be saved yet", 'Quit anyway and lose them?', 'Quit', () => this.doQuit(), 'Stay');
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

    // ---------- welcome (first launch) ----------
    welcome: { name: '', role: '', palette: 'paper', git: null, busy: '', error: '' },
    welcomeTimer: null,
    async loadWelcome() {
      const r = await api('GET', '/api/welcome');
      const p = this.data.profile || {};
      // Sample values stay as placeholders, not as text to delete.
      Object.assign(this.welcome, {
        git: r.git,
        name: p.name && p.name !== 'Your Name' ? p.name : '',
        role: p.role && !/^what you do/i.test(p.role) ? p.role : '',
        error: '',
      });
    },
    /** Show the name and look in the preview while typing. */
    welcomeLive() {
      clearTimeout(this.welcomeTimer);
      this.welcomeTimer = setTimeout(async () => {
        try {
          const w = this.welcome;
          if (w.name.trim() && w.role.trim()) this.data.profile = (await api('PUT', '/api/profile', { ...this.data.profile, name: w.name.trim(), role: w.role.trim() })).data;
          const theme = (await api('GET', '/api/theme')).data;
          const look = w.palette === 'dark' ? { palette: 'paper', mode: 'dark' } : { palette: w.palette, mode: 'light' };
          if (theme.palette !== look.palette || theme.mode !== look.mode) await api('PUT', '/api/theme', { ...theme, ...look });
          this.nonce++;
        } catch {}
      }, 500);
    },
    async installGit() {
      this.welcome.busy = 'git';
      this.welcome.error = '';
      try {
        await api('POST', '/api/welcome/install-git');
        await this.loadWelcome();
      } catch (e) {
        this.welcome.error = e.message;
      } finally {
        this.welcome.busy = '';
      }
    },
    async finishWelcome() {
      const w = this.welcome;
      if (!w.name.trim() || !w.role.trim()) return (w.error = 'Add your name and what you do.');
      w.busy = 'finish';
      w.error = '';
      try {
        await api('POST', '/api/welcome', { name: w.name, role: w.role, palette: w.palette });
        this.setupDone = true;
        await this.loadState();
        this.nonce++;
        this.go('#start');
      } catch (e) {
        w.error = e.message;
        if (e.reason === 'git') await this.loadWelcome();
      } finally {
        w.busy = '';
      }
    },

    // ---------- start here ----------
    get startItems() {
      const p = this.data.profile || {};
      const projects = this.data.projects || [];
      const h = this.hosting || {};
      return [
        { key: 'name', title: 'Your name and what you do', note: 'Shown at the top of your site.', done: !!p.name && p.name !== 'Your Name' && !/^what you do/i.test(p.role || ''), label: 'Open Profile', hash: '#profile' },
        { key: 'bio', title: 'Add a photo and a short bio', note: 'Ticks when the sample bio is replaced.', done: !!p.bio && !/^sample bio/i.test(p.bio), label: 'Open Profile', hash: '#profile' },
        { key: 'project', title: 'Replace the sample project', note: 'Edit it or delete it, and add one of yours.', done: projects.length > 0 && !projects.some((x) => x.slug === 'sample-project' && x.title === 'Sample project'), label: 'Open Projects', hash: '#projects' },
        { key: 'online', title: 'Put your site online', note: 'Free with Cloudflare. About five minutes.', done: !!h.project, label: 'Go online', hash: '#hosting' },
        { key: 'publish', title: 'Publish', note: 'Your site goes live with everything above.', done: !!h.lastDeployAt, label: 'Publish', publish: true },
      ];
    },
    get startDone() {
      return this.startItems.filter((i) => i.done).length;
    },
    get startNext() {
      return this.startItems.find((i) => !i.done)?.key;
    },
    get showStart() {
      return this.setupDone && !this.data.startHidden && this.startDone < this.startItems.length;
    },
    async hideStart() {
      await api('POST', '/api/setup/start-hidden', { hidden: true }).catch(() => {});
      this.data.startHidden = true;
      this.go('#profile');
    },

    // ---------- GitHub backup ----------
    gh: null,
    ghForm: { name: 'portfolio', visibility: 'private', url: '', other: false, busy: '', error: '' },
    async loadGithub() {
      try {
        this.gh = await api('GET', '/api/github');
        if (this.gh.remote && this.data.remote !== this.gh.remote) await this.loadState();
      } catch (e) {
        this.ghForm.error = e.message;
      }
    },
    async ghAction(name) {
      const f = this.ghForm;
      f.busy = name;
      f.error = '';
      try {
        if (name === 'install') await api('POST', '/api/github/install');
        if (name === 'login') {
          const r = await api('POST', '/api/github/login');
          if (r.error) f.error = r.error;
        }
        if (name === 'cancel') await api('POST', '/api/github/login/cancel');
        if (name === 'create') await api('POST', '/api/github/create', { name: f.name.trim(), visibility: f.visibility });
        if (name === 'use') await api('POST', '/api/github/use', { url: f.url.trim() });
        await this.loadGithub();
        if (name === 'create' || name === 'use') {
          await this.loadState();
          f.other = false;
          this.flash('Backed up to GitHub');
        }
      } catch (e) {
        f.error = e.message;
      } finally {
        f.busy = '';
      }
    },
    registrar: 'Hostinger',
    get registrarSteps() {
      const d = this.hosting?.domain || 'your domain';
      return {
        Hostinger: [`Open Domains, then pick ${d}.`, 'Go to DNS / Nameservers, then Change nameservers.', 'Choose custom nameservers, paste the two above, and save.'],
        Porkbun: [`Open Domain Management and find ${d}.`, 'Click Details, then Authoritative Nameservers.', 'Replace what is there with the two above, and save.'],
        Namecheap: [`Open Domain List, then Manage next to ${d}.`, 'Under Nameservers, choose Custom DNS.', 'Paste the two above, then click the green tick.'],
        'Somewhere else': ["Sign in where you bought the domain and open its settings.", 'Look for Nameservers (sometimes under DNS).', 'Replace them with the two above, and save.'],
      }[this.registrar];
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
    hostOf(u) {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return u;
      }
    },
    // Character counters only appear near the limit.
    count(s, max) {
      const n = (s || '').length;
      return { text: n >= max * 0.8 ? `${n} / ${max}` : '', over: n > max };
    },
  }));
});
