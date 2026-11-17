// Run: node policy-import/test.js
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const L = require('./lib.js');

const G = '#microsoft.graph.';

// ---------- reading⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ an As-Built JSON export ----------

const asBuilt = JSON.stringify({ exportedAt: 'x', tenantId: 'T1', policies: [
  { type: 'settingsCatalog', policy: { name: 'A' }, settings: [{ id: '0', settingInstance: {} }], assignments: [{ target: {} }] },
  { type: 'mobileApp', policy: { displayName: 'App' } },
  { type: 'deviceConfiguration', id: '1', name: 'Broken', error: 'Graph 403' },
  { type: '__proto__', policy: { displayName: 'P' } },
] });
const p = L.parseFile('a.json', asBuilt);
assert.strictEqual(p.error, null);
assert.strictEqual(p.tenantId, 'T1');
assert.deepStrictEqual(p.raw.map(r => [r.kind, r.name]), [['sc', 'A'], [null, 'App'], ['dc', 'Broken'], [null, 'P']]);
assert.strictEqual(p.raw[0].file, 'a.json');
assert.strictEqual(p.raw[0].settings.length, 1);
assert.strictEqual(p.raw[0].assignments.length, 1);
assert.strictEqual(p.raw[1].type, 'mobileApp');
assert.strictEqual(p.raw[2].readError, 'Graph 403');
assert.deepStrictEqual(['settingsCatalog', 'deviceConfiguration', 'compliancePolicy', 'deviceManagementScript', 'deviceShellScript', 'deviceCustomAttributeShellScript', 'deviceHealthScript']
  .map(type => L.parseFile('a.json', JSON.stringify({ policies: [{ type, policy: {} }] })).raw[0].kind), ['sc', 'dc', 'comp', 'ps', 'sh', 'cattr', 'rem']);
assert.strictEqual(L.parseFile('a.json', JSON.stringify({ policies: [{}] })).tenantId, null);

assert.strictEqual(L.parseFile('a.json', 'nope').error, 'policyImport.err.notJson');
for (const other of ['[]', '42', 'null', '{}', '{"policies":"x"}', '{"name":"native catalog export","settings":[]}'])
  assert.strictEqual(L.parseFile('a.json', other).error, 'policyImport.err.notAsBuilt', other);
assert.strictEqual(L.parseFile('a.json', '{"policies":[]}').error, 'policyImport.err.empty');
assert.strictEqual(L.parseFile('a.json', JSON.stringify({ policies: Array(501).fill({}) })).error, 'policyImport.err.tooMany');

// ----------⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ building the request body ----------

const OTHER = { sourceTenantId: 'T1', tenantId: 'T2' }, SAME = { sourceTenantId: 'T1', tenantId: 'T1' };
const SET = G + 'deviceManagementConfigurationSetting';

// Settings catalog: allow-list
const sc = { kind: 'sc', name: 'A', file: 'a.json', readError: null, assignments: [{ target: {} }], policy: { id: 'x', name: 'A', description: 'd', platforms: 'macOS', technologies: 'mdm',
  roleScopeTagIds: ['5'], settingCount: 1, createdDateTime: 'd', lastModifiedDateTime: 'd', creationSource: null, '@odata.context': 'c',
  templateReference: { templateId: '', templateFamily: 'none', templateDisplayName: null } },
  settings: [{ id: '0', settingInstance: { settingDefinitionId: 'd1' }, settingDefinitions: [{}] }] };
