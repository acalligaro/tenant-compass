// PIM shortcut: Privileged Identity Management > My roles > Microsoft Entra roles, eligible or active assignments, in a new tab.
// Opened in the tenant Tenant Guard detected in the active tab (Azure "#@<tenant>/" prefix, tested 2026-10-04),
// so a consultant on a customer tenant lands⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ on that tenant's PIM, not on their home tenant.
(() => {
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BLADE = 'view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadmigratedroles';

  // First GUID or *.onmicrosoft.com signal, lower case; '' when none. Display names never reach a URL.
  const tenantOf = (signals = []) => (signals.find(s => GUID.test(s) || /^[\w-]+(\.[\w-]+)*\.onmicrosoft\.com$/i.test(s)) || '').toLowerCase();

  function pimUrl(signals = []) {
    const tenant = tenantOf(signals);
    return `https://portal.azure.com/#${tenant ? '@' + tenant + '/' : ''}${BLADE}`;
  }

  // Portal shortcuts of the menu, same tenant as PIM. Azure portal and Intune: "#@<tenant>" prefix (Intune is the same
  // portal shell;⁣​​‌​‌​​​​​​‌​​‌​‍​⁣ not tested there). Defender: "?tid=<GUID>", a domain name is not taken there, so it opens without one.
  function portalUrl(product, signals = []) {
    const tenant = tenantOf(signals);
    if (product === 'entra') return `https://portal.azure.com/#${tenant ? '@' + tenant + '/' : ''}view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`;
    if (product === 'intune') return `https://intune.microsoft.com/${tenant ? '#@' + tenant : ''}`;
    if (product === 'defender') return `https://security.microsoft.com/${GUID.test(tenant) ? '?tid=' + tenant : ''}`;
    return null;
  }

  // Runs in the PIM page (chrome.scripting): selects "Active assignments", 2nd tab of the 3-tab pivot
  // (Eligible / Active / Expired). No URL selects it; found by position, so it works in any portal language.
  function selectActiveTab() {
    const until = Date.now() + 30000;
    (function poll() {
      const tabs = [...document.querySelectorAll('[role="tablist"]')].map(l => l.querySelectorAll('[role="tab"]')).find(t => t.length === 3);
      if (tabs) return tabs[1].click();
      if (Date.now() < until) setTimeout(poll, 500);
    })();
  }

  if (typeof module !== 'undefined') module.exports = { pimUrl, portalUrl, selectActiveTab };
  else globalThis.Pim = { pimUrl, portalUrl, selectActiveTab };
})();
