// MAIN world: form shared by Policy Import and Bulk Assignment (target, filter, scope tags). Reads only: the features⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ write.
// call: bridge.call. builtIn: offer All users and All devices. filters: offer assignment filters.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
(() => {
  if (window.__tenantCompassAssignForm) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);
  const ok = r => r.status >= 200 && r.status < 300;

  function form({ call, el, builtIn, filters, onChange = () => {} }) {
    const A = globalThis.TenantCompassAssign;
    const option = (value, textContent) => el('option', { value, textContent });
    const changed = () => { sync(); onChange(); };
    const mode = el('select', { onchange: changed }, option('none', T('assignForm.none')), option('group', T('assignForm.group')),
      ...(builtIn ? [option('allUsers', T('assignForm.allUsers')), option('allDevices', T('assignForm.allDevices'))] : []));
    let timer = 0, seq = 0;
    const search = el('input', { type: 'search', placeholder: T('assignForm.search'), title: T('assignForm.search'), oninput: () => { clearTimeout(timer); timer = setTimeout(find, 300); } });
    const group = el('select', { onchange: changed }, option('', T('assignForm.pick')));
    const hint = el('small', { className: 'hint' });
    const filter = el('select', { onchange: changed, title: T('assignForm.filter') }, option('', T('assignForm.noFilter')));
    const filterMode = el('select', { onchange: changed }, option('include', T('assignForm.include')), option('exclude', T('assignForm.exclude')));
    const tags = el('select', { multiple: true, size: 3, onchange: changed, title: T('assignForm.tags') });
    const tagsHint = el('small', { className: 'hint' });

    const field = (label, ...kids) => el('div', { className: 'field' }, el('span', { textContent: label }), ...kids);
    const groupRow = el('div', { className: 'field' }, el('span'), search, group, hint);
    const filterHint = el('small', { className: 'hint' });
    const filterRow = field(T('assignForm.filter'), filter, filterMode, filterHint);
    const root = el('div', { className: 'form' }, field(T('assignForm.target'), mode), groupRow, ...(filters ? [filterRow] : []), field(T('assignForm.tags'), tags, tagsHint));

    function sync() {
      groupRow.hidden = mode.value !== 'group';
      filterRow.hidden = mode.value === 'none';
      filterMode.hidden = !filter.value;
    }

    async function find() {
      const q = search.value, mine = ++seq;
      if (!q.trim()) return;
      const r = await call('groups', 'meta', { q });
      if (mine !== seq) return; // an older answer must not replace a newer one
      const list = ok(r) ? A.groupsIn(r.body) : [];
      group.replaceChildren(option('', T('assignForm.pick')), ...list.map(g => option(g.id, g.name)));
      if (list.length === 1) group.value = list[0].id;
      hint.textContent = !ok(r) ? T('assignForm.searchFailed') : list.length ? '' : T('assignForm.noResult');
      changed();
    }

    const selected = s => [...s.selectedOptions].map(o => o.value);
    const label = s => s.selectedOptions[0]?.textContent || '';

    async function load() {
      const [t, f] = await Promise.all([call('tags', 'meta'), filters ? call('filters', 'meta') : { status: 200, body: { value: [] } }]);
      const kept = selected(tags);
      tags.replaceChildren(...(ok(t) ? t.body.value : []).map(x => el('option', { value: String(x.id), textContent: x.displayName, selected: kept.includes(String(x.id)) })));
      tagsHint.textContent = ok(t) ? '' : T('assignForm.tagsFailed');
      filterHint.textContent = !ok(f) ? T('assignForm.filtersFailed', { error: f.message || `Graph ${f.status}` }) : f.body.value.length ? '' : T('assignForm.noFilters');
      if (ok(f)) filter.replaceChildren(option('', T('assignForm.noFilter')), ...f.body.value.map(x => option(x.id, x.platform ? `${x.displayName} (${x.platform})` : x.displayName)));
      changed();
    }

    // What the user chose, ready for the feature: target is null when nothing, or nothing complete, is chosen.
    function value() {
      const filterId = mode.value !== 'none' && filters ? filter.value : '';
      const target = A.targetOf({ mode: mode.value, groupId: group.value, filterId, filterMode: filterMode.value });
      const names = [mode.value === 'group' ? label(group) : label(mode), ...(filterId ? [`${label(filter)}, ${label(filterMode)}`] : [])];
      return { target, complete: mode.value === 'none' || !!target, describe: names.join(' · '), tagIds: selected(tags), tagNames: [...tags.selectedOptions].map(o => o.textContent) };
    }

    sync();
    return { root, load, value };
  }

  form.css = `
    .form { display: flex; flex-direction: column; gap: 8px; padding: 10px 16px 0; color: #484644; font-size: 12px; }
    .field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .field[hidden] { display: none; }
    .field > span { flex: 0 0 100%; font-size: 12px; font-weight: 600; }
    .field > span:empty { display: none; }
    .form select, .form input { flex: 1 1 40%; min-width: 0; padding: 6px 8px; border: 1px solid #e1dfdd; border-radius: 10px; background: #faf9f8; color: #323130; outline: none; }
    .form select[hidden] { display: none; }
    .form select:focus, .form input:focus { border-color: #0078d4; box-shadow: 0 0 0 3px rgba(0,120,212,.15); background: #fff; }
    .form select[multiple] { flex-basis: 100%; }
    .hint { flex: 0 0 100%; color: #a4262c; font-size: 11.5px; }
    .hint:empty { display: none; }
  `;

  window.__tenantCompassAssignForm = form;
})();
