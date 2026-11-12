// Run: node shared/test.js
// shared/drag.js: one panel at a time,⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ except the pinned ones; the panel opened or clicked last comes to front.
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const win = new EventTarget();
const element = () => {
  const attrs = {}, listeners = {};
  return { style: {}, setAttribute: (k, v) => (attrs[k] = v), attrs, addEventListener: (t, fn) => (listeners[t] = fn), fire: t => listeners[t]() };
};
const dict = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'drag.js'), 'utf8'), {
  window: win, CustomEvent, document: { createElement: element },
  __tenantCompassI18n: { add: d => Object.assign(dict, d.fr), t: k => dict[k] || k },
});

const closed = [];
const openA = win.__tenantCompassExclusive('a', () => closed.push('a'));
const openB = win.__tenantCompassExclusive('b', () => closed.push('b'));
const hostA = element(), hostB = element();
win.__tenantCompassLayer('a', hostA);
win.__tenantCompassLayer('b', hostB);
assert.strictEqual(hostA.style.position, 'relative');

// Not pinned: opening B closes A, and B is in front
openB();
assert.deepStrictEqual(closed, ['a']);
assert.deepStrictEqual([hostA.style.zIndex, hostB.style.zIndex], ['2147483000', '2147483001']);

// Pinned: A stays open when B opens; a click in A brings it back⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ to front
const pinA = win.__tenantCompassPin('a');
assert.strictEqual(pinA.attrs['aria-pressed'], 'false');
pinA.onclick();
assert.strictEqual(pinA.attrs['aria-pressed'], 'true');
assert.strictEqual(pinA.title, dict['panel.unpin']);
closed.length = 0;
openB();
assert.deepStrictEqual(closed, []);
hostA.fire('pointerdown');
assert.deepStrictEqual([hostA.style.zIndex, hostB.style.zIndex], ['2147483001', '2147483000']);

// The pin outlives the panel: a new button for A shows it pinned. Unpinned, A closes again.
const again = win.__tenantCompassPin('a');
assert.strictEqual(again.attrs['aria-pressed'], 'true');
again.onclick();
openB();
assert.deepStrictEqual(closed, ['a']);

// A pinned panel does not protect the others: B, not pinned, closes when A opens
closed.length = 0;
openA();
assert.deepStrictEqual(closed, ['b']);

console.log('shared: all checks passed');
