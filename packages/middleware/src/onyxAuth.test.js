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
