import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFetchWrapper } from './fetchWrapper.js';

const ONYX = 'https://onyx.example';

let uninstall = null;
afterEach(() => {
  if (uninstall) uninstall();
  uninstall = null;
  vi.restoreAllMocks();
});

function install(options = {}) {
  const calls = [];
  const stub = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  });
  globalThis.fetch = stub;
  uninstall = installFetchWrapper({ onyxBaseUrl: ONYX, ...options });
  return calls;
}

// Emits the given lines as an NDJSON body, the way Onyx streams a chat turn.
function ndjsonResponse(lines) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function readAll(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

describe('installFetchWrapper', () => {
  it('sends widget requests to Onyx rather than to the page origin', async () => {
    const calls = install();
    await fetch('/_da/chat/create-chat-session', { method: 'POST', body: '{}' });
    expect(calls[0].url).toBe(`${ONYX}/api/chat/create-chat-session`);
  });

  it('maps the old send-message name onto the renamed endpoint', async () => {
    // lib.js still calls chat/send-message and is deliberately not edited, so
    // the rename is handled here.
    const calls = install();
    await fetch('/_da/chat/send-message', { method: 'POST', body: '{"message":"hi"}' });
    expect(calls[0].url).toBe(`${ONYX}/api/chat/send-chat-message`);
  });

  it('sends health where the deployment actually serves it', async () => {
    // Confirmed by calling it: /health is a 404, /api/health is the endpoint.
    const calls = install();
    await fetch('/_da/health');
    expect(calls[0].url).toBe(`${ONYX}/api/health`);
  });

  it('leaves unrelated requests alone', async () => {
    const calls = install();
    await fetch('/some/page/asset.png');
    expect(calls[0].url).toBe('/some/page/asset.png');
  });

  it('sends no credentials, because Onyx is called anonymously', async () => {
    const calls = install();
    await fetch('/_da/chat/create-chat-session', { method: 'POST', body: '{}' });
    const headers = new Headers(calls[0].init?.headers || {});
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
  });

  it('applies the persona when the session is created', async () => {
    // The new SendMessageRequest carries no persona - the assistant is fixed by
    // the chat session - so this is the only place it can be applied.
    const calls = install({ personaId: '12' });
    await fetch('/_da/chat/create-chat-session', { method: 'POST', body: '{}' });
    expect(JSON.parse(calls[0].init.body).persona_id).toBe(12);
  });

  it('forces the search tool on a chat turn, so retrieval actually happens', async () => {
    const calls = install({ forcedToolId: '1' });
    await fetch('/_da/chat/send-message', { method: 'POST', body: '{"message":"hi"}' });
    expect(JSON.parse(calls[0].init.body).forced_tool_id).toBe(1);
  });

  it('does not force a tool when none is configured', async () => {
    const calls = install();
    await fetch('/_da/chat/send-message', { method: 'POST', body: '{"message":"hi"}' });
    expect(JSON.parse(calls[0].init.body).forced_tool_id).toBeUndefined();
  });

  it('reshapes the message body onto the new request model', async () => {
    const calls = install();
    await fetch('/_da/chat/send-message', {
      method: 'POST',
      body: '{"message":"hi","chat_session_id":"abc","persona_id":"7"}',
    });
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.message).toBe('hi');
    expect(sent.chat_session_id).toBe('abc');
  });

  it('translates the streamed answer into the shape the components parse', async () => {
    globalThis.fetch = vi.fn(async () =>
      ndjsonResponse([
        { placement: {}, obj: { type: 'message_delta', content: 'Hello' } },
        { placement: {}, obj: { type: 'stop' } },
      ]),
    );
    uninstall = installFetchWrapper({ onyxBaseUrl: ONYX });

    const response = await fetch('/_da/chat/send-message', { method: 'POST', body: '{}' });
    const lines = (await readAll(response)).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([{ answer_piece: 'Hello' }]);
  });

  it('streams incrementally rather than buffering the whole answer', async () => {
    globalThis.fetch = vi.fn(async () =>
      ndjsonResponse([
        { placement: {}, obj: { type: 'message_delta', content: 'a' } },
        { placement: {}, obj: { type: 'message_delta', content: 'b' } },
      ]),
    );
    uninstall = installFetchWrapper({ onyxBaseUrl: ONYX });

    const response = await fetch('/_da/chat/send-message', { method: 'POST', body: '{}' });
    const reader = response.body.getReader();
    const first = await reader.read();
    // Arriving before the stream ends is the point: tokens render as they come.
    expect(new TextDecoder().decode(first.value)).toContain('"a"');
  });

  it('leaves a non-streaming response alone', async () => {
    const calls = install();
    const response = await fetch('/_da/chat/create-chat-session', { method: 'POST', body: '{}' });
    expect(await response.text()).toBe('{}');
    expect(calls).toHaveLength(1);
  });

  it('forwards init.signal so a turn can be aborted', async () => {
    const calls = install();
    const controller = new AbortController();
    await fetch('/_da/health', { signal: controller.signal });
    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it('refuses a widget path it has no Onyx route for', async () => {
    // Forwarding an unmapped path blindly at an origin that might answer it is
    // worse than failing loudly.
    install();
    await expect(fetch('/_da/chat/invented-endpoint')).rejects.toThrow(/no Onyx route/);
  });

  it('restores the original fetch when uninstalled', () => {
    const before = globalThis.fetch;
    const stop = installFetchWrapper({ onyxBaseUrl: ONYX });
    expect(globalThis.fetch).not.toBe(before);
    stop();
    expect(globalThis.fetch).toBe(before);
  });

  it('refuses to install without an Onyx base url', () => {
    expect(() => installFetchWrapper({})).toThrow(/onyxBaseUrl/);
  });
});