const e = L.prepare(sc, OTHER);
assert.deepStrictEqual(Object.keys(e.body).sort(), ['description', 'name', 'platforms', 'roleScopeTagIds', 'settings', 'technologies']);
assert.deepStrictEqual(e.body.settings, [{ '@odata.type': SET, settingInstance: { settingDefinitionId: 'd1' } }]);
assert.deepStrictEqual(e.body.roleScopeTagIds, ['0']);
assert.deepStrictEqual(e.blockers, []);
assert.ok(e.warnings.includes('policyImport.warn.crossTenant'));
assert.ok(e.warnings.includes('policyImport.warn.assignmentsIgnored'));
assert.deepStrictEqual(L.prepare(sc, SAME).body.roleScopeTagIds, ['5']);
assert.ok(!L.prepare(sc, SAME).warnings.includes('policyImport.warn.crossTenant'));
assert.deepStrictEqual(L.prepare(sc, { sourceTenantId: null, tenantId: 'T2' }).body.roleScopeTagIds, ['0']); // export without tenant: treated as another tenant
const tpl = L.prepare({ ...sc, policy: { ...sc.policy, templateReference: { templateId: 't', templateFamily: 'f', templateDisplayName: 'n' } } }, SAME);
assert.deepStrictEqual(tpl.body.templateReference, { templateId: 't', templateFamily: 'f' });
assert.deepStrictEqual(L.prepare({ ...sc, settings: [], policy: { name: 'A' } }, SAME).blockers, ['policyImport.block.noSettings']);

// Masked or encrypted secrets are blocked, in both export languages: a mask must never become the real value
for (const value of ['(secret masqué)', '(secret hidden)']) {
  const s = L.prepare({ ...sc, settings: [{ settingInstance: { simpleSettingValue: { value } } }] }, SAME);
  assert.ok(s.blockers.includes('policyImport.block.secret'));
  assert.strictEqual(s.body, null);
}
assert.ok(L.prepare({ ...sc, settings: [{ settingInstance: { simpleSettingValue: { '@odata.type': G + 'deviceManagementConfigurationSecretSettingValue', value: 'x', valueState: 'encryptedValueToken' } } }] }, SAME)
  .blockers.includes('policyImport.block.secret'));
const dcBase = { kind: 'dc', name: 'D', file: 'd.json', readError: null, assignments: [], settings: [] };
assert.ok(L.prepare({ ...dcBase, policy: { '@odata.type': G + 'windows10CustomConfiguration', displayName: 'D',
  omaSettings: [{ isEncrypted: true, secretReferenceValueId: 'g', value: 'x' }] } }, SAME).blockers.includes('policyImport.block.secret'));
// Graph answers null for a Wi-Fi pre-shared key: creating the profile would lose it silently
assert.ok(L.prepare({ ...dcBase, policy: { '@odata.type': G + 'macOSWiFiConfiguration', displayName: 'D', wiFiSecurityType: 'wpaPersonal', preSharedKey: null } }, SAME).blockers.includes('policyImport.block.secret'));
assert.deepStrictEqual(L.prepare({ ...dcBase, policy: { '@odata.type': G + 'macOSWiFiConfiguration', displayName: 'D', wiFiSecurityType: 'open', preSharedKey: null } }, SAME).blockers, []);

// Profiles linked to a certificate profile: the link is not exported, the copy would lack its certificate
for (const t of ['macOSScepCertificateProfile', 'windows81SCEPCertificateProfile', 'macOSEnterpriseWiFiConfiguration', 'windowsWifiEnterpriseEAPConfiguration',
  'macOSVpnConfiguration', 'windows10VpnConfiguration', 'macOSWiredNetworkConfiguration', 'androidPkcsCertificateProfile', 'iosEasEmailProfileConfiguration', 'androidDeviceOwnerImportedPFXCertificateProfile'])
  assert.deepStrictEqual(L.prepare({ ...dcBase, policy: { '@odata.type': G + t, displayName: 'D' } }, SAME).blockers, ['policyImport.block.certLink'], t);
for (const t of ['macOSCustomConfiguration', 'macOSCustomAppConfiguration', 'macOSTrustedRootCertificate', 'macOSPkcsCertificateProfile', 'macOSGeneralDeviceConfiguration', 'macOSDeviceFeaturesConfiguration', 'macOSSoftwareUpdateConfiguration'])
  assert.deepStrictEqual(L.prepare({ ...dcBase, policy: { '@odata.type': G + t, displayName: 'D' } }, SAME).blockers, [], t);

