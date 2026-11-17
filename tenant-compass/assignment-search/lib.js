// Pure helpers of Assignment Search: closed tables of Graph URLs, search results, membership matching, JSON export.
// No DOM, no network. Every URL the page reads comes from here: messages between frames carry names and IDs, never a URL.
(() => {
  const ROOT = 'https://graph.microsoft.com/beta/';
  const DM = ROOT + 'deviceManagement/', DAM = ROOT + 'deviceAppManagement/';
  const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const ZERO = /^0{8}-(0{4}-){3}0{12}$/;
  const G = '#microsoft.graph.';
  const FIELDS = '$select=id,displayName,description,lastModifiedDateTime';

  // Every object type read, with its assignments in the same call ($expand). Keys of As-Built when it lists the type too
  // (labels, platforms). Apps: all of them, isAssigned is not used (Graph can leave it stale), so unassigned apps show too.
  const SOURCES = new Map([
    ['sc', DM + 'configurationPolicies?$expand=assignments'],
    ['dc', DM + `deviceConfigurations?${FIELDS}&$expand=assignments`],
    ['comp', DM + `deviceCompliancePolicies?${FIELDS}&$expand=assignments`],
    ['admx', DM + 'groupPolicyConfigurations?$expand=assignments'],
    ['app', DAM + `mobileApps?${FIELDS}&$expand=assignments`],
    ['appcfg', DAM + 'mobileAppConfigurations?$expand=assignments'],
    ['mamcfg', DAM + 'targetedManagedAppConfigurations?$expand=assignments'],
    ['mamIos', DAM + 'iosManagedAppProtections?$expand=assignments'],
    ['mamAndroid', DAM + 'androidManagedAppProtections?$expand=assignments'],
    ['mamWin', DAM + 'windowsManagedAppProtections?$expand=assignments'],
    ['ps', DM + `deviceManagementScripts?${FIELDS}&$expand=assignments`],
    ['sh', DM + `deviceShellScripts?${FIELDS}&$expand=assignments`],
    ['cattr', DM + `deviceCustomAttributeShellScripts?${FIELDS}&$expand=assignments`],
    ['rem', DM + `deviceHealthScripts?${FIELDS}&$expand=assignments`],
    ['ap', DM + 'windowsAutopilotDeploymentProfiles?$expand=assignments'],
    ['enr', DM + 'deviceEnrollmentConfigurations?$expand=assignments'],
    ['wufu', DM + 'windowsFeatureUpdateProfiles?$expand=assignments'],
    ['wuq', DM + 'windowsQualityUpdateProfiles?$expand=assignments'],
    ['wud', DM + 'windowsDriverUpdateProfiles?$expand=assignments'],
  ]);
  const listUrl = kind => (SOURCES.has(kind) ? SOURCES.get(kind) : null);

  // Broad categories of the result filter, few on purpose: enrollment, Autopilot and Windows updates count as
  // configuration; app configuration and app protection as applications.
  const CATEGORIES = ['config', 'compliance', 'apps', 'scripts'];
  const CATEGORY = new Map(Object.entries({ sc: 'config', dc: 'config', admx: 'config', ap: 'config', enr: 'config', wufu: 'config', wuq: 'config', wud: 'config',
    comp: 'compliance', app: 'apps', appcfg: 'apps', mamcfg: 'apps', mamIos: 'apps', mamAndroid: 'apps', mamWin: 'apps',
    ps: 'scripts', sh: 'scripts', cattr: 'scripts', rem: 'scripts' }));
  const categoryOf = kind => CATEGORY.get(kind) || null;
  const FILTERS_URL = DM + 'assignmentFilters?$select=id,displayName,platform';

  // ---------- the object searched: group, user or⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ managed device ----------

  const TYPES = ['group', 'user', 'device'];
  const LIMIT = 100;
  // Value⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ of a filter string: quotes doubled (OData), then URL-encoded.
  const lit = q => encodeURIComponent(q.replace(/'/g, "''"));
  const SEARCH = {
    group: { path: 'groups', select: 'id,displayName', order: 'displayName', filter: q => `startswith(displayName,'${lit(q)}')` },
    user: { path: 'users', select: 'id,displayName,userPrincipalName', order: 'displayName',
      filter: q => `startswith(displayName,'${lit(q)}') or startswith(userPrincipalName,'${lit(q)}')` },
    // Learn: deviceName takes eq and contains. No $orderby: the page sorts.
    device: { path: 'deviceManagement/managedDevices', select: 'id,deviceName,azureADDeviceId,operatingSystem,userPrincipalName', filter: q => `contains(deviceName,'${lit(q)}')` },
  };

  // First objects by name when the text is empty, a direct read when an ID is pasted, else a search on the start of
  // the name (contains for a device). A filter and an $orderby together need advanced queries: the page sorts instead.
  function searchUrl(type, text) {
    const s = TYPES.includes(type) ? SEARCH[type] : null;
    if (!s) return null;
    const q = String(text ?? '').trim();
    if (GUID.test(q)) return `${ROOT}${s.path}/${q}?$select=${s.select}`;
    if (!q) return `${ROOT}${s.path}?$select=${s.select}${s.order ? `&$orderby=${s.order}` : ''}&$top=${LIMIT}`;
    return `${ROOT}${s.path}?$filter=${s.filter(q)}&$select=${s.select}&$top=${LIMIT}`;
  }

  // Answer of a search: list or single object, as { id, name, detail, entraId } sorted by name.
  function found(type, body) {
    const list = Array.isArray(body?.value) ? body.value : body?.id ? [body] : [];
    return list.map(o => type === 'device'
      ? { id: o.id, name: o.deviceName || o.id, detail: [o.operatingSystem, o.userPrincipalName].filter(Boolean).join(' · '),
        entraId: GUID.test(o.azureADDeviceId || '') && !ZERO.test(o.azureADDeviceId) ? o.azureADDeviceId : '' }
      : { id: o.id, name: o.displayName || o.id, detail: type === 'user' ? o.userPrincipalName || '' : '' })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  }

  // Groups the object belongs to, nested ones included. A group: its parent groups. A device: through its Entra object
  // (deviceId = azureADDeviceId of the managed device). null when there is nothing to read.
  function memberOfUrl(type, subject) {
    const tail = '/transitiveMemberOf/microsoft.graph.group?$select=id,displayName';
    if ((type === 'group' || type === 'user') && GUID.test(subject?.id || '')) return `${ROOT}${type}s/${subject.id}${tail}`;
    if (type === 'device' && GUID.test(subject?.entraId || '')) return `${ROOT}devices(deviceId='${subject.entraId}')${tail}`;
    return null;
  }

  // Object open in the portal, read from the blade URL: managed device (managedDeviceId in ManagedDeviceMenu, mdmDeviceId
  // in older blades), user (userId) or group (groupId).
  // ponytail: device before user before group when a URL names several; the #view URLs seen so far name one blade only.
  const PAGE = [['device', '(?:managed|mdm)DeviceId'], ['user', 'userId'], ['group', 'groupId']]
    .map(([type, key]) => [type, new RegExp(`/${key}/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=[/?]|$)`, 'i')]);
  function pageRef(hash) {
    let h = String(hash || '');
    try { h = decodeURIComponent(h); } catch {}
    for (const [type, re] of PAGE) { const m = re.exec(h); if (m) return { type, id: m[1].toLowerCase() }; }
    return null;
  }

  // ---------- what reaches the object ----------

  // What an assignment targets: a group ID, 'allUsers' or 'allDevices'. null: another kind of target.
  // Same rule as bulk-assign/lib.js, kept here so a read-only feature does not load the writing libraries.
  function targetRef(t) {
    const type = String(t?.['@odata.type'] || '');
    if (type === G + 'groupAssignmentTarget' || type === G + 'exclusionGroupAssignmentTarget') return t.groupId || null;
    if (/^#microsoft\.graph\.all(Licensed)?UsersAssignmentTarget$/.test(type)) return 'allUsers';
    return type === G + 'allDevicesAssignmentTarget' ? 'allDevices' : null;
  }

  // Assignments of a list row read with $expand, null when the list did not bring them whole.
  const assignmentsOf = raw => (Array.isArray(raw?.assignments) && !raw['assignments@odata.nextLink'] ? raw.assignments : null);

  // items: [{ assignments: [...] | null, ... }]. memberships: [{ id }] (parent groups for a group).
  // Each row lists the matching assignments (via). Exclusion wins: one matching exclusion makes the row "excluded".
  // All users reaches a user, All devices a device; a group gets neither, only what targets it or its parents.
  function resolve(type, subject, memberships, items) {
    const mine = new Set((memberships || []).map(g => String(g.id).toLowerCase()));
    const self = String(subject?.id || '').toLowerCase();
    const rows = [];
    let unread = 0;
    for (const item of items || []) {
      if (!item.assignments) { unread++; continue; }
      const via = [];
      for (const a of item.assignments) {
        const ref = targetRef(a?.target);
        if (!ref) continue;
        const id = ref.toLowerCase();
        const how = ref === 'allUsers' ? (type === 'user' ? 'allUsers' : null)
          : ref === 'allDevices' ? (type === 'device' ? 'allDevices' : null)
            : type === 'group' && id === self ? 'direct'
              : mine.has(id) ? (type === 'group' ? 'parent' : 'group') : null;
        if (!how) continue;
        const t = a.target, filterId = t.deviceAndAppManagementAssignmentFilterId;
        via.push({ how, ref, mode: t['@odata.type'] === G + 'exclusionGroupAssignmentTarget' ? 'exclude' : 'include',
          ...(a.intent ? { intent: a.intent } : {}),
          ...(filterId && !ZERO.test(filterId) && t.deviceAndAppManagementAssignmentFilterType !== 'none'
            ? { filterId, filterMode: t.deviceAndAppManagementAssignmentFilterType } : {}) });
      }
      if (via.length) rows.push({ ...item, state: via.some(v => v.mode === 'exclude') ? 'excluded' : 'included', via });
    }
    return { rows, unread };
  }

  // Objects read whole with no assignment at all. Those whose assignments were not read whole are left out.
  const unassigned = items => (items || []).filter(i => Array.isArray(i.assignments) && !i.assignments.length);

  // ---------- JSON export ----------

  // names: { group(id), filter(id) } -> display name. Rows of resolve()⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ or unassigned(), already labelled by the page.
  // category: the result filter chosen, when not "all" (rows are then already filtered by the page).
  function exportDoc({ type, subject, memberships, rows, tenantId, exportedAt, coverage, category }, names) {
    const target = ref => (ref === 'allUsers' || ref === 'allDevices' ? ref : { id: ref, name: names.group(ref) || ref });
    return {
      exportedAt, tenantId, type, ...(category ? { category } : {}),
      ...(subject ? { subject: { id: subject.id, name: subject.name, ...(subject.detail ? { detail: subject.detail } : {}),
        ...(subject.entraId ? { entraDeviceId: subject.entraId } : {}) } } : {}),
      ...(memberships ? { memberships: memberships.map(g => ({ id: g.id, name: g.displayName || g.name || g.id })) } : {}),
      coverage,
      results: rows.map(r => ({
        name: r.name, id: r.id, kind: r.kind, type: r.type, platform: r.platform || '',
        ...(r.state ? { state: r.state } : {}),
        ...(r.via ? { via: r.via.map(v => ({ how: v.how, target: target(v.ref), mode: v.mode,
          ...(v.intent ? { intent: v.intent } : {}),
          ...(v.filterId ? { filter: { id: v.filterId, name: names.filter(v.filterId) || v.filterId, mode: v.filterMode } } : {}) })) } : {}),
      })),
    };
  }

  // assignment-search-<type>[-<name>]-<yyyy-mm-dd>.json, characters forbidden in file names replaced.
  function exportName(type, name, date) {
    const safe = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f\s]+/g, '_').slice(0, 80);
    return ['assignment-search', type, safe, date].filter(Boolean).join('-') + '.json';
  }

  const api = { KINDS: [...SOURCES.keys()], CATEGORIES, categoryOf, TYPES, LIMIT, FILTERS_URL, listUrl, searchUrl, found, memberOfUrl, pageRef, targetRef, assignmentsOf, resolve, unassigned, exportDoc, exportName };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.AssignmentSearchLib = api; // always: a stray `module` global must not hide the lib from the page
})();
