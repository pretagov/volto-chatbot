import { describe, it, expect } from 'vitest';
import { mintToken, verifyToken, originAllowed } from './session.js';

const SECRET = 'test-secret';

describe('session tokens', () => {
  it('round-trips a tenant-bound token', () => {
    const token = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(token, 'lecc', SECRET).valid).toBe(true);
  });

  it('rejects a token minted for another tenant', () => {
    // The token is the only thing standing between one tenant's endpoint and
    // another's, so cross-tenant reuse must fail.
    const token = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(token, 'bathnes', SECRET).valid).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(`${token.slice(0, -2)}xx`, 'lecc', SECRET).valid).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintToken('lecc', 'other-secret', 3600);
    expect(verifyToken(token, 'lecc', SECRET).valid).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of [undefined, null, '', 'nonsense', 'a.b']) {
      expect(verifyToken(bad, 'lecc', SECRET).valid).toBe(false);
    }
  });

  it('reports expiry separately from signature validity', () => {
    // The re-mint endpoint accepts an expired but validly signed token and
    // refuses everything else, so it must be able to tell these apart.
    const token = mintToken('lecc', SECRET, -1);
    const result = verifyToken(token, 'lecc', SECRET);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.sameTenant).toBe(true);
  });
});

describe('originAllowed', () => {
  it('allows a listed origin', () => {
    expect(originAllowed('https://lecc.test/page', ['https://lecc.test'])).toBe(true);
  });

  it('rejects an unlisted origin', () => {
    expect(originAllowed('https://evil.test/', ['https://lecc.test'])).toBe(false);
  });

  it('allows a missing referer, because the check is only advisory', () => {
    // Sec-Fetch-Site never names the origin and a page can suppress Referer with
    // Referrer-Policy: no-referrer. Rejecting would break legitimate tenants, so
    // frame-ancestors is the control that actually holds.
    expect(originAllowed(undefined, ['https://lecc.test'])).toBe(true);
  });

  it('allows an unparseable referer rather than breaking the tenant', () => {
    expect(originAllowed('not-a-url', ['https://lecc.test'])).toBe(true);
  });

  it('matches on origin, not on a prefix of the string', () => {
    // https://lecc.test.evil.test must not pass because it starts with the
    // allowed origin.
    expect(originAllowed('https://lecc.test.evil.test/', ['https://lecc.test'])).toBe(false);
  });
});