// A hostile file adds nothing to the request and pollutes nothing
const hostile = JSON.parse('{"@odata.type":"#microsoft.graph.macOSCustomConfiguration","displayName":"D","__proto__":{"polluted":1},"id":"1","assignments":[{}],"x@odata.bind":"https://evil","@odata.id":"https://evil","nested":{"@odata.context":"c","a":1,"constructor":{"prototype":{"polluted":1}}}}');
const h = L.prepare({ ...dcBase, policy: hostile }, SAME);
assert.deepStrictEqual(h.body, { '@odata.type': G + 'macOSCustomConfiguration', displayName: 'D', nested: { a: 1 } });
assert.strictEqual(({}).polluted, undefined);
assert.deepStrictEqual(L.prepare({ ...dcBase, policy: { '@odata.type': '#evil.type', displayName: 'D' } }, SAME).blockers, ['policyImport.block.badType']);
assert.deepStrictEqual(L.prepare({ ...dcBase, policy: { displayName: 'D' } }, SAME).blockers, ['policyImport.block.badType']);
// Base64 bodies stay byte-exact
assert.strictEqual(L.prepare({ ...dcBase, policy: { '@odata.type': G + 'macOSCustomConfiguration', displayName: 'D', payload: 'PD94bWw=' } }, SAME).body.payload, 'PD94bWw=');

// Compliance: exactly one block action, Microsoft requires it
const compBase = { kind: 'comp', name: 'C', file: 'c.json', readError: null, assignments: [], settings: [] };
const actions = [{ id: 'a', actionType: 'block', gracePeriodHours: 12, notificationTemplateId: '', notificationMessageCCList: [] },
  { id: 'b', actionType: 'notification', gracePeriodHours: 0, notificationTemplateId: 'g', notificationMessageCCList: ['x'] }];
const comp = { '@odata.type': G + 'macOSCompliancePolicy', displayName: 'C', id: '1', scheduledActionsForRule: [{ id: 'r', ruleName: 'PasswordRequired', scheduledActionConfigurations: actions }] };
const ce = L.prepare({ ...compBase, policy: comp }, OTHER);
assert.deepStrictEqual(ce.body.scheduledActionsForRule, [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 12, notificationTemplateId: '', notificationMessageCCList: [] }] }]);
assert.ok(ce.warnings.includes('policyImport.warn.actionsDropped'));
assert.strictEqual(L.prepare({ ...compBase, policy: comp }, SAME).body.scheduledActionsForRule[0].scheduledActionConfigurations.length, 2);
assert.ok(!L.prepare({ ...compBase, policy: comp }, SAME).warnings.includes('policyImport.warn.actionsDropped'));
const none = L.prepare({ ...compBase, policy: { '@odata.type': G + 'macOSCompliancePolicy', displayName: 'C' } }, SAME);
assert.deepStrictEqual(none.body.scheduledActionsForRule, [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 0, notificationTemplateId: '', notificationMessageCCList: [] }] }]);
assert.ok(none.warnings.includes('policyImport.warn.blockAdded'));
const nullRule = L.prepare({ ...compBase, policy: { ...comp, scheduledActionsForRule: [{ ruleName: null, scheduledActionConfigurations: [actions[0]] }] } }, SAME);
assert.strictEqual(nullRule.body.scheduledActionsForRule[0].ruleName, 'PasswordRequired'); // Graph answers null on read

