import { toWidgetConfig } from './contract.js';
import { mintToken, verifyToken, originAllowed } from './session.js';
import { admitTurn } from './metering.js';
import { resolveOnyxPath, pinTenantFields, forwardToOnyx } from './proxy.js';
import { getAuthHeaders } from './onyxAuth.js';
import { callHalloumi } from './halloumi.js';

const TOKEN_TTL_SECONDS = 60 * 60;

export function registerRoutes(app, deps) {
  const { tenants, secret, redis, onyx, halloumi, renderWidget } = deps;

  async function loadTenant(req, res, next) {
    const tenant = await tenants.get(req.params.tenant);
    if (!tenant) return res.status(404).send({ error: 'unknown tenant' });
    req.tenant = tenant;
    return next();
  }

  function presentedToken(req) {
    return (req.get('authorization') || '').replace(/^Bearer /, '');
  }

  // The embedding origin is only observable here, on the document request: calls
  // from the widget to the proxy are same-origin and carry our own Origin, so an
  // allowlist check there would always pass and be worthless.
  app.get('/w/:tenant', loadTenant, (req, res) => {
    if (!originAllowed(req.get('referer'), req.tenant.allowedOrigins)) {
      return res.status(403).send({ error: 'origin not allowed' });
    }
    const ancestors = ["'self'", ...req.tenant.allowedOrigins].join(' ');
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(
      renderWidget(req.tenant, mintToken(req.tenant.tenantId, secret, TOKEN_TTL_SECONDS)),
    );
  });

  app.get('/w/:tenant/config', loadTenant, (req, res) => res.send(toWidgetConfig(req.tenant)));

  // Re-mint for a panel that outlives its token on a host that never navigates.
  // Never mints from nothing: it requires an expired but validly signed token for
  // the same tenant. frame-ancestors cannot protect a fetch, and the Referer
  // check is advisory, so without that requirement this is a token faucet.
  app.get('/w/:tenant/session', loadTenant, (req, res) => {
    const result = verifyToken(presentedToken(req), req.tenant.tenantId, secret);
    if (!result.signatureValid || !result.sameTenant) {
      return res.status(401).send({ error: 'invalid token' });
    }
    return res.send({ token: mintToken(req.tenant.tenantId, secret, TOKEN_TTL_SECONDS) });
  });

  // The tenant comes from the token, whose signature covers it, rather than from
  // the URL — so a caller cannot claim one tenant while presenting another's.
  async function authenticateProxy(req, res, next) {
    const token = presentedToken(req);
    const claimedTenant = token.split('.')[0];
    if (!claimedTenant) return res.status(401).send({ error: 'unauthenticated' });

    if (!verifyToken(token, claimedTenant, secret).valid) {
      return res.status(401).send({ error: 'unauthenticated' });
    }
    const tenant = await tenants.get(claimedTenant);
    if (!tenant) return res.status(401).send({ error: 'unauthenticated' });

    req.tenant = tenant;
    return next();
  }

  app.all('/_da/*', authenticateProxy, async (req, res) => {
    const onyxPath = resolveOnyxPath(req.url);
    if (!onyxPath) return res.status(403).send({ error: 'path not allowed' });

    if (req.method === 'POST') {
      const admission = await admitTurn(redis, req.tenant, req.get('fly-client-ip') || req.ip);
      if (!admission.admitted) {
        return res.status(429).send({ error: admission.reason });
      }
    }

    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders(onyx)) };
    const body =
      req.method === 'POST' ? JSON.stringify(pinTenantFields(req.body, req.tenant)) : undefined;

    const upstream = await fetch(`${onyx.baseUrl}${onyxPath}`, {
      method: req.method,
      headers,
      body,
    });
    return forwardToOnyx(upstream, res, onyx);
  });

  app.all('/_ha/*', authenticateProxy, async (req, res) => {
    // Grounding is an enhancement, not the answer. If it fails the widget should
    // render the answer without a badge rather than show an error.
    try {
      return res.send(await callHalloumi(req.body, halloumi));
    } catch {
      return res.status(200).send({ error: 'grounding unavailable' });
    }
  });
}
