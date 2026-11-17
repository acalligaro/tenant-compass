// Run: node scope-cleanup/test.js
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const C = require('./lib.js');
const P = require('../policy-import/lib.js');

const G = '#microsoft.graph.';
const DM = 'https://graph.microsoft.com/beta/deviceManagement/', APPS = 'https://graph.microsoft.com/beta/deviceAppManagement/';

// ---------- the rule: Default goes only when another tag stays ----------

assert.strictEqual(C.stateOf(['0', '5']), 'removable');
assert.strictEqual(C.stateOf(['0']), 'onlyTag');
assert.strictEqual(C.stateOf(['5']), 'absent');
assert.strictEqual(C.stateOf([]), 'unreadable');
assert.strictEqual(C.stateOf(null), 'unreadable');
assert.strictEqual(C.stateOf([0, 5]), 'removable'); // the id may come as a number

assert.deepStrictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0', '5', '7'] }), { action: 'remove', tags: ['0', '5', '7'], body: { roleScopeTagIds: ['5', '7'] } });
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0'] }).action, 'onlyTag');
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0'] }).body, undefined); // nothing to send
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['5'] }).action, 'absent');
for (const empty of [{}, { roleScopeTagIds: [] }, { roleScopeTagIds: 'x' }, null]) assert.strictEqual(C.cleanPlan('sc', empty).action, 'unreadable');
// Polymorphic resources: PATCH needs the type, and without it nothing is sent
assert.deepStrictEqual(C.cleanPlan('dc', { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] }).body, { '@odata.type': G + 'x', roleScopeTagIds: ['5'] });
assert.deepStrictEqual(C.cleanPlan('app', { '@odata.type': G + 'macOSPkgApp', roleScopeTagIds: ['5', '0'] }).body, { '@odata.type': G + 'macOSPkgApp', roleScopeTagIds: ['5'] });
assert.strictEqual(C.cleanPlan('comp', { roleScopeTagIds: ['0', '5'] }).action, 'unreadable');
assert.deepStrictEqual(C.cleanPlan('ps', { roleScopeTagIds: ['0', '5'] }).body, { roleScopeTagIds: ['5'] });

// Never an empty list, whatever the⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ input
for (const tags of [['0'], ['0', '0'], [0], ['0', 0]]) assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: tags }).action, 'onlyTag', JSON.stringify(tags));

// The "Default + another tag" filter: Default only goes away, a row already processed stays to show its result
assert.strictEqual(C.keepRow(['0', '5'], false, true), true);
assert.strictEqual(C.keepRow(['0'], false, true), false);
assert.strictEqual(C.keepRow(['5'], true, true), true); // Default just removed: the result stays visible
assert.strictEqual(C.keepRow(['0'], false, false), true); // filter off: every object holding the tag
assert.strictEqual(C.keepRow(['5'], false, false), false); // not holding it: not listed
assert.strictEqual(C.keepRow(null, false, false), false);

// ---------- another tag than Default: same rule, the tag goes only when another one stays ----------

assert.strictEqual(C.stateOf(['0', '5'], '5'), 'removable');
assert.strictEqual(C.stateOf(['5'], '5'), 'onlyTag');
assert.strictEqual(C.stateOf(['5', 5], 5), 'onlyTag');
assert.strictEqual(C.stateOf(['0', '7'], '5'), 'absent');
assert.deepStrictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0', '5', '7'] }, '5').body, { roleScopeTagIds: ['0', '7'] }); // Default stays
assert.deepStrictEqual(C.cleanPlan('dc', { '@odata.type': G + 'x', roleScopeTagIds: ['5', '7'] }, 7).body, { '@odata.type': G + 'x', roleScopeTagIds: ['5'] });
for (const tags of [['5'], ['5', '5'], [5]]) assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: tags }, '5').body, undefined, JSON.stringify(tags));
assert.strictEqual(C.keepRow(['0', '5'], false, true, '5'), true);
assert.strictEqual(C.keepRow(['5'], false, true, '5'), false);
assert.strictEqual(C.keepRow(['0'], false, false, '5'), false);

