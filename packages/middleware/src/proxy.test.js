import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { resolveOnyxPath, pinTenantFields, ALLOWED_PATHS, forwardToOnyx } from './proxy.js';

describe('resolveOnyxPath', () => {
  it('maps a proxied path onto the Onyx api prefix', () => {
    expect(resolveOnyxPath('/_da/chat/create-chat-session')).toBe('/api/chat/create-chat-session');
  });

  it('allows exactly the paths upgraded Onyx actually serves', () => {
    expect([...ALLOWED_PATHS].sort()).toEqual([
      'chat/create-chat-message-feedback',
      'chat/create-chat-session',
      'chat/send-message',
      'health',
    ]);
  });

  it('maps the old send-message path onto the endpoint that now exists', () => {
    // The frontend still calls send-message and we are deliberately not changing
    // it, so the old name stays the public contract and the rename is internal.
    expect(resolveOnyxPath('/_da/chat/send-message')).toBe('/api/chat/send-chat-message');
  });

  it('serves health from the root, not from under /api', () => {
    // Upgraded Onyx exposes /health at the root; /api/health does not exist, so
    // the rewake ping would 404.
    expect(resolveOnyxPath('/_da/health')).toBe('/health');
  });

  it('preserves a query string on an allowed path', () => {
    expect(resolveOnyxPath('/_da/health?probe=1')).toBe('/health?probe=1');
  });

  it('refuses persona, which is a server-to-server call and not the client’s', () => {
    // The credential check hits /api/persona/-1 from inside login(), never
    // through this proxy, so allowing it here would widen the surface the
    // allowlist exists to narrow.
    expect(resolveOnyxPath('/_da/persona/-1')).toBeNull();
    expect(resolveOnyxPath('/_da/persona?include_deleted=false')).toBeNull();
  });

  it('refuses anything else', () => {
    expect(resolveOnyxPath('/_da/admin/delete-everything')).toBeNull();
    expect(resolveOnyxPath('/_da/')).toBeNull();
    expect(resolveOnyxPath('/_da/chat')).toBeNull();
  });

  it('refuses traversal attempts', () => {
    expect(resolveOnyxPath('/_da/chat/../admin')).toBeNull();
    expect(resolveOnyxPath('/_da/../api/admin')).toBeNull();
  });

  it('refuses an absolute URL smuggled into the path', () => {
    expect(resolveOnyxPath('/_da/http://evil.test/steal')).toBeNull();
  });
});

describe('pinTenantFields', () => {
  const tenant = { assistantId: '7' };

  it('overrides a client-supplied assistant id', () => {
    // The assistant is client config in the reused components, so proxying it
    // unchanged would let one tenant's endpoint drive another's assistant.
    const body = pinTenantFields({ message: 'hi', persona_id: '999' }, tenant);
    expect(body.persona_id).toBe('7');
  });

  it('overrides alternate_assistant_id too', () => {
    const body = pinTenantFields({ alternate_assistant_id: '999' }, tenant);
    expect(body.alternate_assistant_id).toBe('7');
  });

  it('pins the assistant even when the client omits it', () => {
    const body = pinTenantFields({ message: 'hi' }, tenant);
    expect(body.persona_id).toBe('7');
    expect(body.alternate_assistant_id).toBe('7');
  });

  it('leaves the rest of the body alone', () => {
    const body = pinTenantFields({ message: 'hi', chat_session_id: 'abc' }, tenant);
    expect(body.message).toBe('hi');
    expect(body.chat_session_id).toBe('abc');
  });

  it('does not mutate the caller’s object', () => {
    const original = { message: 'hi', persona_id: '999' };
    pinTenantFields(original, tenant);
    expect(original.persona_id).toBe('999');
  });

  it('passes non-object bodies through untouched', () => {
    expect(pinTenantFields(undefined, tenant)).toBeUndefined();
    expect(pinTenantFields('raw', tenant)).toBe('raw');
  });
});

describe('forwardToOnyx', () => {
  // A real Writable: Readable.pipe() calls emit/once on its destination, not
  // just write/on, so an object literal would not work here.
  function collectingResponse() {
    const chunks = [];
    const headers = {};
    const writable = new Writable({
      write(chunk, _enc, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    writable.set = (key, value) => {
      headers[key] = value;
    };
    return { res: writable, chunks, headers };
  }

  function upstreamWith(transferEncoding, contentType, chunks) {
    return {
      headers: {
        get: (name) =>
          ({ 'transfer-encoding': transferEncoding, 'content-type': contentType })[
            String(name).toLowerCase()
          ],
      },
      body: Readable.from(chunks),
    };
  }

  it('pipes the body through rather than buffering it', async () => {
    const { res, chunks } = collectingResponse();
    await forwardToOnyx(upstreamWith('chunked', null, ['a', 'b', 'c']), res, {});
    expect(chunks.join('')).toBe('abc');
  });

  it('arrives incrementally, so tokens can render as they stream', async () => {
    const { res, chunks } = collectingResponse();
    const upstream = upstreamWith('chunked', null, ['first', 'second']);
    const seen = [];
    res.on('pipe', () => seen.push('piped'));
    await forwardToOnyx(upstream, res, {});
    // More than one write means the response was not collected then flushed once.
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('marks a chunked upstream response as an event stream', async () => {
    const { res, headers } = collectingResponse();
    await forwardToOnyx(upstreamWith('chunked', null, ['x']), res, {});
    expect(headers['Content-Type']).toBe('text/event-stream');
  });

  it('marks a non-chunked upstream response as json', async () => {
    const { res, headers } = collectingResponse();
    await forwardToOnyx(upstreamWith(null, 'application/json', ['{}']), res, {});
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('passes the upstream content type through when an api key is in use', async () => {
    const { res, headers } = collectingResponse();
    await forwardToOnyx(upstreamWith(null, 'text/plain', ['x']), res, { apiKey: 'k' });
    expect(headers['Content-Type']).toBe('text/plain');
  });

  it('rejects when the upstream stream errors', async () => {
    const { res } = collectingResponse();
    const body = new Readable({
      read() {
        this.destroy(new Error('upstream died'));
      },
    });
    const upstream = { headers: { get: () => 'chunked' }, body };
    await expect(forwardToOnyx(upstream, res, {})).rejects.toThrow(/upstream died/);
  });

  it('accepts a Web ReadableStream, which is what global fetch actually returns', async () => {
    // undici's response body has no .pipe or .on. The add-on this was ported from
    // used node-fetch, whose body is a Node stream, so piping it directly works
    // in a test with Readable.from and breaks against a real response.
    const { res, chunks } = collectingResponse();
    const web = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('web-'));
        controller.enqueue(new TextEncoder().encode('stream'));
        controller.close();
      },
    });
    const upstream = { headers: { get: () => 'chunked' }, body: web };
    await forwardToOnyx(upstream, res, {});
    expect(chunks.join('')).toBe('web-stream');
  });

  it('rejects when the upstream has no body at all', async () => {
    const { res } = collectingResponse();
    await expect(forwardToOnyx({ headers: { get: () => null }, body: null }, res, {}))
      .rejects.toThrow(/no body/);
  });
});
