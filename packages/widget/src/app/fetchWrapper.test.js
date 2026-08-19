import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFetchWrapper } from './fetchWrapper.js';

let calls;
let uninstall;

function fakeFetch(impl) {
  const fn = vi.fn(impl ?? (async () => new Response('ok', { status: 200 })));
  globalThis.fetch = fn;
  return fn;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  if (uninstall) uninstall();
  uninstall = undefined;
});

function headerOf(mockFetch, index = 0) {
  const init = mockFetch.mock.calls[index][1] || {};
  const headers = new Headers(init.headers || {});
  return headers.get('authorization');
}

describe('installFetchWrapper', () => {
  it('attaches the token to /_da/ requests', async () => {
    // The reused components issue bare fetch() calls with no hook for a header,
    // and they cannot be edited, so the wrapper is the only place this can happen.
    const inner = fakeFetch();
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    await fetch('/_da/chat/send-message', { method: 'POST' });
    expect(headerOf(inner)).toBe('Bearer tok');
  });

  it('attaches the token to /_ha/ requests', async () => {
    const inner = fakeFetch();
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    await fetch('/_ha/generate', { method: 'POST' });
    expect(headerOf(inner)).toBe('Bearer tok');
  });

  it('attaches nothing to unrelated requests', async () => {
    const inner = fakeFetch();
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    await fetch('/some/other/thing');
    expect(headerOf(inner)).toBeNull();
  });

  it('leaves existing headers in place', async () => {
    const inner = fakeFetch();
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    await fetch('/_da/chat/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const headers = new Headers(inner.mock.calls[0][1].headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer tok');
  });

  it('returns the Response untouched, so streaming stays incremental', async () => {
    // If the wrapper read or cloned the body, answers would stop rendering token
    // by token and appear all at once.
    const original = new Response('streamed', { status: 200 });
    fakeFetch(async () => original);
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    const result = await fetch('/_da/chat/send-message', { method: 'POST' });
    expect(result).toBe(original);
    expect(result.bodyUsed).toBe(false);
  });

  it('forwards init.signal', async () => {
    // Without this the middleware's abort behaviour cannot be exercised at all.
    const inner = fakeFetch();
    uninstall = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    const controller = new AbortController();
    await fetch('/_da/chat/send-message', { method: 'POST', signal: controller.signal });
    expect(inner.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('re-mints once on a 401 and retries', async () => {
    let attempt = 0;
    const inner = fakeFetch(async (url) => {
      if (String(url).includes('/session')) {
        return new Response(JSON.stringify({ token: 'fresh' }), { status: 200 });
      }
      attempt += 1;
      return new Response('', { status: attempt === 1 ? 401 : 200 });
    });

    let token = 'stale';
    uninstall = installFetchWrapper({
      getToken: () => token,
      setToken: (t) => {
        token = t;
      },
      tenant: 'lecc',
    });

    const res = await fetch('/_da/chat/send-message', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(token).toBe('fresh');
    expect(inner.mock.calls.some(([u]) => String(u).includes('/w/lecc/session'))).toBe(true);
  });

  it('surfaces a second 401 rather than looping', async () => {
    const inner = fakeFetch(async (url) =>
      String(url).includes('/session')
        ? new Response(JSON.stringify({ token: 'fresh' }), { status: 200 })
        : new Response('', { status: 401 }),
    );
    uninstall = installFetchWrapper({ getToken: () => 't', setToken: () => {}, tenant: 'lecc' });
    const res = await fetch('/_da/chat/send-message', { method: 'POST' });
    expect(res.status).toBe(401);
    // One original call, one re-mint, one retry — and then it stops.
    expect(inner.mock.calls.length).toBe(3);
  });

  it('gives up quietly when re-minting itself fails', async () => {
    fakeFetch(async (url) =>
      String(url).includes('/session')
        ? new Response('', { status: 401 })
        : new Response('', { status: 401 }),
    );
    uninstall = installFetchWrapper({ getToken: () => 't', setToken: () => {}, tenant: 'lecc' });
    const res = await fetch('/_da/chat/send-message', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('restores the original fetch when uninstalled', async () => {
    const inner = fakeFetch();
    const stop = installFetchWrapper({ getToken: () => 'tok', tenant: 'lecc' });
    stop();
    expect(globalThis.fetch).toBe(inner);
  });
});