// Tag list: Default first even when unnamed or unused, then by name, with the number of objects holding each tag
const names = new Map([['5', 'Paris'], ['7', 'Lyon'], ['9', 'Unused']]);
assert.deepStrictEqual(C.tagChoices([['0', '5'], ['5', '7', '7'], null, ['12']], names),
  [{ id: '0', name: 'Default', n: 1 }, { id: '12', name: '12', n: 1 }, { id: '7', name: 'Lyon', n: 1 }, { id: '5', name: 'Paris', n: 2 }, { id: '9', name: 'Unused', n: 0 }]);
assert.deepStrictEqual(C.tagChoices([], new Map()), [{ id: '0', name: 'Default', n: 0 }]);

// ---------- closed tables ----------

const KINDS = ['sc', 'dc', 'comp', 'admx', 'ps', 'sh', 'cattr', 'rem', 'app'];
assert.deepStrictEqual(C.KINDS, KINDS);
assert.strictEqual(C.itemUrl('dc', 'a b'), DM + 'deviceConfigurations/a%20b');
assert.strictEqual(C.itemUrl('rem', 'x'), DM + 'deviceHealthScripts/x');
assert.strictEqual(C.itemUrl('app', 'x'), APPS + 'mobileApps/x');
for (const k of ['ca', '__proto__', 'constructor', '', null, undefined]) { assert.strictEqual(C.itemUrl(k, 'x'), null); assert.strictEqual(C.listUrl(k), null); }
assert.ok(C.listUrl('app').startsWith(APPS + 'mobileApps?$select=') && C.listUrl('app').includes('roleScopeTagIds'));
assert.ok(C.listUrl('sh').includes('roleScopeTagIds'));
assert.strictEqual(C.listUrl('sc'), DM + 'configurationPolicies');
// The plain URL is the one As-Built reads on real tenants
assert.ok(!C.listUrl('dc', true).includes('roleScopeTagIds') && C.listUrl('dc', true).startsWith(DM + 'deviceConfigurations?$select=id,displayName'));

// Write scope per type
const CONFIG = 'DeviceManagementConfiguration.ReadWrite.All', SCRIPTS = 'DeviceManagementScripts.ReadWrite.All', MOBILE = 'DeviceManagementApps.ReadWrite.All';
assert.deepStrictEqual(C.kindsFor([CONFIG]), ['sc', 'dc', 'comp', 'admx']);
assert.deepStrictEqual(C.kindsFor([SCRIPTS]), ['ps', 'sh', 'cattr', 'rem']);
assert.deepStrictEqual(C.kindsFor([MOBILE]), ['app']);
assert.deepStrictEqual(C.kindsFor(['User.Read']), []);
const jwt = c => 'h.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.s';
assert.deepStrictEqual(P.tokenScopes(jwt({ aud: 'https://graph.microsoft.com', exp: 2000, tid: 'T', scp: `${MOBILE} X` }), 1000e3), { tid: 'T', scopes: [MOBILE, 'X'] });
assert.deepStrictEqual(P.tokenScopes(jwt({ aud: 'https://graph.microsoft.com', exp: 2000, tid: 'T', scp: MOBILE }), 3000e3).scopes, []); // expired

// Tags of a list row: lists may answer an empty or absent value (apps: IntuneManagement ScopeTagsReturnedInList = false)
assert.deepStrictEqual(C.tagsIn({ roleScopeTagIds: ['0', 5] }), ['0', '5']);
for (const r of [{}, { roleScopeTagIds: [] }, { roleScopeTagIds: null }, null]) assert.strictEqual(C.tagsIn(r), null);

