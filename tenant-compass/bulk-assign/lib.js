// Pure helpers of Bulk Assignment: closed list of sources, one line of the run, the whole run. No DOM, no network.
// A line only adds: existing assignments and scope tags are read first and kept. When the read fails, nothing is⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ sent.
(() => {
  const A = globalThis.TenantCompassAssign || require('../shared/assign-lib.js');
  const GRAPH = 'https://graph.microsoft.com/beta/deviceManagement/';
  const PAUSE_MS = 250, MAX_RETRIES = 2, DEFAULT_WAIT_S = 10;
  const FIELDS = '?$select=id,displayName,description,lastModifiedDateTime';

  // Same lists as As-Built, for the types /assign can take without more input.
  const SOURCES = new Map([
    ['sc', 'configurationPolicies'], ['dc', 'deviceConfigurations' + FIELDS], ['comp', 'deviceCompliancePolicies' + FIELDS], ['admx', 'groupPolicyConfigurations'],
    ['ps', 'deviceManagementScripts' + FIELDS], ['sh', 'deviceShellScripts' + FIELDS], ['cattr', 'deviceCustomAttributeShellScripts' + FIELDS],
  ]);
  const listUrl = kind => (SOURCES.has(kind) ? GRAPH + SOURCES.get(kind) : null);

  const ok = r => r.status >= 200 && r.status < 300;

  // Only 429 is⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ retried. pause is optional: a single line in a test does not wait.
  async function withRetry(fn, pause) {
    for (let tries = 0; ; tries++) {
      let r;
      try { r = await fn(); } catch { r = { status: 0 }; }
      if (r.status !== 429 || tries === MAX_RETRIES || !pause) return r;
      await pause(1000 * (r.retryAfter > 0 ? r.retryAfter : DEFAULT_WAIT_S));
    }
  }

  const refused = r => (r.status === 401
    ? { status: 'failed', error: 'bulkAssign.err.expired', expired: true }
    : { status: 'failed', error: r.message || (r.status ? `Graph ${r.status}` : 'bulkAssign.err.network') });

  // After a write left: 5xx or a network failure may hide a success.
  const writeResult = r => (ok(r) ? { status: 'done' } : !r.status || r.status >= 500 ? { status: 'unknown' } : refused(r));

  async function assignLine({ kind, id }, target, tid, call, pause) {
    if (A.hasFilter(target) && !A.supportsFilter(kind)) return { status: 'skipped', error: 'bulkAssign.err.noFilter' }; // without its filter, it would reach more devices than asked
    const read = await withRetry(() => call('existing', kind, { id }), pause);
    if (!ok(read)) return refused(read);
    const list = A.assignmentsIn(kind, read.body);
    if (!list) return { status: 'failed', error: 'bulkAssign.err.partial' };
    const merged = A.mergeTargets(kind, list, target);
    if (merged.already) return { status: 'already' };
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
  async function applyLine(item, { target, tagIds, tid }, call, pause) {
    const out = { assign: null, tags: null };
    if (target) out.assign = await assignLine(item, target, tid, call, pause);
    if (tagIds?.length && !out.assign?.expired) out.tags = await tagsLine(item, tagIds, tid, call, pause);
    return out;
  }

  // Strictly sequential. An expired session stops the series: the next lines say "not sent".
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

  const api = { KINDS: [...SOURCES.keys()], listUrl, applyLine, runBulk };
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api; // node (test.js)
  globalThis.BulkAssignLib = api; // always: a stray `module` global must not hide the lib from the page
})();
