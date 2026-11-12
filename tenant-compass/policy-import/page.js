// MAIN world, every frame of the Intune portal. Off by default: it writes to the tenant.
// All frames: the Graph bridge observes the portal's token and serves the top frame.
// Top frame: floating button, file picker, preview, confirmation, creation of the checked policies.
// Writes: one POST per policy to a closed list of collections (lib.js), then one assignment when the user chose a group. Nothing⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ is updated or deleted.
(() => {
  const L = globalThis.PolicyImportLib, A = globalThis.TenantCompassAssign, bridge = window.__tenantCompassGraphBridge;
  if (!L || !A || !bridge) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);
  const ok2xx = r => r.status >= 200 && r.status < 300;

  // ---------- Graph calls: window.fetch read at call time, so Change Snapshot logs each creation ----------

  async function readNames(token, kind) {
    const field = L.nameField(kind), names = [];
    if (!field) return { status: 403 };
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

  // The URL comes from the⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ type table. The bridge has already checked that the token belongs to the confirmed tenant.
  async function createPolicy(token, kind, { body }) {
    const url = L.endpointFor(kind);
    if (!url) return { status: 403, message: T('assignForm.noToken') };
    try {
      const r = await window.fetch(url, { method: 'POST', credentials: 'omit', tenantCompassSilent: true,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      return { status: r.status, id: j?.id, message: j?.error?.message, retryAfter: Number(r.headers.get('retry-after')) || 0 };
    } catch { return { status: 0 }; }
  }

  const info = t => { const i = L.tokenInfo(t); return i.kinds.length ? { tid: i.tid, kinds: [...i.kinds, 'meta'] } : i; };
  const graph = bridge({ channel: 'policyImport', info, jwtsIn: L.jwtsIn, ops: { ...bridge.assignOps(A), names: readNames, post: createPolicy } });
  if (!graph) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    .tools { display: flex; gap: 6px; }
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
    .bar input[type=text] { flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid #e1dfdd; border-radius: 10px; background: #faf9f8; color: #323130; outline: none; }
    .bar input[type=text]:focus { border-color: #0078d4; box-shadow: 0 0 0 3px rgba(0,120,212,.15); background: #fff; }
    .bar input[type=text]:disabled { color: #a19f9d; }
    .card .btns { display: flex; gap: 8px; }
    .options summary { padding: 10px 16px 0; color: #005a9e; font-size: 12px; font-weight: 600; cursor: pointer; }
    fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
    .opt { display: flex; gap: 8px; align-items: center; padding: 8px 16px 0; color: #484644; font-size: 12px; cursor: pointer; }
    .opt[hidden] { display: none; }
    ${window.__tenantCompassAssignForm.css}
  `);

  const TYPE_KEYS = { sc: 'policyImport.type.sc', dc: 'policyImport.type.dc', comp: 'policyImport.type.comp', ps: 'policyImport.type.ps',
    sh: 'policyImport.type.sh', cattr: 'policyImport.type.cattr', rem: 'policyImport.type.rem' };
  let panel = null, poll = 0, running = false, entries = [], fileErrors = [], lastStatus = '';
  let prepared = [], namesByKind = {}, writable = [], prefix = ''; // what the preview is rebuilt from when an option changes
  let form = null, formLoaded = false;
  const ui = {};

  const directoryName = () => document.querySelector('.fxs-avatarmenu-tenant')?.textContent.trim() || '';
  const selected = () => entries.filter(e => e.checked && e.body);
  function setStatus(text) { lastStatus = text; if (panel) ui.status.textContent = text; }

  function renderTenant() {
    if (!panel) return;
    const tenant = graph.tenantNow();
    ui.tenant.textContent = tenant ? [directoryName(), tenant.tid].filter(Boolean).join(' · ') : T('assignForm.noToken');
    ui.pick.disabled = running || !tenant;
  }

  const assignText = a => (a.status === 'done' ? T('policyImport.res.assigned') : a.status === 'script' ? T('policyImport.res.scriptNotAssigned')
    : a.status === 'remediation' ? T('policyImport.res.remNotAssigned') : T('policyImport.res.notAssigned', { error: a.error }));

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
      if (r.assign) notes.push(el('small', { className: r.assign.status === 'done' ? 'created' : r.assign.status === 'failed' ? 'failed' : 'unknown', textContent: assignText(r.assign) }));
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
    ui.go.disabled = running || !n || !form.value().complete;
    ui.all.disabled = running || !usable.length;
    ui.all.checked = !!usable.length && usable.every(e => e.checked);
    // The rows already sent keep their name and options: frozen until the next files.
    ui.prefix.disabled = ui.options.disabled = running || entries.some(e => e.result);
  }

  // Preview for the current options. A row keeps the user's choice as long as its duplicate state does not change.
  function rebuild() {
    const old = entries;
    entries = L.markDuplicates(prepared.map(e => L.applyTags(L.applyPrefix(e, prefix), form.value().tagIds)), namesByKind, writable).map((e, i) => ({ ...e, locked: false, result: null,
      checked: old[i] && old[i].duplicate === e.duplicate ? old[i].checked : !!e.body && !e.duplicate }));
    const ready = entries.filter(e => e.body && !e.duplicate).length, dup = entries.filter(e => e.duplicate).length;
    setStatus(T('policyImport.status.ready', { ready, dup, blocked: entries.filter(e => !e.body).length }));
    renderRows();
  }

  // Fresh preview for the chosen files. Reads the existing names of each type present; nothing is written here.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  async function onFiles(files) {
    if (running || !files.length) return;
    setStatus(T('policyImport.status.reading'));
    await graph.discover();
    const tenant = graph.tenantNow();
    if (!tenant) { setStatus(''); renderTenant(); return; }
    const read = [], errors = [];
    for (const f of files) {
      if (f.size > L.MAX_FILE_BYTES) { errors.push([f.name, 'policyImport.err.tooBig']); continue; }
      const parsed = L.parseFile(f.name, await f.text().catch(() => ''));
      if (parsed.error) errors.push([f.name, parsed.error]);
      for (const raw of parsed.raw) read.push(L.prepare(raw, { sourceTenantId: parsed.tenantId, tenantId: tenant.tid }));
    }
    const names = {};
    for (const kind of new Set(read.filter(e => e.body && tenant.kinds.includes(e.kind)).map(e => e.kind))) {
      const r = await graph.call('names', kind);
      if (Array.isArray(r.names)) names[kind] = r.names;
    }
    prepared = read;
    namesByKind = names;
    writable = tenant.kinds;
    fileErrors = errors;
    entries = [];
    rebuild();
  }

  function askConfirm() {
    const todo = selected(), tenant = graph.tenantNow();
    if (!todo.length || !tenant) return;
    const v = form.value(), withScripts = ui.scripts.checked, shown = prefix.trimStart();
    const plans = todo.map(e => L.assignPlan(e.kind, v.target, withScripts)), assigned = plans.filter(p => p === 'assign').length;
    const scripts = todo.filter(e => e.hasScript).length, scriptsAssigned = todo.filter((e, i) => e.hasScript && plans[i] === 'assign').length;
    const close = () => dialog.remove();
    const cancel = el('button', { className: 'act ghost', textContent: T('policyImport.confirm.cancel'), onclick: close });
    const ok = el('button', { className: 'act', textContent: T('policyImport.confirm.ok'), onclick: () => { close(); run(todo, tenant.tid, v.target, withScripts); } });
    const dialog = el('div', { className: 'dialog', onkeydown: e => { if (e.key === 'Escape') close(); } }, el('div', { className: 'card', role: 'dialog', ariaModal: 'true' },
      el('h2', { textContent: T('policyImport.confirm.title', { n: todo.length }) }),
      el('p', { textContent: T('policyImport.confirm.tenant', { directory: directoryName() || '?', tid: tenant.tid }) }),
      ...(shown ? [el('p', { textContent: T('policyImport.confirm.prefix', { prefix: shown }) })] : []),
      ...(v.tagIds.length ? [el('p', { textContent: T('policyImport.confirm.tags', { tags: v.tagNames.join(', ') }) })] : []),
      el('p', { textContent: v.target ? T('policyImport.confirm.assign', { target: v.describe, n: assigned }) : T('policyImport.confirm.noAssign') }),
      ...(v.target && assigned < todo.length ? [el('p', { textContent: T('policyImport.confirm.notAssigned', { n: todo.length - assigned }) })] : []),
      ...(scriptsAssigned ? [el('p', { textContent: T('policyImport.confirm.assignScripts', { n: scriptsAssigned }) })] : scripts ? [el('p', { textContent: T('policyImport.confirm.scripts', { n: scripts }) })] : []),
      el('div', { className: 'btns' }, cancel, ok)));
    ui.root.append(dialog);
    cancel.focus(); // safe default: Enter cancels
  }

  // One creation, then its assignment when asked. The object stays when the assignment fails: the line⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ says so.
  const createThenAssign = (tid, target, withScripts) => async e => {
    const r = await graph.call('post', e.kind, { body: e.body, tid });
    const plan = ok2xx(r) && r.id ? L.assignPlan(e.kind, target, withScripts) : null;
    if (!plan) return r;
    if (plan !== 'assign') return { ...r, assign: { status: plan } };
    const a = await graph.call('assign', e.kind, { id: r.id, tid, body: A.newAssignment(e.kind, target) });
    return { ...r, assign: ok2xx(a) ? { status: 'done' } : { status: 'failed', error: a.message || `Graph ${a.status}` } };
  };

  async function run(todo, tid, target, withScripts) {
    running = true;
    renderTenant();
    renderRows();
    if (panel) { ui.progress.classList.add('on'); ui.fill.style.width = '0'; }
    setStatus(T('policyImport.status.running', { done: 0, total: todo.length }));
    const results = await L.runImport(todo, createThenAssign(tid, target, withScripts), {
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
    const notAssigned = results.filter(r => r.assign && r.assign.status !== 'done').length;
    setStatus(T('policyImport.status.done', { created: n('created'), failed: n('failed'), unknown: n('unknown'), skipped: n('skipped') }) + (notAssigned ? ` · ${T('policyImport.status.notAssigned', { n: notAssigned })}` : ''));
    renderTenant();
    renderRows();
    setTimeout(() => ui.progress?.classList.remove('on'), 1500);
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
    ui.prefix = el('input', { type: 'text', value: prefix, maxLength: 100, spellcheck: false, autocomplete: 'off', placeholder: T('policyImport.ui.prefix'), title: T('policyImport.ui.prefix'),
      oninput: () => { prefix = ui.prefix.value; if (prepared.length) rebuild(); } });
    const optionsChanged = () => {
      ui.scriptsRow.hidden = !form.value().target;
      if (prepared.length && !entries.some(e => e.result)) rebuild(); else renderRows();
    };
    form ||= window.__tenantCompassAssignForm({ call: graph.call, el, builtIn: false, filters: false, onChange: optionsChanged });
    const v = form.value();
    ui.scripts ||= el('input', { type: 'checkbox' });
    ui.scriptsRow = el('label', { className: 'opt', hidden: !v.target }, ui.scripts, T('policyImport.ui.assignScripts'));
    ui.options = el('fieldset', {}, form.root, ui.scriptsRow);
    const options = el('details', { className: 'options', open: !!v.target || !!v.tagIds.length }, el('summary', { textContent: T('policyImport.ui.options') }), ui.options);
    ui.list = el('div', { className: 'list' });
    ui.fill = el('i');
    ui.progress = el('div', { className: 'progress' }, ui.fill);
    ui.status = el('div', { className: 'status', textContent: lastStatus });
    ui.go = el('button', { className: 'act', onclick: askConfirm });
    const head = el('div', { className: 'head', title: T('policyImport.ui.drag') }, T('policyImport.ui.title'), el('span', { className: 'tools' }, ...(window.__tenantCompassPin ? [window.__tenantCompassPin('policy-import')] : []), el('button', { className: 'x', textContent: '×', title: T('policyImport.ui.close'), onclick: toggle })));
    panel = el('div', { className: 'panel' }, head, el('div', { className: 'bar' }, ui.tenant), el('div', { className: 'bar' }, ui.prefix), options, el('div', { className: 'bar' }, ui.all, ui.pick),
      ui.list, el('div', { className: 'foot' }, ui.progress, ui.status, ui.go));
    ui.root.append(panel);
    opened();
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(panel, head, 'policy-import-panel');
    renderRows();
    if (!running) graph.reset();
    const look = () => graph.discover().then(() => {
      renderTenant();
      if (graph.tenantNow() && !formLoaded) { formLoaded = true; form.load(); }
    });
    look();
    poll = setInterval(() => { if (!graph.tenantNow()) look(); }, 2000); // the token shows up with the portal's next Graph call
  }

  function mount() {
    if (!document.body || document.getElementById('policy-import')) return;
    const host = el('div', { id: 'policy-import' });
    ui.root = host.attachShadow({ mode: 'closed' });
    ui.root.adoptedStyleSheets = [sheet];
    const fab = el('button', { className: 'fab', textContent: T('policyImport.ui.fab'), title: T('policyImport.ui.fabTitle'), onclick: toggle });
    ui.root.append(fab);
    document.body.append(host);
    window.__tenantCompassLayer?.('policy-import', host);
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(fab, fab, 'policy-import-fab');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
