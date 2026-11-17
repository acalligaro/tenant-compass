// Run:⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ node pim/test.js
const assert = require('node:assert');
const { pimUrl, portalUrl } = require('./lib.js');
const BLADE = 'view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadmigratedroles';
const T = 'BF0A4E50-44D8-4492-B6DE-7CF8C8FDB929';

assert.strictEqual(pimUrl(), `https://portal.azure.com/#${BLADE}`);
assert.strictEqual(pimUrl(['ACALLIGARO.WORK (acalligarometsys.onmicrosoft.com)', T]), `https://portal.azure.com/#@${T.toLowerCase()}/${BLADE}`);
assert.strictEqual(pimUrl(['contoso.onmicrosoft.com']), `https://portal.azure.com/#@contoso.onmicrosoft.com/${BLADE}`);
assert.strictEqual(pimUrl(['Contoso Ltd', 'x/../y']), `https://portal.azure.com/#${BLADE}`); // display names never reach the URL
// Portal shortcuts: same⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ tenant rule; Defender takes a GUID only
const ENTRA = 'view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview';
assert.strictEqual(portalUrl('entra'), `https://portal.azure.com/#${ENTRA}`);
assert.strictEqual(portalUrl('entra', [T]), `https://portal.azure.com/#@${T.toLowerCase()}/${ENTRA}`);
assert.strictEqual(portalUrl('intune'), 'https://intune.microsoft.com/');
assert.strictEqual(portalUrl('intune', ['contoso.onmicrosoft.com']), 'https://intune.microsoft.com/#@contoso.onmicrosoft.com');
assert.strictEqual(portalUrl('defender', [T]), `https://security.microsoft.com/?tid=${T.toLowerCase()}`);
assert.strictEqual(portalUrl('defender', ['contoso.onmicrosoft.com']), 'https://security.microsoft.com/');
assert.strictEqual(portalUrl('intune', ['Contoso Ltd', 'x/../y']), 'https://intune.microsoft.com/');
for (const p of ['', 'purview', '__proto__', undefined]) assert.strictEqual(portalUrl(p, [T]), null);
console.log('pim: all checks passed');
