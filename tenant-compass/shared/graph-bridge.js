// MAIN world, shared by Policy Import, Bulk Assignment, Scope Tags Clean up and Assignment Search (reads only). Each one calls the factory once.
// Every frame: observes the bearer token the portal sends to graph.microsoft.com (memory only) and runs closed operations.
// Top frame: finds the frame holding a token and relays calls to it. Messages carry an operation name, never a URL or a token.
(() => {
  if (window.__tenantCompassGraphBridge) return;
  const T = (k, v) => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k, v) : k);
  const UI_ORIGINS = ['https://intune.microsoft.com', 'https://endpoint.microsoft.com'];
  const FRAME_ORIGIN = /^https:\/\/((intune|endpoint)\.microsoft\.com|([\w-]+\.)*portal\.azure\.net)$/;
  const isTop = window === window.top;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function allFrames(w = window, out = []) {
    for (let i = 0; i < w.length; i++) { out.push(w[i]); allFrames(w[i], out); }
    return out;
  }

  // channel: message field of the feature. info(token): { tid, kinds }. ops: { name: (token, kind, args) => result }.
  // Returns null outside the top frame of a console: there the bridge only serves the top frame.
  function bridge({ channel, info, jwtsIn, ops }) {
    const tokens = new Map(); // type -> token: never persisted, never logged, never posted to another frame
    const keep = t => { for (const k of info(t).kinds) tokens.set(k, t); };
    const grab = (url, auth) => {
      try {
        if (!auth || !/^Bearer\s+\S/i.test(auth) || new URL(url, location.href).origin !== 'https://graph.microsoft.com') return;
        keep(auth.replace(/^Bearer\s+/i, ''));
      } catch {}
    };

    // The shell hands tokens to its extension Web⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ Worker over MessagePort: read them on the way.
    if (isTop) for (const P of [MessagePort.prototype, Worker.prototype]) {
      const send = P.postMessage;
      P.postMessage = function (data) {
        try { jwtsIn(data).forEach(keep); } catch {}
        return send.apply(this, arguments);
      };
    }

    const prevFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const req = input instanceof Request ? input : null;
        grab(req ? req.url : String(input), new Headers(init?.headers || req?.headers).get('authorization'));
      } catch {}
      return prevFetch.apply(this, arguments);
    };

    const xhrUrl = new WeakMap();
    const { open, setRequestHeader } = XMLHttpRequest.prototype;
    XMLHttpRequest.prototype.open = function (method, url) {
      xhrUrl.set(this, String(url));
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (/^authorization$/i.test(name)) grab(xhrUrl.get(this), value);
      return setRequestHeader.apply(this, arguments);
    };

    // Types this frame can serve, with their tenant ID: all that⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ ever leaves a frame, never the token.
    function ownKinds() {
      const out = {};
      for (const [k, t] of tokens) {
        const i = info(t);
        if (i.tid && i.kinds.includes(k)) out[k] = i.tid;
      }
      return out;
    }

    // args.tid: a write must still run with a token of the tenant the user confirmed.
    async function run(op, kind, args = {}) {
      const token = tokens.get(kind);
      if (!Object.hasOwn(ops, op) || !token) return { status: 403, message: T('assignForm.noToken') };
      if (args.tid && info(token).tid !== args.tid) return { status: 403, message: T('assignForm.tenantChanged') };
      return ops[op](token, kind, args);
    }

    if (!isTop) {
      window.addEventListener('message', async e => {
        const m = e.data;
        if (!m || typeof m[channel] !== 'string' || e.source !== window.top || !UI_ORIGINS.includes(e.origin)) return;
        if (m[channel] === 'ping') {
          const kinds = ownKinds();
          if (Object.keys(kinds).length) e.source.postMessage({ [channel]: 'pong', kinds }, e.origin);
          return;
        }
        if (m[channel] !== 'call' || typeof m.op !== 'string') return;
        // res has its own fields, such as the id of a created object: it stays apart from the correlation id.
        e.source.postMessage({ [channel]: 'res', id: m.id, res: await run(m.op, m.kind, m.args) }, e.origin);
      });
      return null;
    }
    if (!UI_ORIGINS.includes(location.origin)) return null;

    const routes = new Map(); // type -> { tid, win, origin }, no win: this frame holds the token
    const pending = new Map();
    let seq = 0;

    window.addEventListener('message', e => {
      const m = e.data;
      if (!m || typeof m[channel] !== 'string' || e.source === window || !FRAME_ORIGIN.test(e.origin)) return;
      if (m[channel] === 'pong' && m.kinds && typeof m.kinds === 'object') {
        for (const [k, tid] of Object.entries(m.kinds)) if (typeof tid === 'string' && !routes.has(k)) routes.set(k, { tid, win: e.source, origin: e.origin });
      }
      if (m[channel] === 'res' && pending.get(m.id)?.win === e.source) { pending.get(m.id).done(m.res); pending.delete(m.id); }
    });

    return {
      reset: () => routes.clear(),
      async discover() {
        for (const [k, tid] of Object.entries(ownKinds())) routes.set(k, { tid });
        for (const f of allFrames()) f.postMessage({ [channel]: 'ping' }, '*');
        await sleep(400);
      },
      // Types of the first tenant found. A token of another tenant in the page is ignored, and refused by run().
      tenantNow() {
        const first = routes.values().next().value;
        return first ? { tid: first.tid, kinds: [...routes].filter(([, r]) => r.tid === first.tid).map(([k]) => k) } : null;
      },
      call(op, kind, args = {}) {
        const route = routes.get(kind);
        if (!route) return Promise.resolve({ status: 403, message: T('assignForm.noToken') });
        if (!route.win) return run(op, kind, args);
        const id = ++seq;
        return new Promise(resolve => {
          const t = setTimeout(() => { pending.delete(id); resolve({ status: 0 }); }, 60000); // a write may have left: "unknown"
          pending.set(id, { win: route.win, done: res => { clearTimeout(t); resolve(res || { status: 0 }); } });
          route.win.postMessage({ [channel]: 'call', id, op, kind, args }, route.origin);
        });
      },
    };
  }

  // ---------- operations of the assignment form and of Bulk Assignment ----------

  // window.fetch is read at call time, so Change Snapshot logs each write. tenantCompassSilent: no ticket card per object.
  async function request(url, init) {
    if (!url) return { status: 403 };
    try {
      const r = await window.fetch(url, { credentials: 'omit', ...init });
      const body = await r.json().catch(() => null);
      return { status: r.status, body, message: body?.error?.message, retryAfter: Number(r.headers.get('retry-after')) || 0 };
    } catch { return { status: 0 }; }
  }
  const read = (url, token) => request(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  const write = (url, token, method, body) => request(url, { method, tenantCompassSilent: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // A whole list, nextLink followed on Graph only. Anything else fails: a partial list cannot be trusted.
  async function readAll(url, token) {
    const value = [];
    for (let next = url; next;) {
      const r = await read(next, token);
      if (r.status < 200 || r.status >= 300) return r;
      value.push(...(r.body?.value || []));
      next = r.body?.['@odata.nextLink'] || null;
      if (next && !String(next).startsWith('https://graph.microsoft.com/')) return { status: 0 };
    }
    return { status: 200, body: { value } };
  }

  bridge.read = read;
  bridge.readAll = readAll;
  bridge.assignOps = A => ({
    tags: token => readAll(A.TAGS_URL, token),
    filters: token => readAll(A.FILTERS_URL, token),
    groups: (token, kind, { q }) => read(A.groupsUrl(q), token),
    existing: (token, kind, { id }) => read(A.existingUrl(kind, id), token),
    policy: (token, kind, { id }) => read(A.policyUrl(kind, id), token),
    assign: (token, kind, { id, body }) => write(A.assignUrl(kind, id), token, 'POST', body),
    patchTags: (token, kind, { id, body }) => write(A.policyUrl(kind, id), token, 'PATCH', body),
  });

  window.__tenantCompassGraphBridge = bridge;
})();
