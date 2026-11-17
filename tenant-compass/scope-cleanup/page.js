// MAIN world, every frame of the Intune portal. Off by default: it⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ changes existing policies and apps.
// All frames: the Graph bridge observes the portal's token and serves the top frame.
// Top frame: floating button, list of the objects holding the Default⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ scope tag (or the one chosen in the tag list) with all
// their tags, confirmation, sequential run. An object with that tag only can be checked, but nothing is ever sent for it (scope-cleanup/lib.js).
(() => {
  const C = globalThis.ScopeCleanupLib, A = globalThis.TenantCompassAssign, P = globalThis.PolicyImportLib, S = globalThis.AsBuiltLib, bridge = window.__tenantCompassGraphBridge;
  if (!C || !A || !P || !S || !bridge) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);

  const info = t => {
    const { tid, scopes } = P.tokenScopes(t), kinds = C.kindsFor(scopes);
    return { tid, kinds: kinds.length ? [...kinds, 'meta'] : [] };
  };
  // Only what this feature needs: no assignment on this channel. The URLs come from the closed table of scope-cleanup/lib.js.
  const { tags, policy, patchTags } = bridge.assignOps({ ...A, policyUrl: C.itemUrl });
  const graph = bridge({ channel: 'scopeCleanup', info, jwtsIn: P.jwtsIn, ops: { tags, policy, patchTags, list: (token, kind, { plain }) => bridge.readAll(C.listUrl(kind, plain), token) } });
  if (!graph) return;

  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; font: 13px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; left: 20px; bottom: 280px; z-index: 2147483000; background: linear-gradient(135deg, #0078d4, #5b5fc7); color: #fff; border: 0;
           border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,120,212,.35); }
    .panel { position: fixed; left: 240px; bottom: 20px; z-index: 2147483001; width: 560px; max-height: 84vh; display: flex; flex-direction: column;
             background: #fff; color: #1b1a19; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.05); }
    .head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; color: #fff; font-size: 15px; font-weight: 600;
            background: linear-gradient(135deg, #0078d4, #5b5fc7); }
    .bar { display: flex; gap: 8px; padding: 10px 16px 0; align-items: center; color: #484644; font-size: 12px; overflow-wrap: anywhere; }
    .bar input[type=search], .bar select { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #e1dfdd; border-radius: 10px; background: #faf9f8; color: #323130; outline: none; }
    .list { overflow: auto; flex: 1; padding: 6px 10px; min-height: 160px; }
    label.row { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: 10px; cursor: pointer; }
    label.row:hover { background: #f3f2f1; }
    .row small { display: block; color: #605e5c; font-size: 11.5px; }
    .row small.failed { color: #a4262c; }
    .row small.done { color: #107c10; }
    .row small.unknown, .row small.onlyTag { color: #8a5300; font-weight: 600; }
    .chip { display: inline-block; margin: 2px 4px 0 0; padding: 0 7px; border-radius: 999px; background: #eff6fc; color: #005a9e; font-size: 11px; }
    .chip.tag { background: #f3f2f1; color: #323130; }
    .chip.target { background: #edebe9; color: #1b1a19; font-weight: 600; }
    .chip.warn { background: #fff4ce; color: #8a5300; font-weight: 600; }
    input[type=checkbox] { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: #0078d4; cursor: pointer; }
    .foot { padding: 12px 16px 14px; border-top: 1px solid #f3f2f1; display: flex; flex-direction: column; gap: 10px; }
    button.act { flex: 1; background: #0078d4; color: #fff; border: 0; border-radius: 10px; padding: 8px 10px; font-weight: 600; cursor: pointer; }
    button.act:hover:not(:disabled) { background: #106ebe; }
    button.act.ghost { background: #eff6fc; color: #005a9e; }
    button.act:disabled { background: #e1dfdd; color: #a19f9d; cursor: default; }
    .tools { display: flex; gap: 6px; }
    .foot .btns { display: flex; gap: 8px; }
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
    .opt { display: flex; gap: 8px; align-items: center; color: #484644; font-size: 12px; cursor: pointer; }
    .opt input { margin: 0; }
  `);

  // target: the scope tag chosen in the list, Default at first.
  let panel = null, poll = 0, running = false, items = null, lastStatus = '', tagNames = new Map(), onlyRemovable = false, target = C.DEFAULT, loadNotes = [];
  const checked = new Set(), results = new Map(), ui = {};

  const directoryName = () => document.querySelector('.fxs-avatarmenu-tenant')?.textContent.trim() || '';
  const selected = () => (items || []).filter(i => checked.has(i.key));
  const tagName = id => tagNames.get(id) || (id === C.DEFAULT ? 'Default' : id);
  function setStatus(text) { lastStatus = text; if (panel) ui.status.textContent = text; }

  const removable = i => C.stateOf(i.tags, target) === 'removable';
  // Objects holding the tag chosen, those the button can act on first (items are sorted by name, the sort is stable).
  function visible() {
    const q = ui.search.value.trim().toLowerCase(), kind = ui.type.value, os = ui.os.value;
    return (items || []).filter(i => (!kind || i.kind === kind) && (!os || S.platformsOf(i).includes(os)) && (!q || String(i.name).toLowerCase().includes(q)) && C.keepRow(i.tags, results.has(i.key), onlyRemovable, target))
      .sort((a, b) => removable(b) - removable(a));
  }

  // What "check all" takes: with the filter on, only the objects the button can act on, not the rows already processed.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  const checkable = () => visible().filter(i => !onlyRemovable || removable(i));

  function resultNote(r) {
    if (!r) return [];
    const KEYS = { done: 'scopeCleanup.res.done', onlyTag: 'scopeCleanup.res.onlyTag', absent: 'scopeCleanup.res.absent', unreadable: 'scopeCleanup.res.unreadable', unknown: 'scopeCleanup.res.unknown', notSent: 'scopeCleanup.res.notSent' };
    return [el('small', { className: r.status, textContent: T(KEYS[r.status] || r.error || '', { tag: tagName(target) }) })];
  }

  // Counts for the tag chosen, then what the load could not read.
  function countText() {
    const states = (items || []).map(i => C.stateOf(i.tags, target)), n = s => states.filter(x => x === s).length;
    return [T('scopeCleanup.status.count', { tag: tagName(target), total: n('removable') + n('onlyTag'), removable: n('removable'), only: n('onlyTag') }), ...loadNotes].join(' · ');
  }

  // The tag list: every tag of the tenant with the number of objects holding it, Default first.
  function renderTags() {
    if (!panel || !items) return;
    ui.tag.replaceChildren(...C.tagChoices(items.map(i => i.tags), tagNames).map(c => el('option', { value: c.id, textContent: `${c.name} (${c.n})` })));
    ui.tag.value = target;
  }

  // Another tag: the rows checked and the results shown were for the previous one, they go.
  function tagChanged() {
    target = ui.tag.value || C.DEFAULT;
    checked.clear();
    results.clear();
    setStatus(countText());
    renderList();
  }

  function renderList() {
    if (!panel) return;
    ui.list.replaceChildren(...visible().map(i => {
      const box = el('input', { type: 'checkbox', checked: checked.has(i.key), disabled: running, onchange: () => { box.checked ? checked.add(i.key) : checked.delete(i.key); renderGo(); } });
      const state = C.stateOf(i.tags, target), done = results.get(i.key);
      return el('label', { className: 'row' }, box, el('span', {}, i.name,
        el('small', {}, i.type, ' ', ...S.platformsOf(i).map(o => el('span', { className: 'chip', textContent: o }))),
        el('small', {}, ...i.tags.map(t => el('span', { className: t === target ? 'chip target' : 'chip tag', textContent: tagName(t) })),
          ...(state === 'onlyTag' ? [el('span', { className: 'chip warn', textContent: T('scopeCleanup.chip.onlyTag', { tag: tagName(target) }) })] : [])),
        ...resultNote(done)));
    }));
    renderGo();
  }

  function renderGo() {
    if (!panel) return;
    const n = selected().length;
    ui.go.textContent = T('scopeCleanup.ui.go', { n, tag: tagName(target) });
    ui.go.disabled = running || !n;
    ui.export.disabled = !n;
    ui.onlyBox.disabled = ui.tag.disabled = running;
    ui.onlyText.textContent = T('scopeCleanup.ui.onlyRemovable', { n: (items || []).filter(removable).length, tag: tagName(target) });
    const shown = checkable();
    ui.all.disabled = running || !shown.length;
    ui.all.checked = !!shown.length && shown.every(i => checked.has(i.key));
  }

  async function load() {
    setStatus(T('scopeCleanup.status.loading'));
    const tenant = graph.tenantNow(), errors = [], missing = C.KINDS.filter(k => !tenant.kinds.includes(k));
    const t = await graph.call('tags', 'meta');
    if (t.status >= 200 && t.status < 300) tagNames = new Map((t.body?.value || []).map(x => [String(x.id), x.displayName]));
    let unreadable = 0;
    const lists = await Promise.all(C.KINDS.filter(k => tenant.kinds.includes(k)).map(async kind => {
      const { rows, error } = await C.loadKind(kind, graph.call);
      if (error) { errors.push(T('asBuilt.src.' + kind)); return []; }
      const withTags = await C.resolveTags(kind, rows, graph.call);
      unreadable += withTags.filter(r => !r.tags).length;
      // Every object with readable tags: the tag list picks which ones are shown.
      return withTags.filter(r => r.tags).map(raw => ({ ...S.policySummary(kind, raw), key: kind + ':' + raw.id, tags: raw.tags }));
    }));
    items = lists.flat().sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    const oses = [...new Set(items.flatMap(S.platformsOf))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (panel) ui.os.replaceChildren(el('option', { value: '', textContent: T('scopeCleanup.ui.allOs') }), ...oses.map(o => el('option', { value: o, textContent: o })));
    loadNotes = [...(unreadable ? [T('scopeCleanup.status.unreadable', { n: unreadable })] : []),
      ...(errors.length ? [T('scopeCleanup.status.source', { list: errors.join(', ') })] : []),
      ...(missing.length ? [T('scopeCleanup.status.noScope', { list: missing.map(k => T('asBuilt.src.' + k)).join(', ') })] : [])];
    setStatus(countText());
    renderTags();
    renderList();
  }

  // The rows checked, as they are in the list. No Graph read: the file says what the user saw.
  function exportSelected() {
    const rows = C.exportRows(selected().map(i => ({ ...i, platforms: S.platformsOf(i) })), tagName);
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `scope-cleanup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(T('scopeCleanup.status.exported', { n: rows.length }));
  }

  function askConfirm() {
    const todo = selected(), tenant = graph.tenantNow();
    if (!todo.length || !tenant) return;
    const tag = target, name = tagName(tag);
    const skipped = todo.filter(i => !removable(i)).length, acting = todo.length - skipped;
    const close = () => dialog.remove();
    const cancel = el('button', { className: 'act ghost', textContent: T('scopeCleanup.confirm.cancel'), onclick: close });
    const ok = el('button', { className: 'act', textContent: T('scopeCleanup.confirm.ok'), onclick: () => { close(); run(todo, tenant.tid, tag); } });
    const dialog = el('div', { className: 'dialog', onkeydown: e => { if (e.key === 'Escape') close(); } }, el('div', { className: 'card', role: 'dialog', ariaModal: 'true' },
      el('h2', { textContent: T('scopeCleanup.confirm.title', { n: acting, tag: name }) }),
      el('p', { textContent: T('scopeCleanup.confirm.tenant', { directory: directoryName() || '?', tid: tenant.tid }) }),
      el('p', { textContent: acting ? T('scopeCleanup.confirm.effect', { tag: name }) : T('scopeCleanup.confirm.none') }),
      ...(skipped ? [el('p', { textContent: T('scopeCleanup.confirm.skipped', { n: skipped, tag: name }) })] : []),
      el('div', { className: 'btns' }, cancel, ok)));
    ui.root.append(dialog);
    cancel.focus(); // safe default: Enter cancels
  }

  // tag: the one confirmed in the dialog. The tag list is locked while the series runs.
  async function run(todo, tid, tag) {
    running = true;
    renderList();
    if (panel) { ui.progress.classList.add('on'); ui.fill.style.width = '0'; }
    setStatus(T('scopeCleanup.status.running', { done: 0, total: todo.length }));
    const out = await C.runClean(todo, tid, graph.call, {
      pause: sleep,
      tag,
      onProgress: (i, res) => {
        const item = todo[i];
        results.set(item.key, res);
        if (res.tags?.length) item.tags = res.tags; // the tags just read, or left by the removal
        // Failed lines stay checked for another try.
        if (res.status !== 'failed' && res.status !== 'notSent') checked.delete(item.key);
        setStatus(T('scopeCleanup.status.running', { done: i + 1, total: todo.length }));
        if (panel) ui.fill.style.width = `${Math.round(100 * (i + 1) / todo.length)}%`;
        renderList();
      },
    });
    running = false;
    const n = s => out.filter(r => r.status === s).length;
    setStatus(T('scopeCleanup.status.done', { done: n('done'), none: n('onlyTag') + n('absent') + n('unreadable'), failed: n('failed'), unknown: n('unknown'), notSent: n('notSent') }));
    renderTags(); // the counts per tag changed
    renderList();
    setTimeout(() => ui.progress?.classList.remove('on'), 1500);
  }

  // One panel at a time, see shared/drag.js. A running series goes on when the panel closes.
  const opened = window.__tenantCompassExclusive ? window.__tenantCompassExclusive('scope-cleanup', () => { if (panel) toggle(); }) : () => {};

  function toggle() {
    if (panel) { panel.remove(); panel = null; clearInterval(poll); return; }
    ui.tenant = el('div', { textContent: T('scopeCleanup.status.searching') });
    ui.search = el('input', { type: 'search', placeholder: T('scopeCleanup.ui.search'), title: T('scopeCleanup.ui.search'), oninput: renderList });
    ui.all = el('input', { type: 'checkbox', title: T('scopeCleanup.ui.selectAll'), onchange: () => {
      for (const i of checkable()) ui.all.checked ? checked.add(i.key) : checked.delete(i.key);
      renderList();
    } });
    ui.type = el('select', { onchange: renderList }, el('option', { value: '', textContent: T('scopeCleanup.ui.allTypes') }), ...C.KINDS.map(k => el('option', { value: k, textContent: T('asBuilt.src.' + k) })));
    ui.os = el('select', { onchange: renderList }, el('option', { value: '', textContent: T('scopeCleanup.ui.allOs') }));
    ui.onlyBox = el('input', { type: 'checkbox', checked: onlyRemovable, onchange: () => {
      onlyRemovable = ui.onlyBox.checked;
      // A hidden Default only row must not stay checked: the count on the button is⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ what gets processed.
      if (onlyRemovable) for (const i of items || []) if (C.stateOf(i.tags, target) === 'onlyTag') checked.delete(i.key);
      renderList();
    } });
    ui.onlyText = el('span');
    ui.tag = el('select', { title: T('scopeCleanup.ui.tag'), ariaLabel: T('scopeCleanup.ui.tag'), onchange: tagChanged }, el('option', { value: target, textContent: tagName(target) }));
    ui.list = el('div', { className: 'list' });
    ui.fill = el('i');
    ui.progress = el('div', { className: 'progress' }, ui.fill);
    ui.status = el('div', { className: 'status', textContent: lastStatus });
    ui.go = el('button', { className: 'act', disabled: true, textContent: T('scopeCleanup.ui.go', { n: 0 }), onclick: askConfirm });
    ui.export = el('button', { className: 'act ghost', disabled: true, textContent: T('scopeCleanup.ui.export'), title: T('scopeCleanup.ui.exportTitle'), onclick: exportSelected });
    const head = el('div', { className: 'head', title: T('scopeCleanup.ui.drag') }, T('scopeCleanup.ui.title'), el('span', { className: 'tools' }, ...(window.__tenantCompassPin ? [window.__tenantCompassPin('scope-cleanup')] : []), el('button', { className: 'x', textContent: '×', title: T('scopeCleanup.ui.close'), onclick: toggle })));
    panel = el('div', { className: 'panel' }, head, el('div', { className: 'bar' }, ui.tenant),
      el('div', { className: 'bar' }, el('span', { textContent: T('scopeCleanup.ui.tag') }), ui.tag), el('div', { className: 'bar' }, ui.all, ui.search),
      el('div', { className: 'bar' }, ui.type, ui.os), el('div', { className: 'bar' }, el('label', { className: 'opt' }, ui.onlyBox, ui.onlyText)), ui.list, el('div', { className: 'foot' }, ui.progress, ui.status, el('div', { className: 'btns' }, ui.export, ui.go)));
    ui.root.append(panel);
    opened();
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(panel, head, 'scope-cleanup-panel');
    if (!running) graph.reset();
    const look = async () => {
      await graph.discover();
      const tenant = graph.tenantNow();
      if (!panel) return;
      ui.tenant.textContent = tenant ? [directoryName(), tenant.tid].filter(Boolean).join(' · ') : T('assignForm.noToken');
      if (tenant) { clearInterval(poll); if (!running) await load(); else { renderTags(); renderList(); } }
    };
    look();
    poll = setInterval(look, 2000); // the token shows up with the portal's next Graph call
  }

  function mount() {
    if (!document.body || document.getElementById('scope-cleanup')) return;
    const host = el('div', { id: 'scope-cleanup' });
    ui.root = host.attachShadow({ mode: 'closed' });
    ui.root.adoptedStyleSheets = [sheet];
    const fab = el('button', { className: 'fab', textContent: T('scopeCleanup.ui.fab'), title: T('scopeCleanup.ui.fabTitle'), onclick: toggle });
    ui.root.append(fab);
    document.body.append(host);
    window.__tenantCompassLayer?.('scope-cleanup', host);
    if (window.__tenantCompassDrag) window.__tenantCompassDrag(fab, fab, 'scope-cleanup-fab');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
