// Run: node assignment-search/test.js
const assert = require('node:assert');
const L = require('./lib.js');

const ROOT = 'https://graph.microsoft.com/beta/';
const G = '#microsoft.graph.';
const ID = '11111111-2222-3333-4444-555555555555', PARENT = '22222222-2222-3333-4444-555555555555', OTHER = '33333333-2222-3333-4444-555555555555';
const FILTER = '44444444-2222-3333-4444-555555555555';

// ---------- closed tables ----------

assert.ok(L.KINDS.includes('sc') && L.KINDS.includes('app') && L.KINDS.includes('mamIos'));
for (const k of L.KINDS) assert.match(L.listUrl(k), /^https:\/\/graph\.microsoft\.com\/beta\/device(App)?Management\/[A-Za-z]+\?.*\$expand=assignments/, k);
for (const k of ['', 'ca', '__proto__', 'constructor', null, undefined]) assert.strictEqual(L.listUrl(k), null, String(k));
assert.ok(!L.listUrl('app').includes('isAssigned')); // unassigned apps must show too

// ---------- search ----------

assert.strictEqual(L.searchUrl('group', ''), ROOT + 'groups?$select=id,displayName&$orderby=displayName&$top=100');
assert.strictEqual(L.searchUrl('group', '  Sales '), ROOT + "groups?$filter=startswith(displayName,'Sales')&$select=id,displayName&$top=100");
assert.strictEqual(L.searchUrl('group', ID), ROOT + `groups/${ID}?$select=id,displayName`);
assert.strictEqual(L.searchUrl('user', "O'Neil"), ROOT + "users?$filter=startswith(displayName,'O''Neil') or startswith(userPrincipalName,'O''Neil')&$select=id,displayName,userPrincipalName&$top=100");
assert.strictEqual(L.searchUrl('device', 'PC&01'), ROOT + "deviceManagement/managedDevices?$filter=contains(deviceName,'PC%2601')&$select=id,deviceName,azureADDeviceId,operatingSystem,userPrincipalName&$top=100");
assert.ok(!L.searchUrl('device', '').includes('$orderby')); // managedDevices: sorted by the page
// A quote cannot close the string: doubled, the rest URL-encoded.
assert.strictEqual(L.searchUrl('group', "a'),x eq ('"), ROOT + "groups?$filter=startswith(displayName,'a'')%2Cx%20eq%20(''')&$select=id,displayName&$top=100");
for (const t of ['', 'policy', '__proto__', null]) assert.strictEqual(L.searchUrl(t, 'x'), null, String(t));

assert.deepStrictEqual(L.found('group', { value: [{ id: 'b', displayName: 'Zeta' }, { id: 'a', displayName: 'alpha' }] }).map(g => g.name), ['alpha', 'Zeta']);
assert.deepStrictEqual(L.found('user', { id: ID, displayName: 'Ann', userPrincipalName: 'ann@contoso.com' }), [{ id: ID, name: 'Ann', detail: 'ann@contoso.com' }]);
assert.deepStrictEqual(L.found('device', { value: [{ id: 'm1', deviceName: 'PC1', operatingSystem: 'Windows', userPrincipalName: 'ann@contoso.com', azureADDeviceId: ID }] }),
  [{ id: 'm1', name: 'PC1', detail: 'Windows · ann@contoso.com', entraId: ID }]);
assert.strictEqual(L.found('device', { value: [{ id: 'm2', deviceName: 'PC2', azureADDeviceId: '00000000-0000-0000-0000-000000000000' }] })[0].entraId, '');
assert.deepStrictEqual(L.found('group', null), []);

// ---------- memberships ----------

const TAIL = '/transitiveMemberOf/microsoft.graph.group?$select=id,displayName';
assert.strictEqual(L.memberOfUrl('group', { id: ID }), `${ROOT}groups/${ID}${TAIL}`);
assert.strictEqual(L.memberOfUrl('user', { id: ID }), `${ROOT}users/${ID}${TAIL}`);
assert.strictEqual(L.memberOfUrl('device', { id: 'm1', entraId: ID }), `${ROOT}devices(deviceId='${ID}')${TAIL}`);
assert.strictEqual(L.memberOfUrl('device', { id: 'm1', entraId: '' }), null);
assert.strictEqual(L.memberOfUrl('user', { id: '../me' }), null);
assert.strictEqual(L.memberOfUrl('policy', { id: ID }), null);

// ---------- resolve ----------⁣​​‌​‌​​​​​​‌​​‌​‍​⁣

const grp = (id, extra = {}) => ({ target: { '@odata.type': G + 'groupAssignmentTarget', groupId: id, ...extra } });
const excl = id => ({ target: { '@odata.type': G + 'exclusionGroupAssignmentTarget', groupId: id } });
const allUsers = { target: { '@odata.type': G + 'allLicensedUsersAssignmentTarget' } };
const allDevices = { target: { '@odata.type': G + 'allDevicesAssignmentTarget' } };
const items = [
  { key: 'a', name: 'Direct', assignments: [grp(ID, { deviceAndAppManagementAssignmentFilterId: FILTER, deviceAndAppManagementAssignmentFilterType: 'include' })] },
  { key: 'b', name: 'Parent', assignments: [grp(PARENT)] },
  { key: 'c', name: 'Excluded', assignments: [allUsers, excl(ID)] },
  { key: 'd', name: 'Other', assignments: [grp(OTHER)] },
  { key: 'e', name: 'Everyone', assignments: [allUsers] },
  { key: 'f', name: 'Devices', assignments: [allDevices] },
  { key: 'g', name: 'App', assignments: [{ intent: 'required', ...grp(ID) }, { intent: 'available', ...grp(PARENT) }] },
  { key: 'h', name: 'Unread', assignments: null },
  { key: 'i', name: 'None', assignments: [] },
  { key: 'j', name: 'Filter none', assignments: [grp(ID, { deviceAndAppManagementAssignmentFilterId: '00000000-0000-0000-0000-000000000000', deviceAndAppManagementAssignmentFilterType: 'none' })] },
];

