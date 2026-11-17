// MAIN world, every frame of the Intune portal. Reads only: what targets a group, a user or a managed device,
// and which policies and apps have no assignment. GET requests built by assignment-search/lib.js, nothing is written.
// All frames: the Graph bridge observes the portal's token⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ and serves the top frame (operation names, never a URL).
// Top frame: floating button, panel with object type, search⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ and pick list, results, JSON export.
(() => {
  const L = globalThis.AssignmentSearchLib, S = globalThis.AsBuiltLib, bridge = window.__tenantCompassGraphBridge;
  if (!L || !S || !bridge) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);
  const t = (k, v) => T('assignmentSearch.' + k, v);

  // A Graph token that reads Intune objects (As-Built's rule). Groups, users and devices are read with the same token.
  const info = token => ({ tid: S.jwtTid(token), kinds: S.tokenKinds(token).includes('intune') ? ['read'] : [] });
  const graph = bridge({ channel: 'assignmentSearch', info, jwtsIn: S.jwtsIn, ops: {
    list: (token, kind, { source } = {}) => bridge.readAll(L.listUrl(source), token),
    filters: token => bridge.readAll(L.FILTERS_URL, token),
    search: (token, kind, { type, q } = {}) => bridge.read(L.searchUrl(type, q), token),
    memberOf: (token, kind, { type, subject } = {}) => bridge.readAll(L.memberOfUrl(type, subject), token),
  } });
  if (!graph) return;

  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const option = (value, textContent) => el('option', { value, textContent });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ok = r => r.status >= 200 && r.status < 300;
  const errorText = r => (r.status === 401 ? t('status.expired') : r.message || (r.status ? `Graph ${r.status}` : 'network'));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fr');

  // Only 429 is retried, after the delay Graph asks for (10 s when it gives none).
  async function call(op, args) {
    for (let tries = 0; ; tries++) {
      const r = await graph.call(op, 'read', args);
      if (r.status !== 429 || tries === 2) return r;
      await sleep(1000 * (r.retryAfter > 0 ? r.retryAfter : 10));
    }
  }

  // ---------- policies and apps of the tenant, with their assignments (read once, ↻ reads again) ----------

  const AS_BUILT = new Set(['sc', 'dc', 'comp', 'admx', 'app', 'ps', 'sh', 'cattr', 'rem', 'ap', 'enr']); // types As-Built labels
  const PLATFORM = { mamIos: 'iOS/iPadOS', mamAndroid: 'Android', mamWin: 'Windows', wufu: 'Windows', wuq: 'Windows', wud: 'Windows' };
  const label = kind => (AS_BUILT.has(kind) ? T('asBuilt.src.' + kind) : t('src.' + kind));
  function summary(kind, raw) {
    if (AS_BUILT.has(kind)) { const s = S.policySummary(kind, raw); return { name: s.name, type: s.type, platform: s.platform }; }
    const odata = String(raw['@odata.type'] || '');
    return { name: raw.displayName || raw.name || raw.id, type: label(kind),
      platform: PLATFORM[kind] || (/ios/i.test(odata) ? 'iOS/iPadOS' : /android/i.test(odata) ? 'Android' : '') };
  }

  let loading = null, loadedTid = '', failed = [], filters = new Map();
  // ponytail: 4 lists at a time, each followed to its last page; enough for the tenants seen so far.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  function load() {
    return loading ??= (async () => {
      loadedTid = graph.tenantNow()?.tid || '';
      failed = [];
      let done = 0;
      const kinds = L.KINDS, out = [];
      setStatus(t('status.loading', { done, total: kinds.length }));
      const queue = [...kinds];
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let kind; (kind = queue.shift());) {
          const r = await call('list', { source: kind });
          if (ok(r)) for (const raw of r.body?.value || []) out.push({ key: kind + ':' + raw.id, kind, id: raw.id, ...summary(kind, raw), assignments: L.assignmentsOf(raw) });
          else failed.push(kind);
          setStatus(t('status.loading', { done: ++done, total: kinds.length }));
        }
      }));
      const f = await call('filters', {});
      if (ok(f)) filters = new Map((f.body?.value || []).map(x => [x.id, x.displayName]));
      return out.sort(byName);
    })();
  }

  const coverageText = unread => [failed.length && t('status.failed', { list: failed.map(label).join(', ') }), unread && t('status.unread', { n: unread })].filter(Boolean).join(' ');

  // ---------- panel (top frame) ----------

  let panel = null, poll = 0, timer = 0, findSeq = 0, viewSeq = 0, picks = new Map(), view = null;
  const ui = {};
  const setStatus = text => { if (panel) ui.status.textContent = text; };
  const directoryName = () => document.querySelector('.fxs-avatarmenu-tenant')?.textContent.trim() || '';

  // Pick list: the first objects by name, then those matching the text typed. One result for a typed text: analysed at once.
  async function find() {
    const type = ui.type.value, q = ui.search.value, mine = ++findSeq;
    if (!L.TYPES.includes(type)) return;
    picks = new Map();
    ui.pick.replaceChildren(option('', t('ui.searching')));
    const r = await call('search', { type, q });
    if (mine !== findSeq || !panel) return;
    const list = ok(r) ? L.found(type, r.body) : [];
    picks = new Map(list.map(o => [o.id, o]));
    const head = !ok(r) ? t('ui.searchFailed', { error: errorText(r) }) : !list.length ? t('ui.pickNone') : t(list.length >= L.LIMIT ? 'ui.pickMore' : 'ui.pick', { n: list.length });
    ui.pick.replaceChildren(option('', head), ...list.map(o => option(o.id, o.detail ? `${o.name} — ${o.detail}` : o.name)));
    if (list.length === 1 && q.trim()) { ui.pick.value = list[0].id; analyse(); }
  }

  async function analyse() {
    const type = ui.type.value, subject = picks.get(ui.pick.value), mine = ++viewSeq;
    view = null;
    renderResults();
    if (!subject) return;
    setStatus(t('status.members', { name: subject.name }));
    const noEntra = type === 'device' && !subject.entraId;
    const [items, m] = await Promise.all([load(), noEntra ? null : call('memberOf', { type, subject: { id: subject.id, entraId: subject.entraId } })]);
    if (mine !== viewSeq || !panel) return;
    const read = !!m && ok(m);
    const warn = noEntra ? t('warn.noEntra') : read ? ''
      : t(type === 'group' ? 'warn.parents' : 'warn.members', { error: errorText(m), all: t(type === 'user' ? 'how.allUsers' : 'how.allDevices') });
    const memberships = read ? (m.body?.value || []) : [];
    const { rows, unread } = L.resolve(type, subject, memberships, items);
    view = { type, subject, memberships, rows, unread, warn };
    setStatus([read && t(type === 'group' ? 'status.parents' : 'status.groups', { n: memberships.length }), coverageText(unread)].filter(Boolean).join(' '));
    renderResults();
  }

  async function showUnassigned() {
    const mine = ++viewSeq;
    view = null;
    renderResults();
    const items = await load();
    if (mine !== viewSeq || !panel) return;
    const unread = items.filter(i => !i.assignments).length;
    view = { type: 'unassigned', rows: L.unassigned(items), unread };
    setStatus([t('status.loaded', { n: items.length }), coverageText(unread)].filter(Boolean).join(' '));
    renderResults();
  }

  // User, device or group open in the portal: picked and analysed at once (its ID goes through the usual search).
  // Checked when the panel opens, then every second: the shell changes blades with pushState, which fires no event.
  let pageKey = '';
  function syncPage() {
    const ref = L.pageRef(location.hash), key = ref ? ref.type + ':' + ref.id : '';
    if (key === pageKey) return false;
    pageKey = key;
    if (!ref) return false;
    ui.type.value = ref.type;
    ui.search.value = ref.id;
    typeChanged();
    return true;
  }

  function typeChanged() {
    const type = ui.type.value, searchable = L.TYPES.includes(type);
    ui.searchRow.hidden = ui.pickRow.hidden = !searchable;
    ui.search.placeholder = ui.search.title = ui.search.ariaLabel = searchable ? t('ui.search.' + type) : '';
    if (searchable) { view = null; ++viewSeq; renderResults(); find(); } else showUnassigned();
  }

  // Names of the groups that matched: the object itself (direct) or one of its groups.
  const groupName = id => {
    const low = String(id).toLowerCase();
    if (String(view?.subject?.id).toLowerCase() === low) return view.subject.name;
    return view?.memberships?.find(g => String(g.id).toLowerCase() === low)?.displayName || id;
  };
  const INTENTS = new Set(['required', 'available', 'uninstall', 'availableWithoutEnrollment']);
  function viaText(v) {
    const how = v.how === 'group' || v.how === 'parent' ? t('how.' + v.how, { group: groupName(v.ref) }) : t('how.' + v.how);
    return [t(v.mode === 'exclude' ? 'via.exclude' : 'via.include', { how }),
      v.intent && (INTENTS.has(v.intent) ? t('intent.' + v.intent) : v.intent),
      v.filterId && t('filter', { name: filters.get(v.filterId) || v.filterId, mode: t(v.filterMode === 'exclude' ? 'filter.exclude' : 'filter.include') }),
    ].filter(Boolean).join(' · ');
  }

  // Text only goes through textContent: no HTML parsing of Graph data.
  function renderResults() {
    if (!panel) return;
    ui.export.disabled = !view?.rows.length;
    if (!view) return ui.results.replaceChildren();
    const row = r => el('div', { className: 'row' }, el('div', { textContent: r.name }),
      el('small', { textContent: [r.type, r.platform].filter(Boolean).join(' · ') }),
      ...(r.via || []).map(v => el('small', { className: v.mode === 'exclude' ? 'ex' : 'in', textContent: viaText(v) })));
    const section = (title, list) => [el('h3', { textContent: title }), ...(list.length ? list.map(row) : [el('p', { className: 'm', textContent: t('res.empty') })])];
    if (view.type === 'unassigned') {
      return ui.results.replaceChildren(el('p', { className: 'm', textContent: t('res.unassignedHint') }), ...section(t('res.unassigned', { n: view.rows.length }), view.rows));
    }
    const inc = view.rows.filter(r => r.state === 'included'), exc = view.rows.filter(r => r.state === 'excluded');
    ui.results.replaceChildren(...(view.warn ? [el('p', { className: 'warn', textContent: view.warn })] : []),
      ...section(t('res.included', { n: inc.length }), inc), ...section(t('res.excluded', { n: exc.length }), exc));
  }

  function exportJson() {
    if (!view?.rows.length) return;
    const now = new Date().toISOString();
    const doc = L.exportDoc({ type: view.type, subject: view.subject, memberships: view.memberships, rows: view.rows, tenantId: loadedTid, exportedAt: now,
      coverage: { failedTypes: failed.map(label), unreadObjects: view.unread, ...(view.warn ? { warning: view.warn } : {}) } },
    { group: groupName, filter: id => filters.get(id) || '' });
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })), download: L.exportName(view.type, view.subject?.name, now.slice(0, 10)) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function refresh() {
    loading = null;
    if (ui.type.value === 'unassigned') showUnassigned();
    else if (picks.has(ui.pick.value)) analyse();
    else load().then(items => { if (!view) setStatus([t('status.loaded', { n: items.length }), coverageText(items.filter(i => !i.assignments).length)].join(' ')); });
  }

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; font: 13px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; left: 20px; bottom: 124px; z-index: 2147483000; background: linear-gradient(135deg, #0078d4, #5b5fc7); color: #fff; border: 0;
           border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,120,212,.35); }
    .panel { position: fixed; left: 240px; bottom: 20px; z-index: 2147483001; width: 520px; max-height: 84vh; display: flex; flex-direction: column;
             background: #fff; color: #1b1a19; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.05); }
    .head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; color: #fff; font-size: 15px; font-weight: 600;
            background: linear-gradient(135deg, #0078d4, #5b5fc7); }
    .tools { display: flex; gap: 6px; }
    button.x { background: rgba(255,255,255,.15); color: #fff; border: 0; width: 28px; height: 28px; border-radius: 50%; font-size: 16px; cursor: pointer; }
    button.x:hover { background: rgba(255,255,255,.3); }
    .bar { display: flex; gap: 8px; padding: 10px 16px 0; align-items: center; color: #484644; font-size: 12px; overflow-wrap: anywhere; }
    .bar[hidden] { display: none; }
    .bar input, .bar select { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #e1dfdd; border-radius: 10px; background: #faf9f8; color: #323130; outline: none; }
    .bar input:focus, .bar select:focus { border-color: #0078d4; box-shadow: 0 0 0 3px rgba(0,120,212,.15); background: #fff; }
    .list { overflow: auto; flex: 1; padding: 0 16px 6px; min-height: 120px; }
    h3 { margin: 12px 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #005a9e; font-weight: 600; }
    .row { margin: 2px 0; padding: 6px 8px; border-radius: 10px; background: #f3f2f1; }
    .row small { display: block; color: #605e5c; font-size: 11.5px; }
    .row small.in { color: #107c10; }
    .row small.ex { color: #a4262c; }
    .m { color: #605e5c; font-size: 12px; margin: 6px 0; }
    .warn { color: #8a5300; font-weight: 600; font-size: 12px; margin: 10px 0 0; }
    .foot { padding: 12px 16px 14px; border-top: 1px solid #f3f2f1; display: flex; flex-direction: column; gap: 10px; }
    .status { color: #605e5c; min-height: 18px; font-size: 12px; }
    button.act { background: #0078d4; color: #fff; border: 0; border-radius: 10px; padding: 8px 10px; font-weight: 600; cursor: pointer; }
    button.act:hover:not(:disabled) { background: #106ebe; }
    button.act:disabled { background: #e1dfdd; color: #a19f9d; cursor: default; }
  `);

  // One panel at a time, see shared/drag.js. A reopened panel starts again; the lists read stay cached.
  const opened = window.__tenantCompassExclusive ? window.__tenantCompassExclusive('assignment-search', () => { if (panel) toggle(); }) : () => {};

  function toggle() {
    if (panel) { panel.remove(); panel = null; clearInterval(poll); view = null; ++viewSeq; ++findSeq; return; }
    ui.tenant = el('div', { textContent: t('status.searching') });
    ui.type = el('select', { title: t('ui.type'), ariaLabel: t('ui.type'), onchange: typeChanged },
      ...[...L.TYPES, 'unassigned'].map(k => option(k, t('type.' + k))));
    ui.search = el('input', { type: 'search', oninput: () => { clearTimeout(timer); timer = setTimeout(find, 300); },
      onkeydown: e => { if (e.key === 'Enter') { clearTimeout(timer); find(); } } });
    ui.pick = el('select', { title: t('ui.pickTitle'), ariaLabel: t('ui.pickTitle'), onchange: analyse });
    ui.searchRow = el('div', { className: 'bar' }, ui.search);
    ui.pickRow = el('div', { className: 'bar' }, ui.pick);
    ui.results = el('div', { className: 'list' });
    ui.status = el('div', { className: 'status', role: 'status' });
    ui.export = el('button', { className: 'act', textContent: t('ui.export'), title: t('ui.exportTitle'), disabled: true, onclick: exportJson });
    const head = el('div', { className: 'head', title: t('ui.drag') }, t('ui.title'), el('span', { className: 'tools' },
      ...(window.__tenantCompassPin ? [window.__tenantCompassPin('assignment-search')] : []),
      el('button', { className: 'x', textContent: '↻', title: t('ui.refresh'), ariaLabel: t('ui.refresh'), onclick: refresh }),
      el('button', { className: 'x', textContent: '×', title: t('ui.close'), ariaLabel: t('ui.close'), onclick: toggle })));
    panel = el('div', { className: 'panel' }, head, el('div', { className: 'bar' }, ui.tenant), el('div', { className: 'bar' }, ui.type),
      ui.searchRow, ui.pickRow, ui.results, el('div', { className: 'foot' }, ui.status, ui.export));
    ui.root.append(panel);
    opened();
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(panel, head, 'assignment-search-panel');
    ui.searchRow.hidden = ui.pickRow.hidden = true;
    graph.reset();
    const look = async () => {
      await graph.discover();
      const tenant = graph.tenantNow();
      if (!panel) return;
      ui.tenant.textContent = tenant ? [directoryName(), tenant.tid].filter(Boolean).join(' · ') : t('status.noToken');
      if (!tenant) return;
      clearInterval(poll);
      if (tenant.tid !== loadedTid) loading = null; // another tenant in this tab: its lists are read again
      pageKey = '';
      if (!syncPage()) typeChanged();
      poll = setInterval(syncPage, 1000);
    };
    look();
    poll = setInterval(look, 2000); // the token shows up with the portal's next Graph call
  }

  function mount() {
    if (!document.body || document.getElementById('assignment-search')) return;
    const host = el('div', { id: 'assignment-search' });
    ui.root = host.attachShadow({ mode: 'closed' });
    ui.root.adoptedStyleSheets = [sheet];
    const fab = el('button', { className: 'fab', textContent: t('ui.fab'), title: t('ui.fabTitle'), onclick: toggle });
    ui.root.append(fab);
    document.body.append(host);
    window.__tenantCompassLayer?.('assignment-search', host);
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(fab, fab, 'assignment-search-fab');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
