// Attaches the session token to proxy calls.
//
// This exists because the reused components issue bare fetch() calls —
// lib.js for health, session creation, feedback and send-message, and
// useQualityMarkers.js for grounding — with no hook for a header, and those files
// must not be edited or the merge strategy collapses.
//
// A cookie would have been the obvious alternative and does not work: the widget
// runs in an iframe on someone else's site, making it a third-party cookie, which
// Safari blocks outright and Chrome is removing. It would fail in exactly the
// embedded case the product exists for.

const PROXY_PREFIXES = ['/_da/', '/_ha/'];

function isProxyRequest(input) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  // Match on path so an absolute same-origin URL still qualifies. This is also
  // why rewakeUrl must be seeded as a path, not an absolute URL.
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  return PROXY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function withToken(init, token) {
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function installFetchWrapper({ getToken, setToken, tenant }) {
  // Keep both: the raw reference so uninstall restores exactly what was there,
  // and a bound copy to call with, since fetch must be invoked on globalThis.
  const rawFetch = globalThis.fetch;
  const originalFetch = rawFetch.bind(globalThis);

  async function remint() {
    const response = await originalFetch(`/w/${tenant}/session`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) return null;
    const { token } = await response.json();
    if (token && setToken) setToken(token);
    return token;
  }

  globalThis.fetch = async function wrappedFetch(input, init) {
    if (!isProxyRequest(input)) return originalFetch(input, init);

    // Returned as-is: reading or cloning the body here would break incremental
    // streaming, and init is spread so signal and the rest pass through.
    const response = await originalFetch(input, withToken(init, getToken()));
    if (response.status !== 401) return response;

    const fresh = await remint();
    if (!fresh) return response;

    // Exactly one retry. A second 401 surfaces rather than looping.
    return originalFetch(input, withToken(init, fresh));
  };

  return function uninstall() {
    globalThis.fetch = rawFetch;
  };
}