// Scripts: typed body, content required, other blockers
const script = { kind: 'ps', name: 'S', file: 's.json', readError: null, assignments: [], settings: [] };
const sOk = L.prepare({ ...script, policy: { displayName: 'S', scriptContent: 'eA==', id: '1' } }, SAME);
assert.strictEqual(sOk.hasScript, true);
assert.strictEqual(sOk.body.id, undefined);
assert.strictEqual(sOk.body['@odata.type'], G + 'deviceManagementScript');
assert.strictEqual(L.prepare({ ...script, kind: 'sh', policy: { displayName: 'S', scriptContent: 'eA==', '@odata.type': '#evil.type' } }, SAME).body['@odata.type'], G + 'deviceShellScript');
assert.strictEqual(L.prepare({ ...script, kind: 'cattr', policy: { displayName: 'S', scriptContent: 'eA==', customAttributeName: 'n', customAttributeType: 'string' } }, SAME).body.customAttributeName, 'n');
assert.strictEqual(L.prepare({ ...script, kind: 'rem', policy: { displayName: 'S', detectionScriptContent: 'eA==', remediationScriptContent: 'eA==', isGlobalScript: false, highestAvailableVersion: '1' } }, SAME).body.isGlobalScript, undefined);
assert.strictEqual(L.prepare(sc, SAME).hasScript, false);
assert.deepStrictEqual(L.prepare({ ...script, policy: { displayName: 'S' } }, SAME).blockers, ['policyImport.block.noScript']);
assert.deepStrictEqual(L.prepare({ ...script, kind: 'rem', policy: { displayName: 'S' } }, SAME).blockers, ['policyImport.block.noScript']);
assert.deepStrictEqual(L.prepare({ ...dcBase, kind: null, policy: { displayName: 'App' } }, SAME).blockers, ['policyImport.block.unsupported']);
assert.ok(L.prepare({ ...dcBase, readError: 'Graph 403', policy: undefined }, SAME).blockers.includes('policyImport.block.readError'));
assert.ok(L.prepare({ ...sc, name: '', policy: { ...sc.policy, name: '' } }, SAME).blockers.includes('policyImport.block.noName'));

// ---------- closed endpoint table, write scope per type ----------

const BASE = 'https://graph.microsoft.com/beta/deviceManagement/';
const KINDS = ['sc', 'dc', 'comp', 'ps', 'sh', 'cattr', 'rem'];
assert.deepStrictEqual(KINDS.map(L.endpointFor), ['configurationPolicies', 'deviceConfigurations', 'deviceCompliancePolicies',
  'deviceManagementScripts', 'deviceShellScripts', 'deviceCustomAttributeShellScripts', 'deviceHealthScripts'].map(x => BASE + x));
for (const k of ['admx', 'app', '__proto__', 'constructor', '', null, undefined]) assert.strictEqual(L.endpointFor(k), null);
assert.strictEqual(L.namesUrl('sc'), BASE + 'configurationPolicies?$select=id,name');
assert.strictEqual(L.namesUrl('dc'), BASE + 'deviceConfigurations?$select=id,displayName');
assert.strictEqual(L.namesUrl('app'), null);
assert.strictEqual(L.nameField('sc'), 'name');
assert.strictEqual(L.nameField('rem'), 'displayName');

const jwt = c => 'h.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.s';
const CONFIG = 'DeviceManagementConfiguration.ReadWrite.All', SCRIPTS = 'DeviceManagementScripts.ReadWrite.All';
const good = { aud: 'https://graph.microsoft.com', exp: 2000, tid: 'T2', scp: `${CONFIG} ${SCRIPTS} Group.Read.All` };
assert.deepStrictEqual(L.tokenInfo(jwt(good), 1000e3), { tid: 'T2', kinds: KINDS });
assert.deepStrictEqual(L.tokenInfo(jwt({ ...good, scp: CONFIG }), 1000e3).kinds, ['sc', 'dc', 'comp']);
assert.deepStrictEqual(L.tokenInfo(jwt({ ...good, scp: SCRIPTS }), 1000e3).kinds, ['ps', 'sh', 'cattr', 'rem']);
assert.deepStrictEqual(L.tokenInfo(jwt(good), 3000e3).kinds, []); // expired
assert.deepStrictEqual(L.tokenInfo(jwt({ ...good, scp: 'DeviceManagementConfiguration.Read.All' }), 1000e3).kinds, []);
assert.deepStrictEqual(L.tokenInfo(jwt({ ...good, scp: 'x' + CONFIG }), 1000e3).kinds, []); // exact word only
assert.deepStrictEqual(L.tokenInfo(jwt({ ...good, aud: 'https://management.azure.com' }), 1000e3).kinds, []);
assert.deepStrictEqual(L.tokenInfo('garbage').kinds, []);
assert.deepStrictEqual(L.jwtsIn({ a: { b: 'Bearer eyJa.eyJb.c' } }), ['eyJa.eyJb.c']);

