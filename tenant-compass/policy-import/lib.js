// Pure helpers of Policy Import: read As-Built JSON exports, build the creation requests, run them. No DOM, no network.
// The file is untrusted input: it never chooses a URL, and a request body only keeps what the rules below let through.
(() => {
  const GRAPH = 'https://graph.microsoft.com/beta/deviceManagement/';
  const G = '#microsoft.graph.';
  const MAX_FILE_BYTES = 52428800, MAX_ENTRIES = 500, PAUSE_MS = 250, MAX_RETRIES = 2, DEFAULT_WAIT_S = 10;
  const CONFIG = 'DeviceManagementConfiguration.ReadWrite.All', SCRIPTS = 'DeviceManagementScripts.ReadWrite.All';

  // Importable types: As-Built JSON type, Graph collection, name property, write scope (Graph permissions reference, 2026-11-05).
  const KINDS = new Map([
    ['sc', { type: 'settingsCatalog', path: 'configurationPolicies', name: 'name', scope: CONFIG }],
    ['dc', { type: 'deviceConfiguration', path: 'deviceConfigurations', name: 'displayName', scope: CONFIG }],
    ['comp', { type: 'compliancePolicy', path: 'deviceCompliancePolicies', name: 'displayName', scope: CONFIG }],
    ['ps', { type: 'deviceManagementScript', path: 'deviceManagementScripts', name: 'displayName', scope: SCRIPTS }],
    ['sh', { type: 'deviceShellScript', path: 'deviceShellScripts', name: 'displayName', scope: SCRIPTS }],
    ['cattr', { type: 'deviceCustomAttributeShellScript', path: 'deviceCustomAttributeShellScripts', name: 'displayName', scope: SCRIPTS }],
    ['rem', { type: 'deviceHealthScript', path: 'deviceHealthScripts', name: 'displayName', scope: SCRIPTS }],
  ]);
  const KIND_OF_TYPE = new Map([...KINDS].map(([k, v]) => [v.type, k]));

  const endpointFor = kind => (KINDS.has(kind) ? GRAPH + KINDS.get(kind).path : null);
  const nameField = kind => (KINDS.has(kind) ? KINDS.get(kind).name : null);
  const namesUrl = kind => (KINDS.has(kind) ? `${endpointFor(kind)}?$select=id,${nameField(kind)}` : null);

  // ---------- reading a file ----------

  const fail = error => ({ tenantId: null, raw: [], error });
  const asList = v => (Array.isArray(v) ? v : []);

  function parseFile(file, text) {
    let j;
    try { j = JSON.parse(text); } catch { return fail('policyImport.err.notJson'); }
    if (!j || !Array.isArray(j.policies)) return fail('policyImport.err.notAsBuilt');
    if (!j.policies.length) return fail('policyImport.err.empty');
    if (j.policies.length > MAX_ENTRIES) return fail('policyImport.err.tooMany');
    const raw = j.policies.map(item => {
      const e = item && typeof item === 'object' ? item : {};
      const policy = e.policy && typeof e.policy === 'object' ? e.policy : null;
      const name = [policy?.name, policy?.displayName, e.name].find(n => typeof n === 'string' && n) || '';
      return { file, type: String(e.type ?? ''), kind: KIND_OF_TYPE.get(e.type) ?? null, name, policy, settings: asList(e.settings), assignments: asList(e.assignments),
        readError: e.error != null ? String(e.error) : null };
    });
    return { tenantId: typeof j.tenantId === 'string' ? j.tenantId : null, raw, error: null };
  }

  // ---------- building a request body ----------

  const SERVER_KEYS = new Set(['id', 'createdDateTime', 'lastModifiedDateTime', 'version', 'isAssigned', 'assignments', 'supportsScopeTags', 'highestAvailableVersion', 'isGlobalScript', 'settingCount']);
  const POISON = new Set(['__proto__', 'constructor', 'prototype']);
  const SC_KEYS = ['name', 'description', 'platforms', 'technologies', 'roleScopeTagIds', 'templateReference'];
  const SCRIPT_REQUIRED = { ps: 'scriptContent', sh: 'scriptContent', cattr: 'scriptContent', rem: 'detectionScriptContent' };
  // Values masked by As-Built (as-built/i18n.js, asBuilt.value.secret).⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  const MASKS = new Set(['(secret masqué)', '(secret hidden)']);
  // deviceConfigurations whose certificate relation is not in the export (navigation properties, Graph metadata 2026-11-05).
  // ponytail: optional relations (SSO extension PKINIT, Windows privacy controls) are not blocked, only documented as lost.
  const CERT_LINKED = /(?:Scep|ImportedPFX)CertificateProfile$|^(?:android|aosp)\w*Pkcs|EnterpriseWiFi|EnterpriseEAP|WiredNetwork|Vpn|Eas(?:Email|Configuration)|DerivedCredential|Ztdns/i;

  // Deep copy without prototype keys and OData annotations, except the type. Built with fromEntries: nothing is assigned by a file key.
  function clean(v) {
    if (Array.isArray(v)) return v.map(clean);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v)
      .filter(([k]) => !POISON.has(k) && (k === '@odata.type' || !k.includes('@odata.')))
      .map(([k, x]) => [k, clean(x)]));
  }

  // A secret the export cannot carry: creating the object would store the mask, or nothing, as its value.
  function hasSecret(v) {
    if (typeof v === 'string') return MASKS.has(v);
    if (Array.isArray(v)) return v.some(hasSecret);
    if (!v || typeof v !== 'object') return false;
    if (v.isEncrypted === true || v.secretReferenceValueId || /SecretSettingValue$/.test(v['@odata.type'] || '')) return true;
    if ('preSharedKey' in v && !v.preSharedKey && /personal|wep/i.test(v.wiFiSecurityType || v.wifiSecurityType || '')) return true; // Graph answers null
    return Object.values(v).some(hasSecret);
  }

  function settingsCatalogBody(policy, settings) {
    const body = Object.fromEntries(SC_KEYS.filter(k => k in policy).map(k => [k, policy[k]]));
    const { templateId, templateFamily } = policy.templateReference || {};
    if (templateId) body.templateReference = { templateId, templateFamily };
    else delete body.templateReference;
    body.settings = clean(settings).map(s => ({ '@odata.type': G + 'deviceManagementConfigurationSetting', settingInstance: s?.settingInstance }));
    return body;
  }

  // Microsoft requires exactly one block action. Notification templates and their recipients belong to the source tenant.
  function complianceRules(policy, sameTenant, warnings) {
    let rules = asList(policy.scheduledActionsForRule).map(r => ({
      ruleName: r?.ruleName || 'PasswordRequired', // Graph answers null on read
      scheduledActionConfigurations: asList(r?.scheduledActionConfigurations).map(({ id, ...action }) => action),
    }));
    if (!sameTenant) {
      const kept = rules.map(r => ({ ...r, scheduledActionConfigurations: r.scheduledActionConfigurations.filter(a => a.actionType === 'block') }));
      if (kept.some((r, i) => r.scheduledActionConfigurations.length !== rules[i].scheduledActionConfigurations.length)) warnings.push('policyImport.warn.actionsDropped');
      rules = kept;
    }
    if (!rules.some(r => r.scheduledActionConfigurations.some(a => a.actionType === 'block'))) {
      warnings.push('policyImport.warn.blockAdded');
      rules = [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 0, notificationTemplateId: '', notificationMessageCCList: [] }] }];
    }
    return rules;
  }

  // RawEntry -> { file, kind, type, name, body, blockers, warnings, hasScript }. body is null as soon⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ as something blocks the entry.
  function prepare(raw, { sourceTenantId, tenantId }) {
    const blockers = [], warnings = [];
    const done = (body, hasScript = false) => ({ file: raw.file, kind: raw.kind, type: raw.type, name: raw.name, body: blockers.length ? null : body, blockers, warnings, hasScript });
    if (raw.readError) { blockers.push('policyImport.block.readError'); return done(null); }
    if (!KINDS.has(raw.kind)) { blockers.push('policyImport.block.unsupported'); return done(null); }

    const kind = raw.kind, policy = clean(raw.policy || {}), odataType = policy['@odata.type'];
    const sameTenant = !!sourceTenantId && sourceTenantId === tenantId;
    if (!String(raw.name).trim()) blockers.push('policyImport.block.noName');

    let body;
    if (kind === 'sc') {
      if (!raw.settings.length) blockers.push('policyImport.block.noSettings');
      body = settingsCatalogBody(policy, raw.settings);
    } else {
      body = Object.fromEntries(Object.entries(policy).filter(([k]) => !SERVER_KEYS.has(k)));
      if (kind === 'dc' || kind === 'comp') {
        if (typeof odataType !== 'string' || !odataType.startsWith(G)) blockers.push('policyImport.block.badType');
        else if (kind === 'dc' && CERT_LINKED.test(odataType.slice(G.length))) blockers.push('policyImport.block.certLink');
      } else {
        body['@odata.type'] = G + KINDS.get(kind).type; // the file does not choose the type of a script
        if (!body[SCRIPT_REQUIRED[kind]]) blockers.push('policyImport.block.noScript');
      }
    }
    if (hasSecret(body)) blockers.push('policyImport.block.secret');

    if (kind === 'comp') body.scheduledActionsForRule = complianceRules(policy, sameTenant, warnings);
    if (!sameTenant) {
      body.roleScopeTagIds = ['0']; // scope tags belong to the source tenant
      warnings.push('policyImport.warn.crossTenant');
    }
    if (raw.assignments.length) warnings.push('policyImport.warn.assignmentsIgnored');
    return done(body, !!SCRIPT_REQUIRED[kind] && !!body[SCRIPT_REQUIRED[kind]]);
  }

  // ---------- token ----------

  function jwtClaims(token) {
    try {
      const b = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))) || {};
    } catch { return {}; }
  }

  // Tenant and importable types of a token. Expired or other audience: no type. The token itself is not kept or returned.
  function tokenInfo(token, now = Date.now()) {
    const c = jwtClaims(token);
    const usable = /^https:\/\/graph\.microsoft\.com\/?$/.test(c.aud || '') && c.exp * 1000 > now;
    const scopes = usable ? String(c.scp || '').split(/\s+/) : [];
    return { tid: typeof c.tid === 'string' ? c.tid : null, kinds: [...KINDS].filter(([, v]) => scopes.includes(v.scope)).map(([k]) => k) };
  }

  // JWT strings in a message (the shell hands tokens to its extension Web Worker over MessagePort), at most 6 levels deep.
  function jwtsIn(data) {
    const out = [];
    let budget = 2000; // ponytail: caps the walk on big data messages; tokens sit near the top of token replies
    (function walk(v, d) {
      if (d > 6 || v == null || --budget < 0) return;
      if (typeof v === 'string') { const m = /^(?:Bearer\s+)?(eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)$/.exec(v); if (m) out.push(m[1]); return; }
      if (typeof v === 'object' && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer)) for (const k in v) walk(v[k], d + 1);
    })(data, 0);
    return out;
  }

  // ---------- context of the target tenant ----------

  const norm = s => String(s).trim().toLowerCase();

  // Adds `duplicate` (name already in the tenant, or earlier in the selection). A type the token cannot write,
  // or whose names could not be read, is blocked: a replayed import would create duplicates.
  function markDuplicates(entries, namesByKind, writable) {
    const seen = new Set();
    return entries.map(e => {
      if (e.blockers.length) return { ...e, duplicate: false };
      const blocked = !writable.includes(e.kind) ? 'policyImport.block.noScope' : !Array.isArray(namesByKind[e.kind]) ? 'policyImport.block.namesUnread' : null;
      if (blocked) return { ...e, body: null, blockers: [blocked], duplicate: false };
      const key = `${e.kind}/${norm(e.name)}`;
      const duplicate = seen.has(key) || namesByKind[e.kind].some(n => norm(n) === norm(e.name));
      seen.add(key);
      return { ...e, duplicate };
    });
  }

  // Optional prefix, in the name property of the type. Returns a copy: the prefix can still change. The separator is up to the user.
  function applyPrefix(e, prefix) {
    const text = String(prefix || '').trimStart();
    if (!text || !e.body) return e;
    const name = text + e.name;
    return { ...e, name, body: { ...e.body, [nameField(e.kind)]: name } };
  }

  // ---------- running the import ----------

  // Strictly sequential. Only 429 is retried:⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ after a 5xx or a network error the object may exist, so the line says "unknown".
  async function runImport(entries, post, { pause, onProgress = () => {} }) {
    const out = [];
    let stopped = false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], line = { name: e.name, kind: e.kind };
      let res;
      if (stopped || !e.body) res = { ...line, status: 'skipped' };
      else {
        if (i) await pause(PAUSE_MS);
        let r;
        for (let tries = 0; ; tries++) {
          try { r = await post(e); } catch { r = { status: 0 }; }
          if (r.status !== 429 || tries === MAX_RETRIES) break;
          await pause(1000 * (r.retryAfter > 0 ? r.retryAfter : DEFAULT_WAIT_S));
        }
        if (r.status >= 200 && r.status < 300) res = { ...line, status: 'created', id: r.id };
        else if (r.status === 401) { res = { ...line, status: 'failed', error: 'policyImport.err.expired' }; stopped = true; }
        else if (!r.status || r.status >= 500) res = { ...line, status: 'unknown', error: r.message };
        else res = { ...line, status: 'failed', error: r.message || `Graph ${r.status}` };
      }
      out.push(res);
      onProgress(i, res);
    }
    return out;
  }

  const api = { MAX_FILE_BYTES, parseFile, prepare, endpointFor, nameField, namesUrl, tokenInfo, jwtsIn, markDuplicates, applyPrefix, runImport };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.PolicyImportLib = api; // always: a stray `module` global must not hide the lib from the page
})();
