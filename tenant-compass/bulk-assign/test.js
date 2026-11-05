// Run: node bulk-assign/test.js
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const A = require('../shared/assign-lib.js');
const B = require('./lib.js');

const G = '#microsoft.graph.';
const BASE = 'https://graph.microsoft.com/beta/deviceManagement/';

// ---------- closed tables ----------

for (const k of ['sc', 'dc', 'comp', 'admx', 'ps', 'sh', 'cattr']) assert.ok(A.assignable(k), k);
for (const k of ['rem', 'app', '__proto__', 'constructor', '', null, undefined]) assert.ok(!A.assignable(k), String(k)); // remediations need a schedule
assert.deepStrictEqual(['sc', 'dc', 'comp', 'admx', 'ps', 'sh', 'cattr'].map(A.supportsFilter), [true, true, true, true, false, false, false]); // Learn: filters ref-supported-workloads

assert.strictEqual(A.assignUrl('dc', 'a b'), BASE + 'deviceConfigurations/a%20b/assign');
assert.strictEqual(A.assignUrl('sh', 'x'), BASE + 'deviceShellScripts/x/assign');
assert.strictEqual(A.assignUrl('rem', 'x'), null);
assert.strictEqual(A.policyUrl('comp', 'x'), BASE + 'deviceCompliancePolicies/x');
assert.strictEqual(A.policyUrl('app', 'x'), null);
// The route that answers⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ 400 on shell scripts stays out: $expand everywhere except the catalog
assert.strictEqual(A.existingUrl('sc', 'x'), BASE + 'configurationPolicies/x/assignments');
for (const k of ['dc', 'comp', 'admx', 'ps', 'sh', 'cattr']) assert.ok(A.existingUrl(k, 'x').endsWith('/x?$expand=assignments'), k);

// Same plain reads as Assignment Lens, Intune-Toolkit and Learn: no $select on these lists
assert.strictEqual(A.FILTERS_URL, BASE + 'assignmentFilters');
assert.strictEqual(A.TAGS_URL, BASE + 'roleScopeTags');

// ---------- targets ----------

assert.deepStrictEqual(A.targetOf({ mode: 'group', groupId: 'g1' }), { '@odata.type': G + 'groupAssignmentTarget', groupId: 'g1' });
assert.deepStrictEqual(A.targetOf({ mode: 'allUsers' }), { '@odata.type': G + 'allLicensedUsersAssignmentTarget' });
assert.deepStrictEqual(A.targetOf({ mode: 'allDevices' }), { '@odata.type': G + 'allDevicesAssignmentTarget' });
assert.deepStrictEqual(A.targetOf({ mode: 'allDevices', filterId: 'f1', filterMode: 'exclude' }), { '@odata.type': G + 'allDevicesAssignmentTarget',
  deviceAndAppManagementAssignmentFilterId: 'f1', deviceAndAppManagementAssignmentFilterType: 'exclude' });
assert.strictEqual(A.targetOf({ mode: 'group', groupId: 'g1', filterId: 'f1' }).deviceAndAppManagementAssignmentFilterType, 'include');
assert.strictEqual(A.targetOf({ mode: 'none' }), null);
assert.strictEqual(A.targetOf({ mode: 'group' }), null); // no group chosen yet
assert.strictEqual(A.targetOf({ mode: 'other', groupId: 'g1' }), null);

// ---------- /assign replaces⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ everything: existing assignments are read, then sent back ----------

const groupOf = id => ({ '@odata.type': G + 'groupAssignmentTarget', groupId: id });
const excluded = { '@odata.type': G + 'exclusionGroupAssignmentTarget', groupId: 'g9' };
const filtered = { ...groupOf('g2'), deviceAndAppManagementAssignmentFilterId: 'f', deviceAndAppManagementAssignmentFilterType: 'include' };
const existing = [{ id: 'a1', source: 'direct', sourceId: 'x', target: filtered }, { id: 'a2', target: excluded }];

assert.deepStrictEqual(A.assignmentsIn('sc', { value: existing }), existing);
assert.deepStrictEqual(A.assignmentsIn('sh', { assignments: existing }), existing);
assert.deepStrictEqual(A.assignmentsIn('dc', { id: 'x' }), []); // no assignment yet: Graph may leave the property out
for (const partial of [{ value: existing, '@odata.nextLink': 'n' }, { value: 'x' }, null]) assert.strictEqual(A.assignmentsIn('sc', partial), null);
for (const partial of [{ assignments: existing, 'assignments@odata.nextLink': 'n' }, { assignments: 'x' }, null]) assert.strictEqual(A.assignmentsIn('dc', partial), null);

