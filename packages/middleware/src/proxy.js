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

export function resolveOnyxPath(url) {
  const raw = String(url ?? '');
  if (!raw.startsWith('/_da/')) return null;

  const afterPrefix = raw.slice('/_da/'.length);
  const [path, query] = afterPrefix.split('?');

  // Reject traversal and smuggled absolute URLs before consulting the allowlist,
  // so neither can reach it in an encoded or unexpected form.
  if (path.includes('..') || path.includes('//') || path.includes(':')) return null;
  if (!ALLOWED_PATHS.has(path)) return null;

  return query ? `${API_PREFIX}/${path}?${query}` : `${API_PREFIX}/${path}`;
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

  await new Promise((resolve, reject) => {
    upstream.body.on('error', reject);
    upstream.body.on('end', resolve);
    upstream.body.pipe(res);
  });
}
