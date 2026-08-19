import crypto from 'node:crypto';

// Tenant-bound session tokens. The tenant key sits in a public script tag and is
// not a secret, so the token — minted only after the embedding-origin check on
// the widget document — is what proxy calls actually present.

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function mintToken(tenantId, secret, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${tenantId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Returns signatureValid and expired separately so the re-mint endpoint can
// accept an expired token that is still validly signed, and refuse everything
// else. Minting from nothing would make that endpoint a token faucet.
export function verifyToken(token, tenantId, secret) {
  const invalid = { valid: false, signatureValid: false, expired: false, sameTenant: false };

  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return invalid;

  const [tid, exp, mac] = parts;
  if (!tid || !/^\d+$/.test(exp)) return invalid;

  const expected = sign(`${tid}.${exp}`, secret);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  const signatureValid =
    macBuf.length === expectedBuf.length && crypto.timingSafeEqual(macBuf, expectedBuf);

  const expired = Number(exp) < Math.floor(Date.now() / 1000);
  const sameTenant = tid === tenantId;

  return { valid: signatureValid && sameTenant && !expired, signatureValid, expired, sameTenant };
}

// Advisory. Sec-Fetch-Site reports only same-site/cross-site, never which site,
// so this rests on Referer — which an embedding page can suppress with
// Referrer-Policy: no-referrer. An absent or unparseable Referer therefore
// passes, because rejecting would break legitimate tenants. frame-ancestors is
// the control that still holds when this one cannot.
export function originAllowed(referer, allowedOrigins) {
  if (!referer) return true;
  let origin;
  try {
    origin = new URL(referer).origin;
  } catch {
    return true;
  }
  return allowedOrigins.includes(origin);
}
