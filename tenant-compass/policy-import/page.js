// MAIN world, every frame of the Intune portal. Off by⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ default: this is the only feature that writes to the tenant.
// All frames: observe the bearer token the portal⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ sends to graph.microsoft.com (memory only) and answer the top frame's relay.
// Top frame:⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ floating button, file picker, preview, typed confirmation, creation of the checked policies.
// Writes: one POST per policy to a closed list of collections (lib.js). Nothing is updated, deleted or assigned.
(() => {
  const L = globalThis.PolicyImportLib;
  if (!L) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);
  const UI_ORIGINS = ['https://intune.microsoft.com', 'https://endpoint.microsoft.com'];
  const FRAME_ORIGIN = /^https:\/\/((intune|endpoint)\.microsoft\.com|([\w-]+\.)*portal\.azure\.net)$/;
  const isTop = window === window.top;
  // Token⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ per importable type: never persisted, never logged, never posted to another frame.
  const tokens = new Map();

  // ---------- token observation ----------

  const keep = t => { for (const k of L.tokenInfo(t).kinds) tokens.set(k, t); };
  function grab(url, auth) {
    try {
      if (!auth || !/^Bearer\s+\S/i.test(auth) || new URL(url, location.href).origin !== 'https://graph.microsoft.com') return;
      keep(auth.replace(/^Bearer\s+/i, ''));
    } catch {}
  }

  // The shell hands tokens to its extension Web Worker over MessagePort: read them on the way.
  if (isTop) for (const P of [MessagePort.prototype, Worker.prototype]) {
    const send = P.postMessage;
    P.postMessage = function (data) {
      try { L.jwtsIn(data).forEach(keep); } catch {}
      return send.apply(this, arguments);
    };
  }

  const prevFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const req = input instanceof Request ? input : null;
      grab(req ? req.url : String(input), new Headers(init?.headers || req?.headers).get('authorization'));
    } catch {}
    return prevFetch.apply(this, arguments);
  };

  const xhrUrl = new WeakMap();
  const { open, setRequestHeader } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url) {
    xhrUrl.set(this, String(url));
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name)) grab(xhrUrl.get(this), value);
    return setRequestHeader.apply(this, arguments);
  };

  // Types this frame can write, with their tenant ID: all that ever leaves a frame, never the token.
  function ownKinds() {
    const out = {};
    for (const [k, t] of tokens) {
      const info = L.tokenInfo(t);
      if (info.tid && info.kinds.includes(k)) out[k] = info.tid;
    }
    return out;
  }

  // ---------- Graph calls: window.fetch read at call time, so Change Snapshot logs each creation ----------

  async function readNames(kind) {
    const token = tokens.get(kind), field = L.nameField(kind), names = [];
    if (!token || !field) return { status: 403 };
    try {
      for (let url = L.namesUrl(kind); url;) {
        const r = await window.fetch(url, { method: 'GET', credentials: 'omit', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
        if (!r.ok) return { status: r.status };
        const j = await r.json();
        for (const o of j.value || []) names.push(String(o[field] ?? ''));
        const next = j['@odata.nextLink'];
        if (next && !String(next).startsWith('https://graph.microsoft.com/')) return { status: 0 }; // partial list: duplicates could not be trusted
        url = next || null;
      }
    } catch { return { status: 0 }; }
    return { status: 200, names };
  }

  // The only write of the extension. The URL comes from the type table, and the token must still belong to the confirmed tenant.
  async function createPolicy(kind, body, tid) {
    const url = L.endpointFor(kind), token = tokens.get(kind);
    if (!url || !token) return { status: 403, message: T('policyImport.err.noWriteToken') };
    if (L.tokenInfo(token).tid !== tid) return { status: 403, message: T('policyImport.err.tenantChanged') };
    try {
      const r = await window.fetch(url, { method: 'POST', credentials: 'omit', tenantCompassSilent: true,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      return { status: r.status, id: j?.id, message: j?.error?.message, retryAfter: Number(r.headers.get('retry-after')) || 0 };
    } catch { return { status: 0 }; }
  }

  // ---------- relay: child frames⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ serve the top frame ----------

  if (!isTop) {
    window.addEventListener('message', async e => {
      const m = e.data;
      if (!m || typeof m.policyImport !== 'string' || e.source !== window.top || !UI_ORIGINS.includes(e.origin)) return;
      if (m.policyImport === 'ping') {
        const kinds = ownKinds();
        if (Object.keys(kinds).length) e.source.postMessage({ policyImport: 'pong', kinds }, e.origin);
        return;
      }
      if (!L.endpointFor(m.kind)) return; // the message never carries a URL
      const res = m.policyImport === 'names' ? await readNames(m.kind) : m.policyImport === 'post' ? await createPolicy(m.kind, m.body, m.tid) : null;
      if (res) e.source.postMessage({ policyImport: 'res', id: m.id, res }, e.origin); // res has its own id: the created object's
    });
    return;
  }
  if (!UI_ORIGINS.includes(location.origin)) return;

  const routes = new Map(); // type -> { tid, win, origin }, no win: this frame holds the token
  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || typeof m.policyImport !== 'string' || e.source === window || !FRAME_ORIGIN.test(e.origin)) return;
    if (m.policyImport === 'pong' && m.kinds && typeof m.kinds === 'object') {
      for (const [k, tid] of Object.entries(m.kinds)) if (L.endpointFor(k) && typeof tid === 'string' && !routes.has(k)) routes.set(k, { tid, win: e.source, origin: e.origin });
    }
    if (m.policyImport === 'res' && pending.get(m.id)?.win === e.source) { pending.get(m.id).done(m.res); pending.delete(m.id); }
  });

  function allFrames(w = window, out = []) {
    for (let i = 0; i < w.length; i++) { out.push(w[i]); allFrames(w[i], out); }
    return out;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function discover() {
    for (const [k, tid] of Object.entries(ownKinds())) routes.set(k, { tid });
    for (const f of allFrames()) f.postMessage({ policyImport: 'ping' }, '*');
    await sleep(400);
  }

  // Types of the first tenant found. A token of another tenant in the page is ignored, and refused by createPolicy.
  function tenantNow() {
    const first = routes.values().next().value;
    return first ? { tid: first.tid, kinds: [...routes].filter(([, r]) => r.tid === first.tid).map(([k]) => k) } : null;
  }

  function relay(op, kind, extra = {}) {
    const route = routes.get(kind);
    if (!route) return Promise.resolve({ status: 403, message: T('policyImport.err.noWriteToken') });
    if (!route.win) return op === 'names' ? readNames(kind) : createPolicy(kind, extra.body, extra.tid);
    const id = ++seq;
    return new Promise(resolve => {
      const t = setTimeout(() => { pending.delete(id); resolve({ status: 0 }); }, 60000); // the request may have left: "unknown" for a creation
      pending.set(id, { win: route.win, done: res => { clearTimeout(t); resolve(res || { status: 0 }); } });
      route.win.postMessage({ policyImport: op, id, kind, ...extra }, route.origin);
    });
  }

  // ---------- UI ----------

  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; font: 13px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; left: 120px; bottom: 20px; z-index: 2147483000; background: linear-gradient(135deg, #0078d4, #5b5fc7); color: #fff; border: 0;
           border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,120,212,.35); }
    .panel { position: fixed; left: 20px; bottom: 124px; z-index: 2147483001; width: 500px; max-height: 76vh; display: flex; flex-direction: column;
             background: #fff; color: #1b1a19; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.05); }
    .head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; color: #fff; font-size: 15px; font-weight: 600;
            background: linear-gradient(135deg, #0078d4, #5b5fc7); }
    .bar { display: flex; gap: 8px; padding: 10px 16px 0; align-items: center; color: #484644; font-size: 12px; overflow-wrap: anywhere; }
    .list { overflow: auto; flex: 1; padding: 6px 10px; min-height: 90px; }
    label.row { display: flex; gap: 10px; align-items: flex-start; padding: 7px 8px; border-radius: 10px; cursor: pointer; }
    label.row:hover { background: #f3f2f1; }
    .row small { display: block; color: #605e5c; font-size: 11.5px; }
    .row small.block, .row small.failed, .fileerr { color: #a4262c; }
    .row small.created { color: #107c10; }
    .row small.unknown { color: #8a5300; font-weight: 600; }
    .fileerr { padding: 4px 8px; font-size: 12px; }
    .chip { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; background: #eff6fc; color: #005a9e; font-size: 11px; }
    .chip.warn { background: #fff4ce; color: #8a5300; }
    input[type=checkbox] { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: #0078d4; cursor: pointer; }
    .foot { padding: 12px 16px 14px; border-top: 1px solid #f3f2f1; display: flex; flex-direction: column; gap: 10px; }
    button.act { flex: 1; background: #0078d4; color: #fff; border: 0; border-radius: 10px; padding: 8px 10px; font-weight: 600; cursor: pointer; }
    button.act:hover:not(:disabled) { background: #106ebe; }
    button.act.ghost { background: #eff6fc; color: #005a9e; }
    button.act:disabled { background: #e1dfdd; color: #a19f9d; cursor: default; }
    button.x { background: rgba(255,255,255,.15); color: #fff; border: 0; width: 28px; height: 28px; border-radius: 50%; font-size: 16px; cursor: pointer; }
    .progress { height: 8px; border-radius: 999px; background: #edebe9; overflow: hidden; display: none; }
    .progress.on { display: block; }
    .progress i { display: block; height: 100%; width: 0; border-radius: inherit; background: #0078d4; transition: width .2s ease; }
    .status { color: #605e5c; min-height: 18px; font-size: 12px; }
    .dialog { position: fixed; inset: 0; z-index: 2147483002; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.4); }
    .card { width: 460px; max-width: calc(100vw - 40px); background: #fff; color: #1b1a19; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 10px;
            box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .card h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .card p { margin: 0; overflow-wrap: anywhere; }
    .card input { padding: 7px 10px; border: 1px solid #8a8886; border-radius: 10px; }
    .card .btns { display: flex; gap: 8px; }
  `);

  const TYPE_KEYS = { sc: 'policyImport.type.sc', dc: 'policyImport.type.dc', comp: 'policyImport.type.comp', ps: 'policyImport.type.ps',
    sh: 'policyImport.type.sh', cattr: 'policyImport.type.cattr', rem: 'policyImport.type.rem' };
  let panel = null, poll = 0, running = false, entries = [], fileErrors = [], lastStatus = '';
  const ui = {};

  const directoryName = () => document.querySelector('.fxs-avatarmenu-tenant')?.textContent.trim() || '';
  const selected = () => entries.filter(e => e.checked && e.body);
  function setStatus(text) { lastStatus = text; if (panel) ui.status.textContent = text; }

  function renderTenant() {
    if (!panel) return;
    const tenant = tenantNow();
    ui.tenant.textContent = tenant ? [directoryName(), tenant.tid].filter(Boolean).join(' · ') : T('policyImport.err.noWriteToken');
    ui.pick.disabled = running || !tenant;
  }

  function rowOf(e) {
    const box = el('input', { type: 'checkbox', checked: e.checked, disabled: !e.body || e.locked || running, onchange: () => { e.checked = box.checked; renderRows(); } });
    const notes = [
      ...e.blockers.map(k => el('small', { className: 'block', textContent: T(k) })),
      ...(e.warnings.length ? [el('small', { textContent: e.warnings.map(k => T(k)).join(' · ') })] : []),
    ];
    if (e.result) {
      const r = e.result;
      const text = r.status === 'created' ? T('policyImport.res.created', { id: r.id || '' }) : r.status === 'unknown' ? T('policyImport.res.unknown') : r.status === 'skipped' ? T('policyImport.res.skipped') : T(r.error || '');
      notes.push(el('small', { className: r.status, textContent: text }));
    }
    return el('label', { className: 'row' }, box, el('span', {},
      e.name || e.file,
      el('span', { className: 'chip', textContent: e.kind ? T(TYPE_KEYS[e.kind]) : e.type }),
      ...(e.hasScript ? [el('span', { className: 'chip warn', textContent: T('policyImport.chip.script') })] : []),
      ...(e.duplicate ? [el('span', { className: 'chip warn', textContent: T('policyImport.chip.exists') })] : []),
      ...notes));
  }

  function renderRows() {
    if (!panel) return;
    ui.list.replaceChildren(...fileErrors.map(([file, key]) => el('div', { className: 'fileerr', textContent: `${file} : ${T(key)}` })), ...entries.map(rowOf));
    const n = selected().length, usable = entries.filter(e => e.body && !e.locked);
    ui.go.textContent = T('policyImport.ui.go', { n });
    ui.go.disabled = running || !n;
    ui.all.disabled = running || !usable.length;
    ui.all.checked = !!usable.length && usable.every(e => e.checked);
  }

  // Fresh preview for the chosen files. Reads the existing names of each type present; nothing is written here.
  async function onFiles(files) {
    if (running || !files.length) return;
    setStatus(T('policyImport.status.reading'));
    await discover();
    const tenant = tenantNow();
    if (!tenant) { setStatus(''); renderTenant(); return; }
    const prepared = [], errors = [];
    for (const f of files) {
      if (f.size > L.MAX_FILE_BYTES) { errors.push([f.name, 'policyImport.err.tooBig']); continue; }
      const parsed = L.parseFile(f.name, await f.text().catch(() => ''));
      if (parsed.error) errors.push([f.name, parsed.error]);
      for (const raw of parsed.raw) prepared.push(L.prepare(raw, { sourceTenantId: parsed.tenantId, tenantId: tenant.tid }));
    }
    const namesByKind = {};
    for (const kind of new Set(prepared.filter(e => e.body && tenant.kinds.includes(e.kind)).map(e => e.kind))) {
      const r = await relay('names', kind);
      if (Array.isArray(r.names)) namesByKind[kind] = r.names;
    }
    entries = L.markDuplicates(prepared, namesByKind, tenant.kinds).map(e => ({ ...e, checked: !!e.body && !e.duplicate, locked: false, result: null }));
    fileErrors = errors;
    const ready = entries.filter(e => e.body && !e.duplicate).length, dup = entries.filter(e => e.duplicate).length;
    setStatus(T('policyImport.status.ready', { ready, dup, blocked: entries.filter(e => !e.body).length }));
    renderRows();
  }

  function askConfirm() {
    const todo = selected(), tenant = tenantNow();
    if (!todo.length || !tenant) return;
    const directory = directoryName(), word = L.confirmWord(directory, tenant.tid), scripts = todo.filter(e => e.hasScript).length;
    const close = () => dialog.remove();
    const typed = el('input', { type: 'text', spellcheck: false, autocomplete: 'off', oninput: () => { ok.disabled = !L.confirmMatches(word, typed.value); } });
    const cancel = el('button', { className: 'act ghost', textContent: T('policyImport.confirm.cancel'), onclick: close });
    const ok = el('button', { className: 'act', textContent: T('policyImport.ui.go', { n: todo.length }), disabled: true, onclick: () => { close(); run(todo, tenant.tid); } });
    const dialog = el('div', { className: 'dialog', onkeydown: e => { if (e.key === 'Escape') close(); } }, el('div', { className: 'card', role: 'dialog', ariaModal: 'true' },
      el('h2', { textContent: T('policyImport.confirm.title', { n: todo.length }) }),
      el('p', { textContent: T('policyImport.confirm.tenant', { directory: directory || '?', tid: tenant.tid }) }),
      el('p', { textContent: T('policyImport.confirm.noAssign') }),
      ...(scripts ? [el('p', { textContent: T('policyImport.confirm.scripts', { n: scripts }) })] : []),
      el('p', { textContent: T('policyImport.confirm.type', { word }) }),
      typed,
      el('div', { className: 'btns' }, cancel, ok)));
    ui.root.append(dialog);
    cancel.focus(); // safe default: Enter cancels
  }

  async function run(todo, tid) {
    running = true;
    renderTenant();
    renderRows();
    if (panel) { ui.progress.classList.add('on'); ui.fill.style.width = '0'; }
    setStatus(T('policyImport.status.running', { done: 0, total: todo.length }));
    const results = await L.runImport(todo, e => relay('post', e.kind, { body: e.body, tid }), {
      pause: sleep,
      onProgress: (i, res) => {
        todo[i].result = res;
        // Created, or may exist: not offered again. A failed line stays checked for another try.
        if (res.status === 'created' || res.status === 'unknown') { todo[i].checked = false; todo[i].locked = true; }
        setStatus(T('policyImport.status.running', { done: i + 1, total: todo.length }));
        if (panel) ui.fill.style.width = `${Math.round(100 * (i + 1) / todo.length)}%`;
        renderRows();
      },
    });
    running = false;
    const n = s => results.filter(r => r.status === s).length;
    setStatus(T('policyImport.status.done', { created: n('created'), failed: n('failed'), unknown: n('unknown'), skipped: n('skipped') }));
    renderTenant();
    renderRows();
  }

  // One panel at a time,⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ see shared/drag.js. A running import goes on when the panel closes.
  const opened = window.__tenantCompassExclusive ? window.__tenantCompassExclusive('policy-import', () => { if (panel) toggle(); }) : () => {};

  function toggle() {
    if (panel) { panel.remove(); panel = null; clearInterval(poll); return; }
    ui.tenant = el('div', { textContent: T('policyImport.status.searching') });
    ui.pick = el('input', { type: 'file', multiple: true, accept: '.json,application/json', title: T('policyImport.ui.pick'), disabled: true,
      onchange: () => { const files = [...ui.pick.files]; ui.pick.value = ''; onFiles(files); } });
    ui.all = el('input', { type: 'checkbox', title: T('policyImport.ui.selectAll'), onchange: () => {
      for (const e of entries) if (e.body && !e.locked) e.checked = ui.all.checked;
      renderRows();
    } });
    ui.list = el('div', { className: 'list' });
    ui.fill = el('i');
    ui.progress = el('div', { className: 'progress' }, ui.fill);
    ui.status = el('div', { className: 'status', textContent: lastStatus });
    ui.go = el('button', { className: 'act', onclick: askConfirm });
    const head = el('div', { className: 'head', title: T('policyImport.ui.drag') }, T('policyImport.ui.title'), el('button', { className: 'x', textContent: '×', title: T('policyImport.ui.close'), onclick: toggle }));
    panel = el('div', { className: 'panel' }, head, el('div', { className: 'bar' }, ui.tenant), el('div', { className: 'bar' }, ui.all, ui.pick),
      ui.list, el('div', { className: 'foot' }, ui.progress, ui.status, ui.go));
    ui.root.append(panel);
    opened();
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(panel, head, 'policy-import-panel');
    renderRows();
    if (!running) routes.clear();
    const look = () => discover().then(renderTenant);
    look();
    poll = setInterval(() => { if (!tenantNow()) look(); }, 2000); // the token shows up with the portal's next Graph call
  }

  function mount() {
    if (!document.body || document.getElementById('policy-import')) return;
    const host = el('div', { id: 'policy-import' });
    ui.root = host.attachShadow({ mode: 'closed' });
    ui.root.adoptedStyleSheets = [sheet];
    const fab = el('button', { className: 'fab', textContent: T('policyImport.ui.fab'), title: T('policyImport.ui.fabTitle'), onclick: toggle });
    ui.root.append(fab);
    document.body.append(host);
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(fab, fab, 'policy-import-fab');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
