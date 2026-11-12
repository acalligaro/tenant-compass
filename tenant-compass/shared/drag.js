// MAIN world, shared by As-Built and Assignment Lens (same window): drag a fixed element by a handle.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
// Position remembered per key in the portal's localStorage. Call after the element is in the DOM.
(() => {
  // One panel at a time (As-Built, Assignment Lens): opening one closes the others in this page.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
  // __tenantCompassExclusive(id, close) registers `close` and returns opened(), to call when panel `id` opens.
  // A pinned panel stays open: __tenantCompassPin(id) gives the pin button of its head (pin kept for the page's life).
  // __tenantCompassLayer(id, host): the panel opened or clicked last comes above the other Tenant Compass panels.
  if (!window.__tenantCompassExclusive) {
    const EVT = 'tenant-compass:panel-open', pinned = new Set(), hosts = new Map();
    const T = k => (globalThis.__tenantCompassI18n ? globalThis.__tenantCompassI18n.t(k) : k);
    globalThis.__tenantCompassI18n?.add({
      fr: { 'panel.pin': 'Épingler : la fenêtre reste ouverte quand un autre module s\'ouvre', 'panel.unpin': 'Désépingler' },
      en: { 'panel.pin': 'Pin: the window stays open when another module opens', 'panel.unpin': 'Unpin' },
    });
    // Each host is its own stacking context: a panel stays under its own dialogs, and one host above the others.
    const front = id => { for (const [k, h] of hosts) h.style.zIndex = k === id ? '2147483001' : '2147483000'; };
    window.__tenantCompassLayer = (id, host) => {
      hosts.set(id, host);
      Object.assign(host.style, { position: 'relative', zIndex: '2147483000' });
      host.addEventListener('pointerdown', () => front(id), true);
    };
    window.__tenantCompassExclusive = (id, close) => {
      window.addEventListener(EVT, e => { if (e.detail !== id && !pinned.has(id)) close(); });
      return () => { front(id); window.dispatchEvent(new CustomEvent(EVT, { detail: id })); };
    };
    window.__tenantCompassPin = id => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'x'; // round button of the panel heads
      b.textContent = '📌';
      const show = () => {
        const on = pinned.has(id);
        b.title = T(on ? 'panel.unpin' : 'panel.pin');
        b.setAttribute('aria-label', b.title);
        b.setAttribute('aria-pressed', String(on));
        Object.assign(b.style, { opacity: on ? '1' : '.6', boxShadow: on ? 'inset 0 0 0 2px #fff' : 'none' });
      };
      b.onclick = () => { if (!pinned.delete(id)) pinned.add(id); show(); };
      show();
      return b;
    };
  }
  if (window.__tenantCompassDrag) return;
  const KEY = 'tenant-compass:pos:';

  function place(el, x, y) {
    const r = el.getBoundingClientRect();
    x = Math.min(Math.max(0, x), innerWidth - r.width);
    y = Math.min(Math.max(0, y), innerHeight - r.height);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
  }

  window.__tenantCompassDrag = (el, handle, key) => {
    // ponytail: a later window shrink can leave it partly off-screen until the next resize of the element or drag.
    try { const p = JSON.parse(localStorage.getItem(KEY + key)); if (p) place(el, p.x, p.y); } catch {}
    // A placed panel grows as its content loads (groups, members): keep it on screen, not under the buttons below it.
    new ResizeObserver(() => { if (el.isConnected && el.style.top) place(el, parseFloat(el.style.left), parseFloat(el.style.top)); }).observe(el);
    handle.style.cursor = 'move';
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', e => {
      // Inner buttons (close, refresh…) keep their click; the handle itself may be a button (floating button).
      if (e.button !== 0 || (e.target !== handle && e.target.closest && e.target.closest('button'))) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return; // below 4 px it is a click
        moved = true;
        place(el, ev.clientX - dx, ev.clientY - dy);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (!moved) return;
        const p = el.getBoundingClientRect();
        try { localStorage.setItem(KEY + key, JSON.stringify({ x: Math.round(p.left), y: Math.round(p.top) })); } catch {}
        // A drag must not also toggle the panel: swallow the click that follows pointerup.⁣​​‌​‌​​​​​​‌​​‌​‍​⁣
        const swallow = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
        handle.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => handle.removeEventListener('click', swallow, { capture: true }), 0);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  };
})();