const merged = A.mergeTargets('dc', existing, groupOf('g1'));
assert.strictEqual(merged.already, false);
assert.deepStrictEqual(merged.body, { assignments: [{ target: filtered }, { target: excluded }, { target: groupOf('g1') }] }); // filter and exclusion kept as they are
assert.deepStrictEqual(Object.keys(A.mergeTargets('sh', [], groupOf('g1')).body), ['deviceManagementScriptAssignments']);
assert.deepStrictEqual(Object.keys(A.mergeTargets('sc', [], groupOf('g1')).body), ['assignments']);
assert.strictEqual(A.mergeTargets('dc', existing, groupOf('g2')).already, true); // same group, whatever the filter
assert.strictEqual(A.mergeTargets('dc', existing, groupOf('g9')).already, true); // excluded group: never turned into an inclusion
assert.strictEqual(A.mergeTargets('dc', [{ target: { '@odata.type': G + 'allUsersAssignmentTarget' } }], A.targetOf({ mode: 'allUsers' })).already, true);
assert.strictEqual(A.mergeTargets('dc', [{ target: { '@odata.type': G + 'allDevicesAssignmentTarget' } }], A.targetOf({ mode: 'allDevices' })).already, true);
// Policy set assignments belong to the policy set: sending them back would turn them into direct ones
assert.deepStrictEqual(A.mergeTargets('dc', [{ source: 'policySets', sourceId: 's', target: groupOf('g3') }], groupOf('g1')).body.assignments, [{ target: groupOf('g1') }]);
assert.deepStrictEqual(A.newAssignment('sh', groupOf('g1')), { deviceManagementScriptAssignments: [{ target: groupOf('g1') }] });

// ---------- scope tags: added, never removed ----------

assert.deepStrictEqual(A.tagsPatch('sh', { roleScopeTagIds: ['0'] }, ['5']), { changed: true, body: { roleScopeTagIds: ['0', '5'] } });
assert.deepStrictEqual(A.tagsPatch('sc', { roleScopeTagIds: ['0', '5'] }, ['5']), { changed: false, body: { roleScopeTagIds: ['0', '5'] } });
assert.deepStrictEqual(A.tagsPatch('dc', { '@odata.type': G + 'macOSCustomConfiguration', roleScopeTagIds: [] }, ['5']), { changed: true, body: { '@odata.type': G + 'macOSCustomConfiguration', roleScopeTagIds: ['5'] } }); // polymorphic: type required
assert.strictEqual(A.tagsPatch('comp', { '@odata.type': G + 'macOSCompliancePolicy' }, ['5']).body['@odata.type'], G + 'macOSCompliancePolicy');
assert.deepStrictEqual(A.tagsPatch('ps', {}, ['5']).body, { roleScopeTagIds: ['5'] });

// ---------- groups ----------

assert.strictEqual(A.groupsUrl('IT dep'), "https://graph.microsoft.com/beta/groups?$filter=startswith(displayName,'IT%20dep')&$select=id,displayName&$top=20");
assert.ok(A.groupsUrl("o'neil").includes("startswith(displayName,'o''neil')"));
assert.ok(!A.groupsUrl("x') or (1 eq 1").includes("x')")); // the quote stays inside the string
assert.strictEqual(A.groupsUrl('11111111-2222-3333-4444-555555555555'), 'https://graph.microsoft.com/beta/groups/11111111-2222-3333-4444-555555555555?$select=id,displayName');
assert.strictEqual(A.groupsUrl('   '), null);
assert.deepStrictEqual(A.groupsIn({ value: [{ id: 'a', displayName: 'A' }] }), [{ id: 'a', name: 'A' }]);
assert.deepStrictEqual(A.groupsIn({ id: 'b', displayName: 'B' }), [{ id: 'b', name: 'B' }]);
assert.deepStrictEqual(A.groupsIn(null), []);

// ---------- one line of the bulk run ----------

