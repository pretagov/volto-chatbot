import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAuthHeaders, parseLoginResponse, __resetCache } from './onyxAuth.js';

beforeEach(() => __resetCache());

describe('getAuthHeaders', () => {
  it('uses the api key when one is configured, without logging in', async () => {
    const login = vi.fn();
    const headers = await getAuthHeaders({ apiKey: 'k' }, login);
    expect(headers.Authorization).toBe('Bearer k');
    expect(login).not.toHaveBeenCalled();
  });

  it('logs in once and reuses the cached cookie', async () => {
    const login = vi.fn().mockResolvedValue({ cookie: 'session=abc', maxAge: 3600 });
    const creds = { username: 'u', password: 'p' };
    await getAuthHeaders(creds, login);
    const headers = await getAuthHeaders(creds, login);
    expect(login).toHaveBeenCalledTimes(1);
    expect(headers.Cookie).toBe('session=abc');
  });

  it('logs in again once the cached cookie has expired', async () => {
    const login = vi.fn().mockResolvedValue({ cookie: 'session=abc', maxAge: 0 });
    const creds = { username: 'u', password: 'p' };
    await getAuthHeaders(creds, login);
    await getAuthHeaders(creds, login);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('throws when neither an api key nor credentials are configured', async () => {
    await expect(getAuthHeaders({}, vi.fn())).rejects.toThrow(/configuration/i);
  });

  it('sends no credentials when anonymous access is explicitly enabled', async () => {
    // Onyx resolves an unauthenticated caller to its anonymous user, whose ACL is
    // exactly {PUBLIC} — which is the whole point: the widget serves public
    // content and should hold no identity beyond that.
    const login = vi.fn();
    const headers = await getAuthHeaders({ anonymous: true }, login);
    expect(headers).toEqual({});
    expect(login).not.toHaveBeenCalled();
  });

  it('refuses to combine anonymous access with credentials', async () => {
    // Silently preferring one over the other would make it impossible to tell
    // which identity the widget is actually running as. Fail loudly instead.
    await expect(getAuthHeaders({ anonymous: true, apiKey: 'k' }, vi.fn())).rejects.toThrow(
      /anonymous/i,
    );
  });

  it('still throws on an empty config rather than silently going anonymous', async () => {
    // Anonymous has to be asked for. A missing api key is a misconfiguration, and
    // quietly downgrading it to public access would hide that.
    await expect(getAuthHeaders({}, vi.fn())).rejects.toThrow(/configuration/i);
  });

  it('never returns the raw credentials in the headers', async () => {
    // The whole reason this proxy exists is to keep Onyx credentials out of the
    // browser, so what it hands back must not contain them.
    const login = vi.fn().mockResolvedValue({ cookie: 'session=abc', maxAge: 3600 });
    const headers = await getAuthHeaders({ username: 'u', password: 'hunter2' }, login);
    expect(JSON.stringify(headers)).not.toContain('hunter2');
  });
});

describe('parseLoginResponse', () => {
  it('takes the cookie value and Max-Age from a set-cookie header', () => {
    const parsed = parseLoginResponse({
      headers: { 'set-cookie': ['fastapiusersauth=tok; Max-Age=7200; Path=/; HttpOnly'] },
    });
    expect(parsed.cookie).toBe('fastapiusersauth=tok');
    expect(parsed.maxAge).toBe(7200);
  });

  it('falls back to an hour when Max-Age is absent', () => {
    const parsed = parseLoginResponse({
      headers: { 'set-cookie': ['fastapiusersauth=tok; Path=/'] },
    });
    expect(parsed.maxAge).toBe(3600);
  });

  it('throws a clear error when Onyx returns no cookie', () => {
    expect(() => parseLoginResponse({ headers: {} })).toThrow(/cookie/i);
  });
});