// ---------- context of the target tenant⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ ----------

const ready = (kind, name) => ({ kind, name, body: {}, blockers: [], warnings: [] });
const dup = L.markDuplicates([ready('sc', ' Base '), ready('dc', 'Base'), ready('sc', 'New'), ready('sc', 'NEW')], { sc: ['base'], dc: [] }, KINDS);
assert.deepStrictEqual(dup.map(x => x.duplicate), [true, false, false, true]); // the last one: same name twice in the selection
// Names not read: a replayed import would⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ create duplicates, so the entry is blocked
const unread = L.markDuplicates([ready('sh', 'S')], {}, KINDS)[0];
assert.deepStrictEqual(unread.blockers, ['policyImport.block.namesUnread']);
assert.strictEqual(unread.body, null);
const noScope = L.markDuplicates([ready('sh', 'S')], { sh: [] }, ['sc'])[0];
assert.deepStrictEqual(noScope.blockers, ['policyImport.block.noScope']);
assert.strictEqual(noScope.body, null);
const already = { ...ready('sc', 'X'), body: null, blockers: ['policyImport.block.secret'] };
assert.deepStrictEqual(L.markDuplicates([already], {}, [])[0].blockers, ['policyImport.block.secret']);

// Optional prefix: changes the name shown and the name sent, in the property of each type, and nothing else
const toPrefix = { kind: 'sc', name: 'A', body: { name: 'A', description: 'd' }, blockers: [], warnings: [] };
const prefixed = L.applyPrefix(toPrefix, 'TEST - ');
assert.strictEqual(prefixed.name, 'TEST - A');
assert.deepStrictEqual(prefixed.body, { name: 'TEST - A', description: 'd' });
assert.strictEqual(toPrefix.body.name, 'A'); // the prepared entry stays intact: the prefix can change
assert.strictEqual(L.applyPrefix({ kind: 'dc', name: 'D', body: { displayName: 'D', payload: 'eA==' } }, 'X-').body.displayName, 'X-D');
assert.strictEqual(L.applyPrefix({ kind: 'sh', name: 'S', body: { displayName: 'S', fileName: 'a.zsh' } }, 'X-').body.fileName, 'a.zsh');
assert.strictEqual(L.applyPrefix(toPrefix, ''), toPrefix);
assert.strictEqual(L.applyPrefix(toPrefix, '   '), toPrefix);
assert.strictEqual(L.applyPrefix(toPrefix, '  T ').name, 'T A'); // the separator typed by the user is kept
const blockedEntry = { kind: 'sc', name: 'B', body: null, blockers: ['policyImport.block.secret'], warnings: [] };
assert.strictEqual(L.applyPrefix(blockedEntry, 'X-'), blockedEntry);
// Scope tags chosen in the panel replace those of the file: the warning about Default no longer applies
const tagged = L.applyTags({ kind: 'sc', name: 'A', body: { name: 'A', roleScopeTagIds: ['0'] }, blockers: [], warnings: ['policyImport.warn.crossTenant', 'policyImport.warn.assignmentsIgnored'] }, ['5', '7']);
assert.deepStrictEqual(tagged.body.roleScopeTagIds, ['5', '7']);
assert.deepStrictEqual(tagged.warnings, ['policyImport.warn.assignmentsIgnored']);
assert.strictEqual(L.applyTags(toPrefix, []), toPrefix);
assert.strictEqual(L.applyTags(blockedEntry, ['5']), blockedEntry);
// What happens after a creation: scripts only on request, remediations never (they need a schedule)
const someTarget = { '@odata.type': G + 'groupAssignmentTarget', groupId: 'g' };
assert.deepStrictEqual(['sc', 'dc', 'comp'].map(k => L.assignPlan(k, someTarget, false)), ['assign', 'assign', 'assign']);
assert.deepStrictEqual(['ps', 'sh', 'cattr'].map(k => L.assignPlan(k, someTarget, false)), ['script', 'script', 'script']);
assert.deepStrictEqual(['ps', 'sh', 'cattr'].map(k => L.assignPlan(k, someTarget, true)), ['assign', 'assign', 'assign']);
assert.strictEqual(L.assignPlan('rem', someTarget, true), 'remediation');
assert.strictEqual(L.assignPlan('sc', null, true), null);
// Duplicates are checked on the name that will be created
assert.strictEqual(L.markDuplicates([L.applyPrefix(ready('sc', 'Base'), 'T-')], { sc: ['Base'] }, KINDS)[0].duplicate, false);
assert.strictEqual(L.markDuplicates([L.applyPrefix(ready('sc', 'Base'), 'T-')], { sc: ['t-base'] }, KINDS)[0].duplicate, true);