(async () => {
  const fake = script => {
    const calls = [];
    const call = async (op, kind, args) => { calls.push({ op, kind, args }); const q = script[op]; return (Array.isArray(q) ? q.shift() : q) || { status: 200, body: {} }; };
    return { calls, call };
  };
  const item = { kind: 'dc', id: 'p1', name: 'P' };
  const plan = { target: groupOf('g1'), tagIds: [], tid: 'T' };

  // Existing assignments are kept in what is sent
  let f = fake({ existing: { status: 200, body: { assignments: existing } }, assign: { status: 204 } });
  let r = await B.applyLine(item, plan, f.call);
  assert.strictEqual(r.assign.status, 'done');
  const sent = f.calls.find(c => c.op === 'assign');
  assert.deepStrictEqual(sent.args, { id: 'p1', tid: 'T', body: { assignments: [{ target: filtered }, { target: excluded }, { target: groupOf('g1') }] } });

  // Read refused or partial: nothing is sent, the existing assignments would be lost⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  f = fake({ existing: { status: 403, message: 'denied' } });
  r = await B.applyLine(item, plan, f.call);
  assert.deepStrictEqual([r.assign.status, r.assign.error], ['failed', 'denied']);
  assert.ok(!f.calls.some(c => c.op === 'assign'));
  f = fake({ existing: { status: 200, body: { assignments: [], 'assignments@odata.nextLink': 'n' } } });
  r = await B.applyLine(item, plan, f.call);
  assert.deepStrictEqual([r.assign.status, r.assign.error], ['failed', 'bulkAssign.err.partial']);
  assert.ok(!f.calls.some(c => c.op === 'assign'));
  f = fake({ existing: { status: 0 } });
  assert.strictEqual((await B.applyLine(item, plan, f.call)).assign.status, 'failed');
  assert.ok(!f.calls.some(c => c.op === 'assign'));

  // Already there: nothing is sent
  f = fake({ existing: { status: 200, body: { assignments: [{ target: groupOf('g1') }] } } });
  r = await B.applyLine(item, plan, f.call);
  assert.strictEqual(r.assign.status, 'already');
  assert.ok(!f.calls.some(c => c.op === 'assign'));

  // A filter on a script: skipped without any call. Dropping the filter would reach more devices than asked
  f = fake({});
  const withFilter = { ...plan, target: A.targetOf({ mode: 'group', groupId: 'g1', filterId: 'f1' }) };
  r = await B.applyLine({ kind: 'sh', id: 's1' }, withFilter, f.call);
  assert.deepStrictEqual([r.assign.status, r.assign.error], ['skipped', 'bulkAssign.err.noFilter']);
  assert.deepStrictEqual(f.calls, []);

  // Failures after the request left: unknown result; a refusal: failed
  f = fake({ existing: { status: 200, body: {} }, assign: { status: 500 } });
  assert.strictEqual((await B.applyLine(item, plan, f.call)).assign.status, 'unknown');
  f = fake({ existing: { status: 200, body: {} }, assign: { status: 400, message: 'bad' } });
  assert.deepStrictEqual((({ status, error }) => [status, error])((await B.applyLine(item, plan, f.call)).assign), ['failed', 'bad']);

  // Scope tags: read then added, no write when nothing changes
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['0'] } }, patchTags: { status: 200 } });
  r = await B.applyLine(item, { target: null, tagIds: ['5'], tid: 'T' }, f.call);
  assert.strictEqual(r.tags.status, 'done');
  assert.strictEqual(r.assign, null);
  assert.deepStrictEqual(f.calls.find(c => c.op === 'patchTags').args, { id: 'p1', tid: 'T', body: { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] } });
  f = fake({ policy: { status: 200, body: { roleScopeTagIds: ['5'] } } });
  assert.strictEqual((await B.applyLine(item, { target: null, tagIds: ['5'], tid: 'T' }, f.call)).tags.status, 'already');
  assert.ok(!f.calls.some(c => c.op === 'patchTags'));

  // ---------- the whole run ----------

  const items = [{ kind: 'dc', id: 'a', name: 'A' }, { kind: 'dc', id: 'b', name: 'B' }];
  const waits = [];
  const opts = { pause: async ms => { waits.push(ms); } };
  // 429 waits Retry-After, then goes on
  f = fake({ existing: [{ status: 429, retryAfter: 7 }, { status: 200, body: {} }, { status: 200, body: {} }], assign: [{ status: 204 }, { status: 204 }] });
  let out = await B.runBulk(items, plan, f.call, opts);
  assert.deepStrictEqual(out.map(x => x.assign.status), ['done', 'done']);
  assert.ok(waits.includes(7000));
  assert.ok(waits.includes(250));
  // 401 stops the series: the⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ next line is not sent
  f = fake({ existing: [{ status: 401 }, { status: 200, body: {} }] });
  out = await B.runBulk(items, plan, f.call, opts);
  assert.deepStrictEqual(out.map(x => x.assign.status), ['failed', 'notSent']);
  assert.strictEqual(out[0].assign.error, 'bulkAssign.err.expired');
  assert.strictEqual(f.calls.length, 1);
  // Progress after each line
  const seen = [];
  f = fake({ existing: { status: 200, body: {} }, assign: { status: 204 } });
  await B.runBulk(items, plan, f.call, { ...opts, onProgress: (i, res) => seen.push([i, res.assign.status]) });
  assert.deepStrictEqual(seen, [[0, 'done'], [1, 'done']]);

  // Only assignable types are listed, each from a closed URL
  assert.deepStrictEqual(B.KINDS, ['sc', 'dc', 'comp', 'admx', 'ps', 'sh', 'cattr']);
  assert.ok(B.listUrl('sh').startsWith(BASE + 'deviceShellScripts?$select='));
  assert.strictEqual(B.listUrl('sc'), BASE + 'configurationPolicies');
  assert.strictEqual(B.listUrl('rem'), null);

  // i18n: same keys in both languages, every key used by the code exists
  const dicts = {};
  globalThis.__tenantCompassI18n = { add: d => { for (const l of ['fr', 'en']) dicts[l] = { ...dicts[l], ...d[l] }; } };
  require('../shared/assign-i18n.js');
  require('./i18n.js');
  assert.deepStrictEqual(Object.keys(dicts.fr).sort(), Object.keys(dicts.en).sort());
  const read = f2 => fs.readFileSync(path.join(__dirname, '..', f2), 'utf8');
  for (const f2 of ['bulk-assign/lib.js', 'bulk-assign/page.js', 'shared/assign-form.js'])
    for (const k of new Set(read(f2).match(/(bulkAssign|assignForm)\.[a-zA-Z.]+/g) || [])) assert.ok(dicts.fr[k], `${f2}: missing ${k}`);

  // Opt-in: off by default in both copies of DEFAULTS, Intune console only
  for (const f2 of ['background.js', 'popup.js']) assert.match(read(f2), /const DEFAULTS = \{[^}]*bulkAssign: false/, f2);
  const registration = /bulkAssign: \[\{[\s\S]*?\}\],/.exec(read('background.js'))?.[0] || '';
  assert.match(registration, /'bulk-assign\/lib\.js', 'bulk-assign\/page\.js'\]/);
  assert.match(registration, /world: 'MAIN'/);
  assert.ok(!/portal\.azure\.com|entra\.microsoft\.com/.test(registration), 'Intune console only');
  for (const k of ['f.bulkAssign', 'f.bulkAssign.desc']) assert.strictEqual((read('shared/i18n.js').match(new RegExp(`'${k}':`, 'g')) || []).length, 2, k);

  // Static checks: the only assignment and scope tag writes, through window.fetch, no token leak
  const bridge = read('shared/graph-bridge.js');
  assert.strictEqual((bridge.match(/'POST'/g) || []).length, 1, 'one single POST: /assign');
  assert.strictEqual((bridge.match(/'PATCH'/g) || []).length, 1, 'one single PATCH: scope tags');
  assert.ok(!/'(PUT|DELETE)'|\$batch/.test(bridge));
  assert.ok(/window\.fetch\(/.test(bridge) && /credentials: 'omit'/.test(bridge) && /tenantCompassSilent: true/.test(bridge));
  assert.ok(!/id: m\.id, \.\.\./.test(bridge), 'an id in the response must not overwrite the correlation id of the relay');
  for (const f2 of ['shared/graph-bridge.js', 'shared/assign-form.js', 'bulk-assign/page.js', 'bulk-assign/lib.js', 'shared/assign-lib.js'])
    assert.ok(!/console\.|chrome\.storage|localStorage|innerHTML/.test(read(f2)), f2);
  assert.ok(!/method: '|window\.fetch/.test(read('bulk-assign/page.js')), 'Bulk Assignment writes only through the shared operations');

  console.log('bulk-assign: all checks passed');
})().catch(err => { console.error(err); process.exit(1); });
