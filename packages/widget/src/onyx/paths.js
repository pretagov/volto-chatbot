// Where each call the reused components make lands on upgraded Onyx.
//
// The client-facing names are kept as they are: lib.js still calls
// chat/send-message and we are deliberately not editing it, so the old name is
// the contract here and the rename is an internal detail.
//
// Verified by calling the deployment, which is what a mock cannot do:
// chat/send-message no longer exists under that name at all.
const API_PREFIX = '/api';

const PATH_TARGETS = {
  'chat/send-message': `${API_PREFIX}/chat/send-chat-message`,
  'chat/create-chat-session': `${API_PREFIX}/chat/create-chat-session`,
  'chat/create-chat-message-feedback': `${API_PREFIX}/chat/create-chat-message-feedback`,
  health: `${API_PREFIX}/health`,
};

export const PROXY_PREFIX = '/_da/';

// Only the path is matched, so an absolute same-origin URL still qualifies. This
// is also why rewakeUrl must be seeded as a path rather than an absolute URL.
export function pathOf(input) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  if (!url) return '';
  return url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
}

// Returns the Onyx path for a widget request, or null when it is not one of
// ours and should be left alone.
export function resolveOnyxPath(url) {
  const raw = pathOf(url);
  if (!raw.startsWith(PROXY_PREFIX)) return null;

  const [path, query] = raw.slice(PROXY_PREFIX.length).split('?');
  const target = PATH_TARGETS[path];
  if (!target) return null;

  return query ? `${target}?${query}` : target;
}
