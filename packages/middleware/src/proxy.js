import { Readable } from 'node:stream';

// The security-critical module. Two properties matter: only allowlisted Onyx
// paths are reachable, and tenant-scoped fields come from the tenant record
// rather than from the client.

// Exactly the paths the reused components call — lib.js issues the three chat
// ones plus a health ping. persona is deliberately absent: the credential check
// hits /api/persona/-1 server-to-server inside login(), never through this
// proxy, so allowing it would widen the surface this list exists to narrow.
export const ALLOWED_PATHS = new Set([
  'chat/send-message',
  'chat/create-chat-session',
  'chat/create-chat-message-feedback',
  'health',
]);

const API_PREFIX = '/api';

// What each allowlisted path resolves to on upgraded Onyx.
//
// The client-facing names are kept as they are: the frontend still calls
// send-message and we are deliberately not editing it, so the old name is the
// public contract here and the rename is an internal detail.
//
// Verified against the backend rather than the mock, which is what let the old
// values survive: chat/send-message no longer exists at all, and health is
// served from the root rather than under /api.
const PATH_TARGETS = {
  'chat/send-message': `${API_PREFIX}/chat/send-chat-message`,
  'chat/create-chat-session': `${API_PREFIX}/chat/create-chat-session`,
  'chat/create-chat-message-feedback': `${API_PREFIX}/chat/create-chat-message-feedback`,
  health: '/health',
};

export function resolveOnyxPath(url) {
  const raw = String(url ?? '');
  if (!raw.startsWith('/_da/')) return null;

  const afterPrefix = raw.slice('/_da/'.length);
  const [path, query] = afterPrefix.split('?');

  // Reject traversal and smuggled absolute URLs before consulting the allowlist,
  // so neither can reach it in an encoded or unexpected form.
  if (path.includes('..') || path.includes('//') || path.includes(':')) return null;
  if (!ALLOWED_PATHS.has(path)) return null;

  const target = PATH_TARGETS[path];
  return query ? `${target}?${query}` : target;
}

// Tenant-scoped fields always come from the tenant record; whatever the client
// sent is ignored. The assistant is client config in the reused components, so
// without this a caller could point one tenant's endpoint at another's assistant.
export function pinTenantFields(body, tenant) {
  if (!body || typeof body !== 'object') return body;
  return {
    ...body,
    persona_id: tenant.assistantId,
    alternate_assistant_id: tenant.assistantId,
  };
}

// Global fetch (undici) returns a Web ReadableStream, which has no .pipe or .on.
// The add-on this was ported from used node-fetch, whose body is a Node stream,
// so the ported pipe call breaks against a real response even though it works
// against a Readable in a test. Normalise here rather than at every call site.
function toNodeStream(body) {
  if (!body) throw new Error('upstream response has no body');
  if (typeof body.pipe === 'function') return body;
  return Readable.fromWeb(body);
}

// Streaming must stay incremental — the widget renders tokens as they arrive, so
// buffering the whole answer here would make every reply appear at once.
export async function forwardToOnyx(upstream, res, { apiKey } = {}) {
  if (apiKey) {
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
  } else if (upstream.headers.get('transfer-encoding') === 'chunked') {
    res.set('Content-Type', 'text/event-stream');
  } else {
    res.set('Content-Type', 'application/json');
  }

  const body = toNodeStream(upstream.body);
  await new Promise((resolve, reject) => {
    body.on('error', reject);
    body.on('end', resolve);
    body.pipe(res);
  });
}