(async () => {
  const fake = script => {
    const calls = [];
    const call = async (op, kind, args) => { calls.push({ op, kind, args }); const q = script[op]; return (Array.isArray(q) ? q.shift() : q) || { status: 200, body: {} }; };
    return { calls, call };
  };

  // ---------- reading ----------

  // A list refused with its $select is read again with the plain URL; both refused: the reason is reported
  let f = fake({ list: [{ status: 400 }, { status: 200, body: { value: [{ id: 'a' }] } }] });
  assert.deepStrictEqual(await C.loadKind('dc', f.call), { rows: [{ id: 'a' }], error: null });
  assert.deepStrictEqual(f.calls.map(c => c.args), [{}, { plain: true }]);
  f = fake({ list: [{ status: 403, message: 'no' }, { status: 403, message: 'no' }] });
  assert.deepStrictEqual(await C.loadKind('dc', f.call), { rows: [], error: 'no' });

  // Rows without tags are read one by one; those with tags are not⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  f = fake({ policy: { status: 200, body: { roleScopeTagIds: ['0', '5'] } } });
  let rows = await C.resolveTags('app', [{ id: 'a', roleScopeTagIds: ['0'] }, { id: 'b' }], f.call);
  assert.deepStrictEqual(rows.map(r => r.tags), [['0'], ['0', '5']]);
  assert.deepStrictEqual(f.calls.map(c => c.args.id), ['b']);
  f = fake({ policy: { status: 403 } });
  rows = await C.resolveTags('app', [{ id: 'b' }], f.call);
  assert.strictEqual(rows[0].tags, null);

  // ---------- one line ----------

  const item = { kind: 'dc', id: 'p1', name: 'P' };
  // Removed, the other tags stay, the write carries the confirmed⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ tenant
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] } }, patchTags: { status: 200 } });
  let r = await C.cleanLine(item, 'T', f.call);
  assert.deepStrictEqual([r.status, r.tags], ['done', ['5']]);
  assert.deepStrictEqual(f.calls.find(c => c.op === 'patchTags').args, { id: 'p1', tid: 'T', body: { '@odata.type': G + 'x', roleScopeTagIds: ['5'] } });

  // Only Default: no write at all, even when the list said otherwise (the read just before the write decides)
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['0'] } } });
  r = await C.cleanLine(item, 'T', f.call);
  assert.deepStrictEqual([r.status, r.tags], ['onlyTag', ['0']]);
  assert.deepStrictEqual(f.calls.map(c => c.op), ['policy']);

  // Default already gone, read refused, unreadable: no write
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['5'] } } });
  assert.strictEqual((await C.cleanLine(item, 'T', f.call)).status, 'absent');
  assert.ok(!f.calls.some(c => c.op === 'patchTags'));
  f = fake({ policy: { status: 403, message: 'denied' } });
  r = await C.cleanLine(item, 'T', f.call);
  assert.deepStrictEqual([r.status, r.error], ['failed', 'denied']);
  assert.ok(!f.calls.some(c => c.op === 'patchTags'));
  f = fake({ policy: { status: 200, body: { roleScopeTagIds: ['0', '5'] } } }); // no @odata.type on a profile
  assert.strictEqual((await C.cleanLine(item, 'T', f.call)).status, 'unreadable');
  assert.ok(!f.calls.some(c => c.op === 'patchTags'));

  // After the write left: 5xx is unknown, and the tags shown stay those read; a refusal says why
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] } }, patchTags: { status: 500 } });
  r = await C.cleanLine(item, 'T', f.call);
  assert.deepStrictEqual([r.status, r.tags], ['unknown', ['0', '5']]);
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] } }, patchTags: { status: 400, message: 'bad' } });
  r = await C.cleanLine(item, 'T', f.call);
  assert.deepStrictEqual([r.status, r.error, r.tags], ['failed', 'bad', ['0', '5']]);

  // ---------- the whole run ----------

  const items = [{ kind: 'sc', id: 'a', name: 'A' }, { kind: 'sc', id: 'b', name: 'B' }];
  const waits = [];
  const opts = { pause: async ms => { waits.push(ms); } };
  // 429 waits Retry-After then goes on
  f = fake({ policy: [{ status: 429, retryAfter: 7 }, { status: 200, body: { roleScopeTagIds: ['0', '5'] } }, { status: 200, body: { roleScopeTagIds: ['0'] } }], patchTags: { status: 200 } });
  let out = await C.runClean(items, 'T', f.call, opts);
  assert.deepStrictEqual(out.map(x => x.status), ['done', 'onlyTag']);
  assert.ok(waits.includes(7000) && waits.includes(250));
  // 401 stops the series
  f = fake({ policy: [{ status: 401 }, { status: 200, body: { roleScopeTagIds: ['0', '5'] } }] });
  out = await C.runClean(items, 'T', f.call, opts);
  assert.deepStrictEqual(out.map(x => x.status), ['failed', 'notSent']);
  assert.strictEqual(out[0].error, 'assignForm.err.expired');
  assert.strictEqual(f.calls.length, 1);
  // Another tag: the read decides with that tag, the write keeps Default
  f = fake({ policy: [{ status: 200, body: { roleScopeTagIds: ['0', '5'] } }, { status: 200, body: { roleScopeTagIds: ['5'] } }], patchTags: { status: 200 } });
  out = await C.runClean(items, 'T', f.call, { ...opts, tag: '5' });
  assert.deepStrictEqual(out.map(x => x.status), ['done', 'onlyTag']);
  assert.deepStrictEqual(f.calls.filter(c => c.op === 'patchTags').map(c => c.args.body), [{ roleScopeTagIds: ['0'] }]);
  // Progress after each line
  const seen = [];
  f = fake({ policy: { status: 200, body: { roleScopeTagIds: ['0'] } } });
  await C.runClean(items, 'T', f.call, { ...opts, onProgress: (i, res) => seen.push([i, res.status]) });
  assert.deepStrictEqual(seen, [[0, 'onlyTag'], [1, 'onlyTag']]);

  // JSON export: the checked rows only, with tag names, nothing read from Graph
  const names = id => ({ '0': 'Default', '7': 'Paris' })[id] || id;
  assert.deepStrictEqual(C.exportRows([{ kind: 'dc', key: 'dc:1', id: '1', name: 'Wi-Fi', type: 'Profil', platforms: ['Windows'], tags: ['0', '7', '9'], description: 'x' }], names),
    [{ id: '1', name: 'Wi-Fi', type: 'Profil', platforms: ['Windows'], scopeTags: [{ id: '0', name: 'Default' }, { id: '7', name: 'Paris' }, { id: '9', name: '9' }] }]);
  assert.deepStrictEqual(C.exportRows([{ id: '2', name: 'App', type: 'App', tags: null }], names), [{ id: '2', name: 'App', type: 'App', platforms: [], scopeTags: [] }]);
  assert.deepStrictEqual(C.exportRows([], names), []);

  // i18n: same keys in both languages, every key used by the code exists
  const dicts = {};
  globalThis.__tenantCompassI18n = { add: d => { for (const l of ['fr', 'en']) dicts[l] = { ...dicts[l], ...d[l] }; } };
  require('../shared/assign-i18n.js');
  require('./i18n.js');
  assert.deepStrictEqual(Object.keys(dicts.fr).sort(), Object.keys(dicts.en).sort());
  const read = f2 => fs.readFileSync(path.join(__dirname, '..', f2), 'utf8');
  for (const f2 of ['scope-cleanup/lib.js', 'scope-cleanup/page.js'])
    for (const k of new Set(read(f2).match(/(scopeCleanup|assignForm)\.[a-zA-Z.]+/g) || [])) assert.ok(dicts.fr[k], `${f2}: missing ${k}`);

  // Opt-in: off by default in both copies of DEFAULTS, Intune console only
  for (const f2 of ['background.js', 'popup.js']) assert.match(read(f2), /const DEFAULTS = \{[^}]*scopeCleanup: false/, f2);
  const registration = /scopeCleanup: \[\{[\s\S]*?\}\],/.exec(read('background.js'))?.[0] || '';
  assert.match(registration, /'scope-cleanup\/lib\.js', 'scope-cleanup\/page\.js'\]/);
  assert.match(registration, /world: 'MAIN'/);
  assert.ok(!/portal\.azure\.com|entra\.microsoft\.com/.test(registration), 'Intune console only');
  for (const k of ['f.scopeCleanup', 'f.scopeCleanup.desc']) assert.strictEqual((read('shared/i18n.js').match(new RegExp(`'${k}':`, 'g')) || []).length, 2, k);

  // Static checks: writes only through the shared PATCH, no other operation on this channel, no leak
  const pageSrc = read('scope-cleanup/page.js');
  assert.ok(!/method: '|window\.fetch|console\.|chrome\.storage|localStorage|innerHTML/.test(pageSrc));
  assert.ok(!/\bassign:|'assign'/.test(pageSrc), 'this feature never assigns');
  assert.ok(!/'(PUT|DELETE|POST)'|\$batch/.test(read('scope-cleanup/lib.js')));

  console.log('scope-cleanup: all checks passed');
})().catch(err => { console.error(err); process.exit(1); });
