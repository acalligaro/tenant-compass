// Pure helpers of Bulk Assignment: closed list of sources, one line of the run, the whole run. No DOM, no network.
// A line only adds: existing assignments and scope tags are read first and kept. When the read fails, nothing is⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ sent.
(() => {
  const A = globalThis.TenantCompassAssign || require('../shared/assign-lib.js');
  const GRAPH = 'https://graph.microsoft.com/beta/deviceManagement/', APPS = 'https://graph.microsoft.com/beta/deviceAppManagement/';
  const PAUSE_MS = 250;
  const FIELDS = '?$select=id,displayName,description,lastModifiedDateTime';

  // Same lists as As-Built, for the types /assign can take without more input.
  const SOURCES = new Map([
    ['sc', 'configurationPolicies'], ['dc', 'deviceConfigurations' + FIELDS], ['comp', 'deviceCompliancePolicies' + FIELDS], ['admx', 'groupPolicyConfigurations'],
    ['ps', 'deviceManagementScripts' + FIELDS], ['sh', 'deviceShellScripts' + FIELDS], ['cattr', 'deviceCustomAttributeShellScripts' + FIELDS], ['app', 'mobileApps' + FIELDS],
  ]);
  // rich: with the assignments and scope tags of each object, for the filters and the tooltip of the list.
  const listUrl = (kind, rich) => {
    if (!SOURCES.has(kind)) return null;
    const url = (kind === 'app' ? APPS : GRAPH) + SOURCES.get(kind);
    if (!rich) return url;
    return url.includes('?$select=') ? url + ',roleScopeTagIds&$expand=assignments' : url + '?$expand=assignments';
  };

  const ok = r => r.status >= 200 && r.status < 300;

  const { withRetry, refused, writeResult } = A;

  // ---------- the list: assignments and scope tags of each object ----------

  const G = '#microsoft.graph.', GROUPS = 'https://graph.microsoft.com/beta/groups';
  const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const GROUP_BATCH = 15; // values the `in` operator of a Graph filter takes

  // The list with assignments and scope tags, else the plain list: its objects then have no assignments to filter on.
  async function loadKind(kind, call) {
    const rich = await call('list', kind, { rich: true });
    if (ok(rich)) return { rows: rich.body?.value || [], rich: true };
    const r = await call('list', kind, {});
    return ok(r) ? { rows: r.body?.value || [], rich: false } : { rows: [], rich: false, error: r.message || `Graph ${r.status}` };
  }

  // Assignments of a list row read with $expand, null when the list did not bring them whole.
  const listedAssignments = raw => (Array.isArray(raw?.assignments) && !raw['assignments@odata.nextLink'] ? raw.assignments : null);
  const tagsOf = raw => (Array.isArray(raw?.roleScopeTagIds) ? raw.roleScopeTagIds.map(String) : null);

  // What an assignment targets: a group ID (included or excluded), 'allUsers' or 'allDevices'. null: another kind of target.
  function targetRef(t) {
    const type = String(t?.['@odata.type'] || '');
    if (type === G + 'groupAssignmentTarget' || type === G + 'exclusionGroupAssignmentTarget') return t.groupId || null;
    if (/^#microsoft\.graph\.all(Licensed)?UsersAssignmentTarget$/.test(type)) return 'allUsers';
    return type === G + 'allDevicesAssignmentTarget' ? 'allDevices' : null;
  }
  const isExclusion = t => t?.['@odata.type'] === G + 'exclusionGroupAssignmentTarget';
  const filterOf = t => t?.deviceAndAppManagementAssignmentFilterId || '';

  // The three filters of the list, '' = any. Group and filter: the same assignment must hold both.
  // Assignments not read never match a group or a filter.
  function matches(item, { group = '', filter = '', tag = '' } = {}) {
    if (tag && !(item.tags || []).includes(tag)) return false;
    if (!group && !filter) return true;
    return (item.assignments || []).some(a => (!group || targetRef(a?.target) === group) && (!filter || filterOf(a?.target) === filter));
  }

  // Choices offered by the three filters: what the rows hold.
  function facets(items) {
    const groups = new Set(), filters = new Set(), tags = new Set();
    for (const i of items) {
      for (const a of i.assignments || []) {
        const ref = targetRef(a?.target), f = filterOf(a?.target);
        if (ref) groups.add(ref);
        if (f) filters.add(f);
      }
      for (const t of i.tags || []) tags.add(t);
    }
    return { groups: [...groups], filters: [...filters], tags: [...tags] };
  }

  // Closed URL: only group IDs reach it, at most GROUP_BATCH.
  function groupNamesUrl(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(id => GUID.test(id)).slice(0, GROUP_BATCH);
    return list.length ? `${GROUPS}?$filter=${encodeURIComponent(`id in (${list.map(id => `'${id}'`).join(',')})`)}&$select=id,displayName` : null;
  }

  // Names of the groups, by batches. A batch that fails leaves its IDs shown as IDs.
  // ponytail: sequential batches, a few seconds on a tenant with hundreds of assigned groups; run them in parallel if it shows.
  async function groupNames(ids, call) {
    const names = new Map(), list = [...new Set(ids)].filter(id => GUID.test(id));
    for (let i = 0; i < list.length; i += GROUP_BATCH) {
      const r = await call('groupNames', 'meta', { ids: list.slice(i, i + GROUP_BATCH) });
      if (ok(r)) for (const g of r.body?.value || []) names.set(g.id, g.displayName);
    }
    return names;
  }

  // The row after its line ran: what was just applied, so the filters and the tooltip stay true without reading again.
  function afterRun(item, { target, intent, tagIds }, res) {
    const out = {};
    if (res?.assign?.status === 'done' && item.assignments) out.assignments = [...item.assignments, { target, ...(item.kind === 'app' ? { intent } : {}) }];
    if (res?.tags?.status === 'done') out.tags = [...new Set([...(item.tags || []), ...tagIds])];
    return out;
  }

  async function assignLine({ kind, id }, target, intent, tid, call, pause) {
    if (A.hasFilter(target) && !A.supportsFilter(kind)) return { status: 'skipped', error: 'bulkAssign.err.noFilter' }; // without its filter, it would reach more devices than asked
    if (kind === 'app' && !intent) return { status: 'skipped', error: 'bulkAssign.err.noIntent' };
    const read = await withRetry(() => call('existing', kind, { id }), pause);
    if (!ok(read)) return refused(read);
    const list = A.assignmentsIn(kind, read.body);
    if (!list) return { status: 'failed', error: 'bulkAssign.err.partial' };
    const refusal = kind === 'app' ? A.appRefusal(read.body, intent, target) : null;
    if (refusal) return { status: 'skipped', error: refusal };
    const merged = A.mergeTargets(kind, list, target, kind === 'app' ? { intent, settings: A.appSettings(read.body?.['@odata.type']) } : {});
    if (merged.already) return { status: 'already' };
    if (merged.conflict) return { status: 'skipped', error: merged.conflict === 'groupPresent' ? 'bulkAssign.err.groupPresent' : 'bulkAssign.err.builtInPresent' };
    return writeResult(await withRetry(() => call('assign', kind, { id, tid, body: merged.body }), pause));
  }

  async function tagsLine({ kind, id }, tagIds, tid, call, pause) {
    const read = await withRetry(() => call('policy', kind, { id }), pause);
    if (!ok(read)) return refused(read);
    const patch = A.tagsPatch(kind, read.body, tagIds);
    if (!patch.changed) return { status: 'already' };
    return writeResult(await withRetry(() => call('patchTags', kind, { id, tid, body: patch.body }), pause));
  }

  // plan: { target|null, tagIds, tid }. Result: { assign, tags }, each null when not asked.
  async function applyLine(item, { target, intent, tagIds, tid }, call, pause) {
    const out = { assign: null, tags: null };
    if (target) out.assign = await assignLine(item, target, intent, tid, call, pause);
    if (tagIds?.length && !out.assign?.expired) out.tags = await tagsLine(item, tagIds, tid, call, pause);
    return out;
  }

  // Strictly sequential. An expired session stops⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ the series: the next lines say "not sent".
  async function runBulk(items, plan, call, { pause, onProgress = () => {} }) {
    const out = [];
    let stopped = false;
    for (let i = 0; i < items.length; i++) {
      let res;
      if (stopped) res = { assign: plan.target ? { status: 'notSent' } : null, tags: plan.tagIds?.length ? { status: 'notSent' } : null };
      else {
        if (i) await pause(PAUSE_MS);
        res = await applyLine(items[i], plan, call, pause);
        stopped = !!(res.assign?.expired || res.tags?.expired);
      }
      out.push(res);
      onProgress(i, res);
    }
    return out;
  }

  const api = { KINDS: [...SOURCES.keys()], listUrl, loadKind, listedAssignments, tagsOf, targetRef, isExclusion, filterOf, matches, facets, groupNamesUrl, groupNames, afterRun, applyLine, runBulk };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.BulkAssignLib = api; // always: a stray `module` global must not hide the lib from the page
})();
