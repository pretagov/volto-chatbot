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
    const fallback = DEFAULTS[key];
    // Typed off the default rather than guessed, so "false" and "0" mean what
    // they say instead of being truthy strings.
    if (Array.isArray(fallback)) presentation[key] = params.getAll(key);
    else if (typeof fallback === 'boolean') presentation[key] = parseBoolean(params.get(key), fallback);
    else if (typeof fallback === 'number') presentation[key] = Number(params.get(key));
    else presentation[key] = params.get(key);
  }

  return {
    ...DEFAULTS,
    ...presentation,
    onyxBaseUrl,
    personaId,
    forcedToolId: params.get(SEARCH_TOOL),
    startOpen: params.get(START_OPEN) === '1',
  };
}
