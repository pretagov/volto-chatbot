import { resolveOnyxPath, pathOf, PROXY_PREFIX } from '../onyx/paths.js';
import { translateRequest, createTranslateStream } from '../onyx/protocol.js';

// Points the reused components at Onyx and reshapes the traffic on the way.
//
// This exists because those components issue bare fetch() calls — lib.js for
// health, session creation, feedback and send-message — with no hook for a base
// URL or a body transform, and those files must not be edited or the merge
// strategy collapses. So the seam is fetch itself.
//
// There is no credential here by design: Onyx is called anonymously, resolving
// the caller to its anonymous user whose ACL is exactly {PUBLIC}. Nothing secret
// reaches the page because nothing secret is involved.

function isOnyxRequest(input) {
  return pathOf(input).startsWith(PROXY_PREFIX);
}

// The chat turn is the only call that streams the packet protocol; the rest
// return plain JSON.
function needsTranslation(target) {
  return target.includes('send-chat-message');
}

function reshapeBody(init, target) {
  if (!init?.body || typeof init.body !== 'string') return init?.body;
  // Only our own JSON bodies are reshaped; anything unparseable is passed on
  // untouched rather than guessed at.
  let parsed;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return init.body;
  }
  return JSON.stringify(translateRequest(parsed, target));
}

export function installFetchWrapper({ onyxBaseUrl, personaId, forcedToolId }) {
  if (!onyxBaseUrl) throw new Error('installFetchWrapper needs an onyxBaseUrl');

  // Keep both: the raw reference so uninstall restores exactly what was there,
  // and a bound copy to call with, since fetch must be invoked on globalThis.
  const rawFetch = globalThis.fetch;
  const originalFetch = rawFetch.bind(globalThis);

  globalThis.fetch = async function wrappedFetch(input, init) {
    if (!isOnyxRequest(input)) return originalFetch(input, init);

    const target = resolveOnyxPath(input);
    // A widget path we do not map is a bug, not something to forward blindly at
    // an origin that would answer it.
    if (!target) throw new Error(`no Onyx route for ${pathOf(input)}`);

    let body = reshapeBody(init, target);

    // The assistant is fixed when the session is created — the new
    // SendMessageRequest carries no persona at all — so this is the only place
    // the persona can be applied.
    if (target.includes('create-chat-session') && personaId != null) {
      body = JSON.stringify({ ...JSON.parse(body || '{}'), persona_id: Number(personaId) });
    }

    // Retrieval is the assistant's choice under upgraded Onyx, and for a
    // question it believes it can answer from general knowledge it does not
    // search at all. Forcing the tool restores the old always-retrieve
    // behaviour.
    if (needsTranslation(target) && forcedToolId != null) {
      body = JSON.stringify({
        ...JSON.parse(body || '{}'),
        forced_tool_id: Number(forcedToolId),
      });
    }

    const response = await originalFetch(`${onyxBaseUrl}${target}`, { ...init, body });
    if (!needsTranslation(target) || !response.body) return response;

    // Piped rather than buffered, so tokens still render as they arrive.
    return new Response(response.body.pipeThrough(createTranslateStream()), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return function uninstall() {
    globalThis.fetch = rawFetch;
  };
}
