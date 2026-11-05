// Run: node scope-cleanup/test.js
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const C = require('./lib.js');
const P = require('../policy-import/lib.js');

const G = '#microsoft.graph.';
const DM = 'https://graph.microsoft.com/beta/deviceManagement/', APPS = 'https://graph.microsoft.com/beta/deviceAppManagement/';

// ---------- the rule: Default goes only when another tag stays ----------

assert.strictEqual(C.stateOf(['0', '5']), 'removable');
assert.strictEqual(C.stateOf(['0']), 'onlyDefault');
assert.strictEqual(C.stateOf(['5']), 'noDefault');
assert.strictEqual(C.stateOf([]), 'unreadable');
assert.strictEqual(C.stateOf(null), 'unreadable');
assert.strictEqual(C.stateOf([0, 5]), 'removable'); // the id may come as a number

assert.deepStrictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0', '5', '7'] }), { action: 'remove', tags: ['0', '5', '7'], body: { roleScopeTagIds: ['5', '7'] } });
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0'] }).action, 'onlyDefault');
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['0'] }).body, undefined); // nothing to send
assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: ['5'] }).action, 'noDefault');
for (const empty of [{}, { roleScopeTagIds: [] }, { roleScopeTagIds: 'x' }, null]) assert.strictEqual(C.cleanPlan('sc', empty).action, 'unreadable');
// Polymorphic resources: PATCH needs the type, and without it nothing is sent
assert.deepStrictEqual(C.cleanPlan('dc', { '@odata.type': G + 'x', roleScopeTagIds: ['0', '5'] }).body, { '@odata.type': G + 'x', roleScopeTagIds: ['5'] });
assert.deepStrictEqual(C.cleanPlan('app', { '@odata.type': G + 'macOSPkgApp', roleScopeTagIds: ['5', '0'] }).body, { '@odata.type': G + 'macOSPkgApp', roleScopeTagIds: ['5'] });
assert.strictEqual(C.cleanPlan('comp', { roleScopeTagIds: ['0', '5'] }).action, 'unreadable');
assert.deepStrictEqual(C.cleanPlan('ps', { roleScopeTagIds: ['0', '5'] }).body, { roleScopeTagIds: ['5'] });

// Never an empty list, whatever the⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ input
for (const tags of [['0'], ['0', '0'], [0], ['0', 0]]) assert.strictEqual(C.cleanPlan('sc', { roleScopeTagIds: tags }).action, 'onlyDefault', JSON.stringify(tags));

// The "Default + another tag" filter: Default only goes away, a row already processed stays to show its result
assert.strictEqual(C.keepRow(['0', '5'], false, true), true);
assert.strictEqual(C.keepRow(['0'], false, true), false);
assert.strictEqual(C.keepRow(['5'], true, true), true); // Default just removed: the result stays visible
assert.strictEqual(C.keepRow(['0'], false, false), true); // filter off: everything

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
  assert.deepStrictEqual([r.status, r.tags], ['onlyDefault', ['0']]);
  assert.deepStrictEqual(f.calls.map(c => c.op), ['policy']);

  // Default already gone, read refused, unreadable: no write
  f = fake({ policy: { status: 200, body: { '@odata.type': G + 'x', roleScopeTagIds: ['5'] } } });
  assert.strictEqual((await C.cleanLine(item, 'T', f.call)).status, 'noDefault');
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
  assert.deepStrictEqual(out.map(x => x.status), ['done', 'onlyDefault']);
  assert.ok(waits.includes(7000) && waits.includes(250));
  // 401 stops the series
  f = fake({ policy: [{ status: 401 }, { status: 200, body: { roleScopeTagIds: ['0', '5'] } }] });
  out = await C.runClean(items, 'T', f.call, opts);
  assert.deepStrictEqual(out.map(x => x.status), ['failed', 'notSent']);
  assert.strictEqual(out[0].error, 'assignForm.err.expired');
  assert.strictEqual(f.calls.length, 1);
  // Progress after each line
  const seen = [];
  f = fake({ policy: { status: 200, body: { roleScopeTagIds: ['0'] } } });
  await C.runClean(items, 'T', f.call, { ...opts, onProgress: (i, res) => seen.push([i, res.status]) });
  assert.deepStrictEqual(seen, [[0, 'onlyDefault'], [1, 'onlyDefault']]);

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
