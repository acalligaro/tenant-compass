// Pure helpers of Scope Tags Clean up: closed tables, the rule on the Default tag, one line, the whole run. No DOM, no network.
// The rule: Default goes only when another tag stays. The read just before the write decides, never the list⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ shown earlier.
(() => {
  const A = globalThis.TenantCompassAssign || require('../shared/assign-lib.js');
  const DM = 'https://graph.microsoft.com/beta/deviceManagement/', APPS = 'https://graph.microsoft.com/beta/deviceAppManagement/';
  const CONFIG = 'DeviceManagementConfiguration.ReadWrite.All', SCRIPTS = 'DeviceManagementScripts.ReadWrite.All', MOBILE = 'DeviceManagementApps.ReadWrite.All';
  const DEFAULT = '0', PAUSE_MS = 250, CONCURRENCY = 3;
  const PLAIN = '?$select=id,displayName,description,lastModifiedDateTime', TAGGED = PLAIN + ',roleScopeTagIds';

  // Closed table: the URL of a write comes from here. typed: polymorphic resource, PATCH needs its @odata.type.
  // select: As-Built reads these lists with PLAIN on real tenants, and the tags are asked on top of it.
  const KINDS = new Map([
    ['sc', { root: DM, path: 'configurationPolicies', scope: CONFIG }],
    ['dc', { root: DM, path: 'deviceConfigurations', scope: CONFIG, select: true, typed: true }],
    ['comp', { root: DM, path: 'deviceCompliancePolicies', scope: CONFIG, select: true, typed: true }],
    ['admx', { root: DM, path: 'groupPolicyConfigurations', scope: CONFIG }],
    ['ps', { root: DM, path: 'deviceManagementScripts', scope: SCRIPTS, select: true }],
    ['sh', { root: DM, path: 'deviceShellScripts', scope: SCRIPTS, select: true }],
    ['cattr', { root: DM, path: 'deviceCustomAttributeShellScripts', scope: SCRIPTS, select: true }],
    ['rem', { root: DM, path: 'deviceHealthScripts', scope: SCRIPTS, select: true }],
    ['app', { root: APPS, path: 'mobileApps', scope: MOBILE, select: true, typed: true }],
  ]);

  const itemUrl = (kind, id) => (KINDS.has(kind) ? `${KINDS.get(kind).root}${KINDS.get(kind).path}/${encodeURIComponent(id)}` : null);
  const listUrl = (kind, plain) => {
    const k = KINDS.get(kind);
    return k ? k.root + k.path + (k.select ? (plain ? PLAIN : TAGGED) : '') : null;
  };
  const kindsFor = scopes => [...KINDS].filter(([, v]) => scopes.includes(v.scope)).map(([k]) => k);

  // Tags of a Graph object as strings, null when absent or empty: every Intune object has at least one tag.
  const tagsIn = raw => (Array.isArray(raw?.roleScopeTagIds) && raw.roleScopeTagIds.length ? raw.roleScopeTagIds.map(String) : null);

  function stateOf(tags) {
    if (!tags?.length) return 'unreadable';
    const list = tags.map(String);
    if (!list.includes(DEFAULT)) return 'noDefault';
    return list.some(t => t !== DEFAULT) ? 'removable' : 'onlyDefault';
  }

  // The filter on objects holding Default and another tag. A row already processed stays, to show its result.
  const keepRow = (tags, processed, onlyRemovable) => !onlyRemovable || processed || stateOf(tags) === 'removable';

  // What to do with an object just read. A body exists only when another⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ tag stays.
  function cleanPlan(kind, policy) {
    const tags = tagsIn(policy), state = stateOf(tags);
    if (state !== 'removable') return { action: state, tags };
    const type = policy['@odata.type'];
    if (KINDS.get(kind)?.typed && !type) return { action: 'unreadable', tags };
    return { action: 'remove', tags, body: { ...(KINDS.get(kind)?.typed ? { '@odata.type': type } : {}), roleScopeTagIds: tags.filter(t => t !== DEFAULT) } };
  }

  // ---------- reading ----------

  const ok = r => r.status >= 200 && r.status < 300;

  // The list with its tags, else the plain list: the tags are then read one by one.
  async function loadKind(kind, call) {
    let r = await call('list', kind, {});
    if (!ok(r)) r = await call('list', kind, { plain: true });
    return ok(r) ? { rows: r.body?.value || [], error: null } : { rows: [], error: r.message || `Graph ${r.status}` };
  }

  // Adds `tags` to each row. Rows without tags in the list are read one by one, three at a time.
  async function resolveTags(kind, rows, call) {
    const out = rows.map(raw => ({ ...raw, tags: tagsIn(raw) }));
    const todo = out.filter(r => !r.tags);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      for (let row; (row = todo.shift());) {
        const r = await A.withRetry(() => call('policy', kind, { id: row.id }), ms => new Promise(done => setTimeout(done, ms)));
        if (ok(r)) { row.tags = tagsIn(r.body); if (!row['@odata.type']) row['@odata.type'] = r.body?.['@odata.type']; }
      }
    }));
    return out;
  }

  // ---------- writing ----------

  async function cleanLine({ kind, id }, tid, call, pause) {
    const read = await A.withRetry(() => call('policy', kind, { id }), pause);
    if (!ok(read)) return A.refused(read);
    const plan = cleanPlan(kind, read.body);
    if (plan.action !== 'remove') return { status: plan.action, tags: plan.tags };
    const res = A.writeResult(await A.withRetry(() => call('patchTags', kind, { id, tid, body: plan.body }), pause));
    return { ...res, tags: res.status === 'done' ? plan.body.roleScopeTagIds : plan.tags };
  }

  // Strictly sequential. An expired session stops the series: the next lines say "not sent".
  async function runClean(items, tid, call, { pause, onProgress = () => {} }) {
    const out = [];
    let stopped = false;
    for (let i = 0; i < items.length; i++) {
      let res;
      if (stopped) res = { status: 'notSent' };
      else {
        if (i) await pause(PAUSE_MS);
        res = await cleanLine(items[i], tid, call, pause);
        stopped = !!res.expired;
      }
      out.push(res);
      onProgress(i, res);
    }
    return out;
  }

  const api = { KINDS: [...KINDS.keys()], DEFAULT, itemUrl, listUrl, kindsFor, tagsIn, stateOf, keepRow, cleanPlan, loadKind, resolveTags, cleanLine, runClean };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.ScopeCleanupLib = api; // always: a stray `module` global must not hide the lib from the page
})();
