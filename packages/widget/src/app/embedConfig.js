import { DEFAULTS } from './defaults.js';

// The whole configuration of a demo, read from the iframe's own URL.
//
// There is no registry, no tenant lookup and no server: one chat is one persona,
// and everything else here is presentation. The loader copies the host page's
// data- attributes into these parameters, so adding a demo is another script tag
// rather than another row somewhere.

// Parameters that are not presentation: they decide which assistant answers and
// where it lives.
const ONYX_URL = 'onyx';
const PERSONA = 'persona';
const SEARCH_TOOL = 'tool';
// Set by the loader when a host page's own trigger opened the chat, so the panel
// renders directly instead of showing a bubble the visitor must click again.
const START_OPEN = 'open';
// Presentation, but consumed as a persona rather than as loose settings.
const ASSISTANT_NAME = 'assistantName';
const ASSISTANT_DESCRIPTION = 'assistantDescription';

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  return value === 'true' || value === '1';
}

export function readEmbedConfig(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);

  const onyxBaseUrl = params.get(ONYX_URL);
  const personaId = params.get(PERSONA);

  // No guessing: without these there is nothing to talk to and no assistant to
  // talk to it as, and a launcher that opens onto a broken panel is worse than
  // no launcher at all.
  if (!onyxBaseUrl) throw new Error('embed config needs an onyx url');
  if (!personaId) throw new Error('embed config needs a persona');

  const presentation = {};
  for (const key of new Set(params.keys())) {
    if (key === ONYX_URL || key === PERSONA || key === SEARCH_TOOL || key === START_OPEN) continue;
    if (key === ASSISTANT_NAME || key === ASSISTANT_DESCRIPTION) continue;
    const fallback = DEFAULTS[key];
    // Typed off the default rather than guessed, so "false" and "0" mean what
    // they say instead of being truthy strings.
    if (Array.isArray(fallback)) presentation[key] = params.getAll(key);
    else if (typeof fallback === 'boolean') presentation[key] = parseBoolean(params.get(key), fallback);
    else if (typeof fallback === 'number') presentation[key] = Number(params.get(key));
    else presentation[key] = params.get(key);
  }

  // StarterMessage renders nothing for a bare string - it returns null unless
  // name or message is set, and sends msg.message on click - so the strings the
  // embed carries are turned into that shape here.
  const starterPrompts = (presentation.starterPrompts ?? DEFAULTS.starterPrompts).map((prompt) =>
    typeof prompt === 'string' ? { name: prompt, message: prompt } : prompt,
  );

  // The components read persona?.name, ?.description, ?.id and
  // ?.starter_messages, which Onyx would normally serve. Everything else about a
  // demo travels in the embed, so this does too rather than adding a fetch and
  // a round trip before the panel can render.
  const persona = {
    id: personaId,
    name: params.get(ASSISTANT_NAME) ?? undefined,
    description: params.get(ASSISTANT_DESCRIPTION) ?? undefined,
    starter_messages: starterPrompts,
  };

  return {
    ...DEFAULTS,
    ...presentation,
    starterPrompts,
    persona,
    onyxBaseUrl,
    personaId,
    forcedToolId: params.get(SEARCH_TOOL),
    startOpen: params.get(START_OPEN) === '1',
  };
}
