// MAIN world, every frame of the Intune portal. Off by default: it changes existing policies, and they reach devices.
// All frames: the Graph bridge observes the⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ portal's token and serves the top frame.
// Top frame: floating button, policy list as in As-Built, target and scope tags, confirmation, sequential run.
// A run only adds: existing assignments and scope tags are read first and sent back (bulk-assign/lib.js).
(() => {
  const B = globalThis.BulkAssignLib, A = globalThis.TenantCompassAssign, P = globalThis.PolicyImportLib, S = globalThis.AsBuiltLib, bridge = window.__tenantCompassGraphBridge;
  if (!B || !A || !P || !S || !bridge) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);

  // ADMX and lookups use the same write scope as profiles: tokenInfo⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ knows only the types Policy Import creates.
  const info = t => {
    const i = P.tokenInfo(t);
    return { tid: i.tid, kinds: i.kinds.length ? [...i.kinds.filter(A.assignable), ...(i.kinds.includes('dc') ? ['admx'] : []), 'meta'] : [] };
  };
  const graph = bridge({ channel: 'bulkAssign', info, jwtsIn: P.jwtsIn, ops: { ...bridge.assignOps(A), list: (token, kind) => bridge.readAll(B.listUrl(kind), token) } });
  if (!graph) return;

  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SCRIPTS = new Set(['ps', 'sh', 'cattr']);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; font: 13px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; left: 206px; bottom: 20px; z-index: 2147483000; background: linear-gradient(135deg, #0078d4, #5b5fc7); color: #fff; border: 0;
           border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,120,212,.35); }
    .panel { position: fixed; left: 20px; bottom: 76px; z-index: 2147483001; width: 520px; max-height: 84vh; display: flex; flex-direction: column;
             background: #fff; color: #1b1a19; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.05); }
    .head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; color: #fff; font-size: 15px; font-weight: 600;
            background: linear-gradient(135deg, #0078d4, #5b5fc7); }
    .bar { display: flex; gap: 8px; padding: 10px 16px 0; align-items: center; color: #484644; font-size: 12px; overflow-wrap: anywhere; }
    .bar input[type=search], .bar select { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #e1dfdd; border-radius: 10px; background: #faf9f8; color: #323130; outline: none; }
    .list { overflow: auto; flex: 1; padding: 6px 10px; min-height: 120px; }
    label.row { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: 10px; cursor: pointer; }
    label.row:hover { background: #f3f2f1; }
    .row small { display: block; color: #605e5c; font-size: 11.5px; }
    .row small.failed { color: #a4262c; }
    .row small.done { color: #107c10; }
    .row small.unknown, .row small.skipped { color: #8a5300; font-weight: 600; }
    .chip { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; background: #eff6fc; color: #005a9e; font-size: 11px; }
    input[type=checkbox] { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: #0078d4; cursor: pointer; }
    .foot { padding: 12px 16px 14px; margin-top: 10px; border-top: 1px solid #f3f2f1; display: flex; flex-direction: column; gap: 10px; }
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
    .card { width: 480px; max-width: calc(100vw - 40px); background: #fff; color: #1b1a19; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 10px;
            box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .card h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .card p { margin: 0; overflow-wrap: anywhere; }
    .card .btns { display: flex; gap: 8px; }
    ${window.__tenantCompassAssignForm.css}
  `);

  let panel = null, poll = 0, running = false, items = null, lastStatus = '', form = null;
  const checked = new Set(), results = new Map(), ui = {};

  const directoryName = () => document.querySelector('.fxs-avatarmenu-tenant')?.textContent.trim() || '';
  const selected = () => (items || []).filter(i => checked.has(i.key));
  function setStatus(text) { lastStatus = text; if (panel) ui.status.textContent = text; }

  function visible() {
    const q = ui.search.value.trim().toLowerCase(), kind = ui.type.value, os = ui.os.value;
    return (items || []).filter(i => (!kind || i.kind === kind) && (!os || S.platformsOf(i).includes(os)) && (!q || String(i.name).toLowerCase().includes(q)));
  }

  function resultLine(labelKey, r) {
    if (!r) return [];
    const text = r.status === 'done' ? T('bulkAssign.res.done') : r.status === 'already' ? T('bulkAssign.res.already') : r.status === 'unknown' ? T('bulkAssign.res.unknown') : r.status === 'notSent' ? T('bulkAssign.res.notSent') : T(r.error || '');
    return [el('small', { className: r.status === 'already' ? '' : r.status, textContent: `${T(labelKey)} : ${text}` })];
  }

  function renderList() {
    if (!panel) return;
    ui.list.replaceChildren(...visible().map(i => {
      const box = el('input', { type: 'checkbox', checked: checked.has(i.key), disabled: running, onchange: () => { box.checked ? checked.add(i.key) : checked.delete(i.key); renderGo(); } });
      const r = results.get(i.key);
      return el('label', { className: 'row' }, box, el('span', {}, i.name, el('small', {}, i.type, ...S.platformsOf(i).map(o => el('span', { className: 'chip', textContent: o }))),
        ...resultLine('bulkAssign.res.assign', r?.assign), ...resultLine('bulkAssign.res.tags', r?.tags)));
    }));
    renderGo();
  }

  function renderGo() {
    if (!panel) return;
    const n = selected().length, v = form.value();
    ui.go.textContent = T('bulkAssign.ui.go', { n });
    ui.go.disabled = running || !n || !v.complete || (!v.target && !v.tagIds.length);
    const shown = visible();
    ui.all.disabled = running || !shown.length;
    ui.all.checked = !!shown.length && shown.every(i => checked.has(i.key));
  }

  async function load() {
    setStatus(T('bulkAssign.status.loading'));
    const tenant = graph.tenantNow(), errors = [];
    const lists = await Promise.all(B.KINDS.filter(k => tenant.kinds.includes(k)).map(async kind => {
      const r = await graph.call('list', kind);
      if (r.status < 200 || r.status >= 300) { errors.push(T('asBuilt.src.' + kind)); return []; }
      return r.body.value.map(raw => ({ ...S.policySummary(kind, raw), key: kind + ':' + raw.id }));
    }));
    items = lists.flat().sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    const oses = [...new Set(items.flatMap(S.platformsOf))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (panel) ui.os.replaceChildren(el('option', { value: '', textContent: T('bulkAssign.ui.allOs') }), ...oses.map(o => el('option', { value: o, textContent: o })));
    setStatus(T('bulkAssign.status.count', { n: items.length }) + (errors.length ? ` · ${T('bulkAssign.err.source', { list: errors.join(', ') })}` : ''));
    renderList();
    form.load();
  }

  function askConfirm() {
    const todo = selected(), tenant = graph.tenantNow(), v = form.value();
    if (!todo.length || !tenant) return;
    const scripts = v.target ? todo.filter(i => SCRIPTS.has(i.kind)).length : 0;
    const close = () => dialog.remove();
    const cancel = el('button', { className: 'act ghost', textContent: T('bulkAssign.confirm.cancel'), onclick: close });
    const ok = el('button', { className: 'act', textContent: T('bulkAssign.confirm.ok'), onclick: () => { close(); run(todo, { target: v.target, tagIds: v.tagIds, tid: tenant.tid }); } });
    const dialog = el('div', { className: 'dialog', onkeydown: e => { if (e.key === 'Escape') close(); } }, el('div', { className: 'card', role: 'dialog', ariaModal: 'true' },
      el('h2', { textContent: T('bulkAssign.confirm.title', { n: todo.length }) }),
      el('p', { textContent: T('bulkAssign.confirm.tenant', { directory: directoryName() || '?', tid: tenant.tid }) }),
      ...(v.target ? [el('p', { textContent: T('bulkAssign.confirm.target', { target: v.describe }) })] : []),
      ...(v.tagIds.length ? [el('p', { textContent: T('bulkAssign.confirm.tags', { tags: v.tagNames.join(', ') }) })] : []),
      el('p', { textContent: T('bulkAssign.confirm.effect') }),
      ...(scripts ? [el('p', { textContent: T('bulkAssign.confirm.scripts', { n: scripts }) })] : []),
      el('div', { className: 'btns' }, cancel, ok)));
    ui.root.append(dialog);
    cancel.focus(); // safe default: Enter cancels
  }

  async function run(todo, plan) {
    running = true;
    renderList();
    if (panel) { ui.progress.classList.add('on'); ui.fill.style.width = '0'; }
    setStatus(T('bulkAssign.status.running', { done: 0, total: todo.length }));
    const out = await B.runBulk(todo, plan, graph.call, {
      pause: sleep,
      onProgress: (i, res) => {
        results.set(todo[i].key, res);
        // Applied or already⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ there: not offered again. Failed lines stay checked for another try.
        if ([res.assign, res.tags].filter(Boolean).every(r => r.status === 'done' || r.status === 'already')) checked.delete(todo[i].key);
        setStatus(T('bulkAssign.status.running', { done: i + 1, total: todo.length }));
        if (panel) ui.fill.style.width = `${Math.round(100 * (i + 1) / todo.length)}%`;
        renderList();
      },
    });
    running = false;
    const lines = out.flatMap(r => [r.assign, r.tags]).filter(Boolean), n = s => lines.filter(r => r.status === s).length;
    setStatus(T('bulkAssign.status.done', { done: n('done'), already: n('already'), skipped: n('skipped') + n('notSent'), failed: n('failed'), unknown: n('unknown') }));
    renderList();
    setTimeout(() => ui.progress?.classList.remove('on'), 1500);
  }

  // One⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ panel at a time, see shared/drag.js. A running series goes on when the panel closes.
  const opened = window.__tenantCompassExclusive ? window.__tenantCompassExclusive('bulk-assign', () => { if (panel) toggle(); }) : () => {};

  function toggle() {
    if (panel) { panel.remove(); panel = null; clearInterval(poll); return; }
    ui.tenant = el('div', { textContent: T('bulkAssign.status.searching') });
    ui.search = el('input', { type: 'search', placeholder: T('bulkAssign.ui.search'), title: T('bulkAssign.ui.search'), oninput: renderList });
    ui.all = el('input', { type: 'checkbox', title: T('bulkAssign.ui.selectAll'), onchange: () => {
      for (const i of visible()) ui.all.checked ? checked.add(i.key) : checked.delete(i.key);
      renderList();
    } });
    ui.type = el('select', { onchange: renderList }, el('option', { value: '', textContent: T('bulkAssign.ui.allTypes') }), ...B.KINDS.map(k => el('option', { value: k, textContent: T('asBuilt.src.' + k) })));
    ui.os = el('select', { onchange: renderList }, el('option', { value: '', textContent: T('bulkAssign.ui.allOs') }));
    ui.list = el('div', { className: 'list' });
    form = window.__tenantCompassAssignForm({ call: graph.call, el, builtIn: true, filters: true, onChange: renderGo });
    ui.fill = el('i');
    ui.progress = el('div', { className: 'progress' }, ui.fill);
    ui.status = el('div', { className: 'status', textContent: lastStatus });
    ui.go = el('button', { className: 'act', disabled: true, textContent: T('bulkAssign.ui.go', { n: 0 }), onclick: askConfirm });
    const head = el('div', { className: 'head', title: T('bulkAssign.ui.drag') }, T('bulkAssign.ui.title'), el('button', { className: 'x', textContent: '×', title: T('bulkAssign.ui.close'), onclick: toggle }));
    panel = el('div', { className: 'panel' }, head, el('div', { className: 'bar' }, ui.tenant), el('div', { className: 'bar' }, ui.all, ui.search),
      el('div', { className: 'bar' }, ui.type, ui.os), ui.list, form.root, el('div', { className: 'foot' }, ui.progress, ui.status, ui.go));
    ui.root.append(panel);
    opened();
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(panel, head, 'bulk-assign-panel');
    if (!running) graph.reset();
    const look = async () => {
      await graph.discover();
      const tenant = graph.tenantNow();
      if (!panel) return;
      ui.tenant.textContent = tenant ? [directoryName(), tenant.tid].filter(Boolean).join(' · ') : T('assignForm.noToken');
      if (tenant) { clearInterval(poll); if (!running) await load(); else renderList(); }
    };
    look();
    poll = setInterval(look, 2000); // the token shows up with the portal's next Graph call
  }

  function mount() {
    if (!document.body || document.getElementById('bulk-assign')) return;
    const host = el('div', { id: 'bulk-assign' });
    ui.root = host.attachShadow({ mode: 'closed' });
    ui.root.adoptedStyleSheets = [sheet];
    const fab = el('button', { className: 'fab', textContent: T('bulkAssign.ui.fab'), title: T('bulkAssign.ui.fabTitle'), onclick: toggle });
    ui.root.append(fab);
    document.body.append(host);
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(fab, fab, 'bulk-assign-fab');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