// A group: what targets it or its parents. Never All users /⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ All devices.
let r = L.resolve('group', { id: ID.toUpperCase() }, [{ id: PARENT }], items);
assert.deepStrictEqual(r.rows.map(x => x.key), ['a', 'b', 'c', 'g', 'j']);
assert.strictEqual(r.unread, 1);
assert.deepStrictEqual(r.rows[0].via, [{ how: 'direct', ref: ID, mode: 'include', filterId: FILTER, filterMode: 'include' }]);
assert.deepStrictEqual(r.rows[1].via.map(v => v.how), ['parent']);
assert.strictEqual(r.rows[2].state, 'excluded');
assert.deepStrictEqual(r.rows[3].via.map(v => [v.how, v.intent]), [['direct', 'required'], ['parent', 'available']]);
assert.deepStrictEqual(r.rows[4].via[0], { how: 'direct', ref: ID, mode: 'include' }); // no filter: no filter fields

// A user: its groups (nested included) and All users, never All devices. Exclusion wins over All users.
r = L.resolve('user', { id: 'u1' }, [{ id: ID }, { id: PARENT }], items);
assert.deepStrictEqual(r.rows.map(x => x.key), ['a', 'b', 'c', 'e', 'g', 'j']);
assert.deepStrictEqual(r.rows.find(x => x.key === 'c').via.map(v => [v.how, v.mode]), [['allUsers', 'include'], ['group', 'exclude']]);
assert.strictEqual(r.rows.find(x => x.key === 'c').state, 'excluded');
assert.strictEqual(r.rows.find(x => x.key === 'e').state, 'included');

// A device whose memberships could not be read: All devices only.
r = L.resolve('device', { id: 'm1' }, [], items);
assert.deepStrictEqual(r.rows.map(x => x.key), ['f']);
assert.deepStrictEqual(r.rows[0].via, [{ how: 'allDevices', ref: 'allDevices', mode: 'include' }]);

assert.deepStrictEqual(L.unassigned(items).map(x => x.key), ['i']);
assert.strictEqual(L.assignmentsOf({ assignments: [1], 'assignments@odata.nextLink': 'x' }), null);
assert.deepStrictEqual(L.assignmentsOf({ assignments: [] }), []);
assert.strictEqual(L.assignmentsOf({}), null);

// ---------- export ----------

r = L.resolve('user', { id: 'u1' }, [{ id: ID }], [{ ...items[0], id: 'p1', kind: 'sc', type: 'Settings catalog', platform: 'Windows' }, { ...items[4], id: 'p2', kind: 'dc', type: 'Profile' }]);
const doc = L.exportDoc({ type: 'user', subject: { id: 'u1', name: 'Ann', detail: 'ann@contoso.com' }, memberships: [{ id: ID, displayName: 'Sales' }],
  rows: r.rows, tenantId: 't', exportedAt: '2026-11-17T10:00:00.000Z', coverage: { failed: [], unread: 0 } },
{ group: id => (id === ID ? 'Sales' : ''), filter: id => (id === FILTER ? 'Corporate' : '') });
assert.deepStrictEqual(doc.subject, { id: 'u1', name: 'Ann', detail: 'ann@contoso.com' });
assert.deepStrictEqual(doc.memberships, [{ id: ID, name: 'Sales' }]);
assert.deepStrictEqual(doc.results[0], { name: 'Direct', id: 'p1', kind: 'sc', type: 'Settings catalog', platform: 'Windows', state: 'included',
  via: [{ how: 'group', target: { id: ID, name: 'Sales' }, mode: 'include', filter: { id: FILTER, name: 'Corporate', mode: 'include' } }] });
assert.deepStrictEqual(doc.results[1].via, [{ how: 'allUsers', target: 'allUsers', mode: 'include' }]);
assert.ok(!JSON.stringify(doc).includes('assignments')); // raw Graph objects stay out
const plain = L.exportDoc({ type: 'unassigned', rows: [{ name: 'None', id: 'x', kind: 'dc', type: 'Profile' }], tenantId: 't', exportedAt: 'd', coverage: {} }, { group: () => '', filter: () => '' });
assert.deepStrictEqual(plain.results, [{ name: 'None', id: 'x', kind: 'dc', type: 'Profile', platform: '' }]);
assert.ok(!('subject' in plain) && !('memberships' in plain));

assert.strictEqual(L.exportName('group', 'GRP / Sales: EU', '2026-11-17'), 'assignment-search-group-GRP_Sales_EU-2026-11-17.json');
assert.strictEqual(L.exportName('unassigned', '', '2026-11-17'), 'assignment-search-unassigned-2026-11-17.json');

console.log('assignment-search: all checks passed');
