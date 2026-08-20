import { readFileSync } from 'node:fs';

// Serves the built widget, rather than HTML written here. The bundle is produced
// by the widget package's Vite build, which hashes its asset names, so the only
// reliable way to reference them is to serve its index.html and add what the
// page needs on top.

// JSON.stringify escapes quotes but not "</script>", which would close the
// inline script and let the rest of the value be parsed as markup. Escaping the
// angle bracket keeps the value a string in every case.
function embed(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function injectBootstrap(template, tenant, token) {
  // The reused chat components issue bare fetch() calls with no hook for a
  // header, so the token has to be on window before they run.
  const bootstrap =
    '<script>' +
    `window.__CHAT_TOKEN__=${embed(token)};` +
    `window.__CHAT_TENANT__=${embed(tenant.tenantId)};` +
    '</script>';

  // Goes ahead of the first script rather than at the end of head. Today the
  // bundle is type=module and therefore deferred, so either position would work
  // — but that is a property of how the widget happens to be built, and a build
  // change emitting a classic script would silently reorder these.
  const firstScript = template.indexOf('<script');
  if (firstScript !== -1) {
    return template.slice(0, firstScript) + bootstrap + template.slice(firstScript);
  }

  return template.replace('</head>', `${bootstrap}</head>`);
}

export function createWidgetRenderer(indexHtmlPath) {
  // Read once at boot: if the build output is missing this should fail on
  // startup, not on a visitor's first request.
  const template = readFileSync(indexHtmlPath, 'utf8');
  return (tenant, token) => injectBootstrap(template, tenant, token);
}