// ---------- running the import ----------

(async () => {
  const entry = name => ({ kind: 'sc', name, body: {} });
  const run = async (names, scripted) => {
    const calls = [], waits = [];
    const out = await L.runImport(names.map(entry), async e => { calls.push(e.name); return scripted[e.name].shift(); }, { pause: async ms => { waits.push(ms); } });
    return { calls, waits, out };
  };
  // 429 waits Retry-After then retries; 400 fails with Graph's message; 5xx is never retried
  let r = await run(['a', 'b', 'c'], { a: [{ status: 429, retryAfter: 7 }, { status: 201, id: '1' }], b: [{ status: 400, message: 'bad' }], c: [{ status: 500 }] });
  assert.deepStrictEqual(r.calls, ['a', 'a', 'b', 'c']);
  assert.deepStrictEqual(r.out.map(x => x.status), ['created', 'failed', 'unknown']);
  assert.strictEqual(r.out[0].id, '1');
  assert.strictEqual(r.out[1].error, 'bad');
  assert.ok(r.waits.includes(7000));
  assert.ok(r.waits.includes(250));
  // Network error: the object may exist, no retry
  r = await run(['a'], { a: [{ status: 0 }] });
  assert.deepStrictEqual(r.calls, ['a']);
  assert.strictEqual(r.out[0].status, 'unknown');
  // 429 three times: gives up after 2 retries, default wait 10 s
  r = await run(['a'], { a: [{ status: 429 }, { status: 429 }, { status: 429 }] });
  assert.strictEqual(r.calls.length, 3);
  assert.strictEqual(r.out[0].status, 'failed');
  assert.ok(r.waits.includes(10000));
  // 401 stops the series; 403 only fails its own line
  r = await run(['a', 'b'], { a: [{ status: 401 }], b: [{ status: 201, id: '2' }] });
  assert.deepStrictEqual(r.calls, ['a']);
  assert.deepStrictEqual(r.out.map(x => x.status), ['failed', 'skipped']);
  assert.strictEqual(r.out[0].error, 'policyImport.err.expired');
  r = await run(['a', 'b'], { a: [{ status: 403, message: 'role' }], b: [{ status: 201, id: '2' }] });
  assert.deepStrictEqual(r.out.map(x => x.status), ['failed', 'created']);
  // What the post says about the assignment stays on the line
  r = await run(['a'], { a: [{ status: 201, id: '1', assign: { status: 'failed', error: 'x' } }] });
  assert.deepStrictEqual(r.out[0].assign, { status: 'failed', error: 'x' });
  // Last guard: an entry without a body is never sent
  const calls = [];
  const out = await L.runImport([{ kind: 'sc', name: 'x', body: null }], async e => { calls.push(e); return { status: 201 }; }, { pause: async () => {} });
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(out[0].status, 'skipped');
  // A post that throws counts as a network error
  const thrown = await L.runImport([entry('a')], async () => { throw new Error('x'); }, { pause: async () => {} });
  assert.strictEqual(thrown[0].status, 'unknown');
  // Progress after each line
  const seen = [];
  await L.runImport([entry('a'), entry('b')], async () => ({ status: 201 }), { pause: async () => {}, onProgress: (i, res) => seen.push([i, res.status]) });
  assert.deepStrictEqual(seen, [[0, 'created'], [1, 'created']]);

  // i18n: same keys in both languages, every key used by the code exists
  let dict;
  globalThis.__tenantCompassI18n = { add: d => { dict = d; } };
  require('./i18n.js');
  assert.deepStrictEqual(Object.keys(dict.fr).sort(), Object.keys(dict.en).sort());
  for (const k of new Set(fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8').match(/policyImport\.[a-zA-Z.]+/g))) assert.ok(dict.fr[k], 'missing ' + k);

  // Opt-in: off by default in both copies of DEFAULTS, and registered for the Intune portal only
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['background.js', 'popup.js']) assert.match(read(f), /const DEFAULTS = \{[^}]*policyImport: false/, f);
  // Optional assignment: a group, All users or All devices, no filter
  assert.match(read('policy-import/page.js'), /__tenantCompassAssignForm\(\{[^}]*builtIn: true, filters: false/);
  const registration = /policyImport: \[\{[\s\S]*?\}\],/.exec(read('background.js'))?.[0] || '';
  assert.match(registration, /'policy-import\/lib\.js', 'policy-import\/page\.js'\]/);
  assert.match(registration, /world: 'MAIN'/);
  assert.ok(!/portal\.azure\.com|entra\.microsoft\.com/.test(registration), 'Intune console only');
  for (const k of ['f.policyImport', 'f.policyImport.desc']) assert.strictEqual((read('shared/i18n.js').match(new RegExp(`'${k}':`, 'g')) || []).length, 2, k);

  // Static checks of the page script: a single creation call, no token leak
  const pageSrc = fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8');
  assert.ok(!/'(PATCH|PUT|DELETE)'/.test(pageSrc), 'only POST may write');
  assert.strictEqual((pageSrc.match(/method: 'POST'/g) || []).length, 1, 'one single write call');
  assert.ok(!/console\.|chrome\.storage|localStorage|innerHTML|\$batch/.test(pageSrc));
  assert.ok(/credentials: 'omit'/.test(pageSrc));
  assert.ok(/window\.fetch\(/.test(pageSrc), 'must go through window.fetch so Change Snapshot sees it');
  assert.ok(!/nativeFetch/.test(pageSrc));
  assert.ok(!/\/assign\b/.test(pageSrc), 'never assigns');
  assert.ok(!/id: m\.id, \.\.\./.test(pageSrc), 'the created object id must not overwrite the correlation id of the relay');
  assert.ok(!/method: 'POST'/.test(read('as-built/page.js')), 'As-Built stays read-only');
  for (const k of new Set(pageSrc.match(/policyImport\.[a-zA-Z.]+/g) || [])) assert.ok(dict.fr[k], 'missing ' + k);

  // Change Snapshot logs each creation without opening one ticket card per object
  assert.ok(/tenantCompassSilent: true/.test(pageSrc));
  assert.ok(/init\.tenantCompassSilent/.test(read('change-snapshot/page.js')));
  assert.ok(/!p\.silent/.test(read('change-snapshot/content.js')));

  console.log('policy-import: all checks passed');
})().catch(err => { console.error(err); process.exit(1); });
