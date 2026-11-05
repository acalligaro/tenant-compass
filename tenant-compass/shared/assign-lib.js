// Pure helpers shared by Policy Import and Bulk Assignment: targets, assignment bodies, scope tags. No DOM, no network.
// Graph's /assign action replaces every assignment of the object: anything sent here must already hold the existing ones.
(() => {
  const ROOT = 'https://graph.microsoft.com/beta/';
  const GRAPH = ROOT + 'deviceManagement/';
  const G = '#microsoft.graph.';

  // Closed table: the URL of a write comes from here, never from a file or a message.
  // key: parameter of the /assign action (Graph metadata). typed: polymorphic resource, PATCH needs its @odata.type.
  // filter: Learn lists PowerShell and shell scripts among the workloads without assignment filters.
  const KINDS = new Map([
    ['sc', { path: 'configurationPolicies', key: 'assignments', filter: true, typed: false, sub: true }],
    ['dc', { path: 'deviceConfigurations', key: 'assignments', filter: true, typed: true }],
    ['comp', { path: 'deviceCompliancePolicies', key: 'assignments', filter: true, typed: true }],
    ['admx', { path: 'groupPolicyConfigurations', key: 'assignments', filter: true, typed: false }],
    ['ps', { path: 'deviceManagementScripts', key: 'deviceManagementScriptAssignments', filter: false, typed: false }],
    ['sh', { path: 'deviceShellScripts', key: 'deviceManagementScriptAssignments', filter: false, typed: false }],
    ['cattr', { path: 'deviceCustomAttributeShellScripts', key: 'deviceManagementScriptAssignments', filter: false, typed: false }],
    ['app', { root: ROOT + 'deviceAppManagement/', path: 'mobileApps', key: 'mobileAppAssignments', filter: true, typed: true }],
  ]);

  const assignable = kind => KINDS.has(kind);
  const supportsFilter = kind => !!KINDS.get(kind)?.filter;
  const policyUrl = (kind, id) => (KINDS.has(kind) ? `${KINDS.get(kind).root || GRAPH}${KINDS.get(kind).path}/${encodeURIComponent(id)}` : null);
  const assignUrl = (kind, id) => (KINDS.has(kind) ? `${policyUrl(kind, id)}/assign` : null);
  // $expand everywhere but the catalog: /assignments⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ answers 400 on shell scripts (seen on a real tenant, 2026-11-05).
  const existingUrl = (kind, id) => (KINDS.has(kind) ? policyUrl(kind, id) + (KINDS.get(kind).sub ? '/assignments' : '?$expand=assignments') : null);

  const TARGET_TYPES = { group: 'groupAssignmentTarget', allUsers: 'allLicensedUsersAssignmentTarget', allDevices: 'allDevicesAssignmentTarget' };

  // { mode, groupId, filterId, filterMode } -> Graph target, null while the choice is incomplete.
  function targetOf({ mode, groupId, filterId, filterMode }) {
    if (!Object.hasOwn(TARGET_TYPES, mode) || (mode === 'group' && !groupId)) return null;
    return {
      '@odata.type': G + TARGET_TYPES[mode],
      ...(mode === 'group' ? { groupId } : {}),
      ...(filterId ? { deviceAndAppManagementAssignmentFilterId: filterId, deviceAndAppManagementAssignmentFilterType: filterMode === 'exclude' ? 'exclude' : 'include' } : {}),
    };
  }

  const hasFilter = target => !!target?.deviceAndAppManagementAssignmentFilterId;

  // Assignments of a read, null when the answer is not the whole list: merging a partial list would delete the rest.
  function assignmentsIn(kind, body) {
    if (!body || typeof body !== 'object') return null;
    if (KINDS.get(kind)?.sub) return Array.isArray(body.value) && !body['@odata.nextLink'] ? body.value : null;
    if (body['assignments@odata.nextLink']) return null;
    if (body.assignments === undefined) return [];
    return Array.isArray(body.assignments) ? body.assignments : null;
  }

  // Same group (included or excluded), or same built-in target.
  const targetKey = t => t?.groupId || String(t?.['@odata.type'] || '').replace(/allLicensedUsers|allUsers/, 'allUsers');

  // Body of /assign for existing + target. Assignments from a policy set stay out: sending them would make them direct.
  // An app assignment also carries its deployment type and settings: they go back as they are. extra: those of the new one.
  function mergeTargets(kind, existing, target, extra = {}) {
    const direct = existing.filter(a => !a?.source || a.source === 'direct');
    if (existing.some(a => targetKey(a?.target) === targetKey(target))) return { already: true, body: null };
    if (isBuiltIn(target) && existing.some(a => isGroup(a?.target))) return { already: false, conflict: 'groupPresent', body: null };
    if (isGroup(target) && existing.some(a => isBuiltIn(a?.target))) return { already: false, conflict: 'builtInPresent', body: null };
    const item = kind === 'app'
      ? (t, a) => ({ '@odata.type': G + 'mobileAppAssignment', intent: a.intent, settings: a.settings ?? null, target: t })
      : t => ({ target: t });
    return { already: false, body: { [KINDS.get(kind).key]: [...direct.map(a => item(a.target, a)), item(target, extra)] } };
  }

  // A group and a built-in target never go together. An excluded group does not count: "All devices except this group" is a usual setup.
  function isGroup(t) { return t?.['@odata.type'] === G + 'groupAssignmentTarget'; }
  function isBuiltIn(t) { return /^#microsoft\.graph\.all(Devices|LicensedUsers|Users)AssignmentTarget$/.test(t?.['@odata.type'] || ''); }

  const newAssignment = (kind, target) => ({ [KINDS.get(kind).key]: [{ target }] });

  // Scope tags are added, never removed.
  function tagsPatch(kind, policy, tagIds) {
    const current = Array.isArray(policy?.roleScopeTagIds) ? policy.roleScopeTagIds : [];
    const roleScopeTagIds = [...new Set([...current, ...tagIds])];
    return {
      changed: roleScopeTagIds.length !== current.length,
      body: { ...(KINDS.get(kind)?.typed ? { '@odata.type': policy?.['@odata.type'] } : {}), roleScopeTagIds },
    };
  }

  // Search⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ by start of name, or direct read when an ID is pasted (works even if the token cannot list groups).
  function groupsUrl(text) {
    const q = String(text ?? '').trim();
    if (!q) return null;
    if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(q)) return `${ROOT}groups/${q}?$select=id,displayName`;
    return `${ROOT}groups?$filter=startswith(displayName,'${encodeURIComponent(q.replace(/'/g, "''")).replace(/%27/g, "'")}')&$select=id,displayName&$top=20`;
  }

  function groupsIn(body) {
    const list = Array.isArray(body?.value) ? body.value : body?.id ? [body] : [];
    return list.map(g => ({ id: g.id, name: g.displayName }));
  }

  // ---------- applications ----------

  // Settings of a new assignment. Managed Google Play has its own, with the default update mode. Others: Graph's default.
  function appSettings(type) {
    return /^#microsoft\.graph\.androidManagedStore(Web)?App$/.test(type || '')
      ? { '@odata.type': G + 'androidManagedStoreAppAssignmentSettings', androidManagedStoreAppTrackIds: [], autoUpdateMode: 'default' }
      : null;
  }

  // Deployment types an app takes: without enrollment on Android and iOS only, Required or Uninstall on an Android Enterprise system app.
  function appIntents(type, isSystemApp) {
    if (isSystemApp) return ['required', 'uninstall'];
    return /^#microsoft\.graph\.(android|managedAndroid|ios|managedIOS)/i.test(type || '')
      ? ['required', 'available', 'availableWithoutEnrollment', 'uninstall']
      : ['required', 'available', 'uninstall'];
  }

  // Why this deployment type cannot go on this app and target, null when it can. Learn: Available is for user groups,
  // except Win32 and Android fully managed or corporate-owned. Graph has the last word on the type of a group.
  function appRefusal(policy, intent, target) {
    const type = policy?.['@odata.type'];
    if (!appIntents(type, policy?.isSystemApp).includes(intent)) return 'bulkAssign.err.noIntent';
    if (target?.['@odata.type'] !== G + 'allDevicesAssignmentTarget') return null;
    if (intent === 'availableWithoutEnrollment') return 'bulkAssign.err.intentDevices';
    return intent === 'available' && !/^#microsoft\.graph\.(win32|android|managedAndroid)/i.test(type || '') ? 'bulkAssign.err.intentDevices' : null;
  }

  // ---------- retry rules of the writing features ----------

  const ok = r => r.status >= 200 && r.status < 300;
  const MAX_RETRIES = 2, DEFAULT_WAIT_S = 10;

  // Only 429 is retried. pause is optional: a single line in a test does not wait.
  async function withRetry(fn, pause) {
    for (let tries = 0; ; tries++) {
      let r;
      try { r = await fn(); } catch { r = { status: 0 }; }
      if (r.status !== 429 || tries === MAX_RETRIES || !pause) return r;
      await pause(1000 * (r.retryAfter > 0 ? r.retryAfter : DEFAULT_WAIT_S));
    }
  }

  const refused = r => (r.status === 401
    ? { status: 'failed', error: 'assignForm.err.expired', expired: true }
    : { status: 'failed', error: r.message || (r.status ? `Graph ${r.status}` : 'assignForm.err.network') });

  // After a write left: 5xx or a network failure may hide a success.
  const writeResult = r => (ok(r) ? { status: 'done' } : !r.status || r.status >= 500 ? { status: 'unknown' } : refused(r));

  const api = { appSettings, appIntents, appRefusal, withRetry, refused, writeResult, KINDS: [...KINDS.keys()], TAGS_URL: `${GRAPH}roleScopeTags`, FILTERS_URL: `${GRAPH}assignmentFilters`,
    assignable, supportsFilter, policyUrl, assignUrl, existingUrl, targetOf, hasFilter, assignmentsIn, mergeTargets, newAssignment, tagsPatch, groupsUrl, groupsIn };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.TenantCompassAssign = api; // always: a stray `module` global must not hide the lib from the page
})();
