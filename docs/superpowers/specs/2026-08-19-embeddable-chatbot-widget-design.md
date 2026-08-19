# Embeddable chatbot widget — design

## Problem

The chatbot is a Volto add-on, so it only runs inside Plone. We want the same
assistant on any website, added with a script tag, without that site running
Plone or knowing anything about Onyx.

Three things currently tie it to Plone:

| Part | Coupling |
| --- | --- |
| Chat UI (`src/ChatBlock/`) | Moderate — eight `@plone/*` specifiers, listed below |
| Config | Heavy — `SidebarDisplay` reads the current page's blocks through Volto's Redux store (`useSelector`, `getBlocksFieldname`) |
| Middleware (`src/middleware.js`, `src/halloumi/middleware.js`) | Structural — Express routes injected into Volto's SSR server via `config.settings.expressMiddleware` |

The middleware exists to keep Onyx credentials out of the browser: it logs in
with a service account, caches the cookie, and streams responses back. Any
replacement has to preserve that property.

## Decisions

- **Multi-tenant, hosted by us.** One deployment serves every site. Sites add a
  script tag and need no backend of their own.
- **Public, anonymous end users.** No host-site identity, no permission
  filtering. Each tenant's answers are pinned to that tenant's assistant
  server-side (see Trust model).
- **Floating launcher and panel.** Not inline. The panel has its own dimensions,
  so the iframe never has to resize to fit page content.
- **One config contract, two sources.** The Volto shell derives it from block
  data as it does today; the widget shell fetches the same shape from `/config`,
  backed by a tenant record. Presentational components then take identical config
  regardless of host, which is what allows reusing them unmodified.
- **Loader script plus iframe.** Chosen over a Shadow DOM web component: the UI
  carries `semantic-ui-react` and SCSS that assume global stylesheets, and an
  iframe isolates CSS, JS and CSP in both directions.
- **Conversations persist across host-page navigation.** A floating widget is
  destroyed on every navigation, so the session id is stored in the iframe's
  `sessionStorage` (keyed per tenant) and the conversation resumes. Without this a
  visitor loses context exactly when they would ask a follow-up. Expiry matches
  the Onyx session's own lifetime; an unresumable session starts a new one
  silently.
- **Scope:** our fork's UI — sidebar panel, `ChatWindow`, agent thinking display,
  citations and match highlights, starter prompts, feedback — plus HallOumi
  grounding.

## Keeping upstream mergeable

This repo tracks `eea/volto-chatbot`. Restructuring `src/ChatBlock/` into a
shared package would turn every upstream change to those files into a merge
conflict.

**New files merge cleanly; moved or edited files conflict.** So we add rather
than move:

- `src/ChatBlock/` stays exactly where upstream has it and is imported in place
  by its existing paths.
- Everything new lives in new directories.
- The `@plone/*` imports resolve through build-time aliases, so the components
  load outside Volto without being edited.
- The Volto-coupled parts are not reused: `SidebarEntrypoint` and
  `SidebarDisplay` look config up through Redux and Plone blocks, so the widget
  gets its own entrypoint instead.

The cost is a dependency on upstream's internal file paths. If EEA moves a file
the widget build breaks — one loud failure in CI, which is far cheaper than
conflicts spread across every component on every merge.

`tests-playwright/` is different: we added it and upstream has no version of it,
so it can be restructured freely.

### The alias surface

Eight distinct `@plone/*` specifiers appear in `src/ChatBlock/`, but two are
reached only through files the widget never imports, so **six need aliases**:

| Specifier | Approach |
| --- | --- |
| `@plone/volto/icons/zoom.svg` | Local SVG file. Trivial. |
| `@plone/volto/helpers/Loadable/Loadable` and `@plone/volto/helpers/Loadable` | Both paths are used and both need aliases. `injectLazyLibs` is Volto's loadable-library HOC wired to `config.settings.loadables`, which this add-on populates with `rehypePrism`, `remarkGfm` and `luxon`. Reimplement as a small HOC that resolves those three through dynamic import; do not vendor Volto's loadable machinery. |
| `@plone/volto/helpers` (`usePrevious`) | Reimplement — a few lines. |
| `@plone/registry` | A **writable settings singleton** the widget shell seeds at boot — see below. |
| `@plone/volto-slate/editor/render` (`serializeNodes`) | Renders Slate JSON to React. The largest shim. Depend on `@plone/volto-slate` directly if it installs standalone; otherwise a minimal renderer covering the node types the config fields actually use. Resolve this early — it gates the build. |
| `@plone/volto/components` (`BlockDataForm`, `SidebarPortal`) | **No shim needed** — only `ChatBlockEdit.jsx` imports these. |
| `@plone/volto/icons/code.svg` | **No shim needed** — only `src/ChatBlock/index.js` imports it. |

The widget imports the view path: `ChatWindow`, `ChatMessageBubble`, `Citation`,
`CompactSourceCard`, the agent thinking display and their dependencies.

It does **not** import:

- `ChatBlockEdit.jsx` — editor-only
- `src/ChatBlock/index.js` — Volto block registration, which pulls in the editor
  and the block schema
- `ChatBlockView.jsx` — imports `SidebarChatbotStartButton` from the Volto
  sidebar shell, which the widget replaces, and pulls in `superagent`
- `withDanswerData.jsx` — reached only through the three files above

The widget shell provides its own equivalent of `ChatBlockView`'s role.

### The registry is a second config channel

`@plone/registry` is not just an import to satisfy. `lib.js` reads
`config.settings["volto-chatbot"].rewakeUrl` and `useBackendChat.js` reads
`.rewakeDelay` — runtime settings taken from a module singleton rather than from
props. So "components take identical config regardless of host" holds only if the
widget shell **seeds the shimmed registry** at boot with a `volto-chatbot`
settings object containing at least `rewakeUrl` and `rewakeDelay`.

This is a second config channel alongside the shared contract, and the contract
definition must cover it rather than leaving those two keys undefined.

## Architecture

Three pieces, deployed as one Fly app so the widget's API calls are same-origin
and there is one thing to release.

**`loader.js`** — a few KB, no dependencies. Reads `data-*` from its own script
tag, injects a fixed-position iframe, and resizes it between launcher and panel
in response to `postMessage`. It is the only code running in the host page.

Permitted attributes are `data-tenant` (required) and `data-position`
(`left`/`right`, cosmetic). Nothing else. Everything else comes from `/config`,
and server config always wins — the loader cannot override behaviour.

**Widget app** — React, served from our origin, running in the iframe. New shell
code (entrypoint, config provider, theme injection, launcher and panel) around
upstream's presentational components, reused unchanged.

**Middleware** — a standalone Express service:

- `GET /w/<tenant>` — the widget document. The embedding-origin check happens
  here (see Trust model).
- `GET /w/<tenant>/config` — the tenant's config, in the shared contract shape.
- `GET /w/<tenant>/session` — re-mints an expired session token. Because this is
  a fetch rather than a document, `frame-ancestors` cannot protect it and the
  `Referer` check is only advisory, so it must never mint from nothing: it
  requires the **expired but validly signed** token and re-issues only for the
  same tenant. Otherwise it is a token faucet.
- `ALL /_da/*` — Onyx proxy with streaming passthrough, ported from `middleware.js`.
- `ALL /_ha/*` — HallOumi grounding, ported from `halloumi/middleware.js`.

**These paths are not a choice.** The reused components hardcode them:
`src/ChatBlock/lib.js` fetches `/_da/chat/send-message`,
`/_da/chat/create-chat-session` and `/_da/chat/create-chat-message-feedback`;
`useQualityMarkers.js` fetches `/_ha/generate`. Reusing those files unmodified
requires serving exactly those paths, underscore included — which is also what
the Volto add-on and the existing mock server already use.

The routes accept any method rather than POST only, because `lib.js` also issues
a **GET** health ping to `config.settings["volto-chatbot"].rewakeUrl`, defaulted
by the add-on to `/_da/health` and fired on a timer by `useBackendChat.js`.

The proxied Onyx path allowlist is therefore exactly four entries:
`chat/send-message`, `chat/create-chat-session`,
`chat/create-chat-message-feedback` and `health`. Anything else is refused.

`persona/-1` is deliberately **not** on it. The middleware's own credential check
calls that path server-to-server inside `login()`, never through the
client-facing proxy, so allowing it would widen the surface the allowlist exists
to narrow.

Tenant config lives in a Postgres table. No admin UI in v1; seed through a
migration and add one later if it earns its place.

### Layout

```
volto-chatbot/
  src/
    ChatBlock/              # upstream — untouched, merges cleanly, imported in place
    sidebar/                # ours — the Volto shell
    index.js                # fork-modified — registers SidebarEntrypoint via appExtras
    middleware.js           # upstream — stays, see below
    halloumi/middleware.js  # upstream — stays, serves the _ha route
  widget/                   # new — standalone embeddable
    src/loader/             #   loader.js
    src/app/                #   entrypoint, config provider, panel shell
    src/shims/              #   @plone/* aliases
  middleware/               # new — standalone service
```

The widget and middleware share an API contract and version together.

### The in-Volto proxy stays

The add-on keeps its own `_da`/`_ha` routes so existing Plone sites keep working
unchanged. The hosted middleware is authoritative for embedded sites. This is two
copies of security-critical code, accepted deliberately for v1 and recorded here
as a known duplication: the shared config contract limits how far they can drift,
and the security tests below cover the **hosted** copy. Pointing Plone at the
hosted service is a later migration, not a v1 decision.

## Data flow

**Boot.** Script tag → loader injects an iframe at `/w/<tenant>` → the widget
fetches `/w/<tenant>/config` → launcher renders. A failed config fetch renders
nothing rather than a broken bubble.

**A chat turn.** The widget POSTs same-origin to `/_da/chat/send-message`, the
shell's `fetch` wrapper attaching the session token → the middleware validates
the token, meters the turn, applies rate and spend limits, overrides
tenant-scoped fields from the tenant record, attaches the cached Onyx
service-account cookie, and proxies to Onyx (`/api/chat/send-message`) → the
response streams back unbuffered → the widget renders tokens, agent thinking,
then citations and highlights. Grounding runs through `/_ha/generate` and updates
the answer's support state.

## Trust model

The tenant key sits in a public script tag. It is not a secret and cannot be
treated as one.

**Where the origin check actually happens.** The widget is served from our
origin, so requests from it to `/_da/*` are same-origin and carry *our* `Origin`
header — an origin allowlist on those calls would always pass and is worthless.
The embedding site's origin is only observable on the `GET /w/<tenant>` document
request, via `Sec-Fetch-Site` and `Referer`, and enforceable through
`frame-ancestors`. So:

- `GET /w/<tenant>` checks the embedding origin against the tenant's allowlist
  and sets `frame-ancestors` accordingly.
- On success it mints a **tenant-bound session token**, which the widget presents
  on every `/_da/*` and `/_ha/*` call.
- Those calls validate the token, not an origin.

**How the token gets attached, given components we cannot edit.** `lib.js` and
`useQualityMarkers.js` issue bare `fetch()` calls with no hook for a header, and
editing them would break the merge strategy. Two mechanisms were considered:

- *A cookie* set on the `/w/<tenant>` response. Rejected: the widget runs in an
  iframe on someone else's site, so this is a **third-party cookie** — blocked
  outright by Safari and being removed in Chrome. It would fail on exactly the
  embedded case the product exists for.
- *A `fetch` wrapper installed by the widget shell* — chosen. The shell patches
  `window.fetch` inside the iframe at boot to attach the token to same-origin
  `/_da/*` and `/_ha/*` requests. It is shell code in a new file, needs no
  upstream edit, and is unaffected by cookie policy. Every live proxy call in the
  widget's graph goes through global `fetch` (`lib.js` for health, session
  creation, feedback and send-message; `useQualityMarkers.js` for grounding), so
  the wrapper catches all of them.

The wrapper must return the `Response` untouched so streaming stays incremental,
and forward `init.signal` so aborts still propagate.

**The wrapper covers `fetch` only.** `superagent` is imported by
`ChatBlockView.jsx` and `ChatBlockEdit.jsx`, and its XHR-based calls would bypass
the wrapper entirely — no token, and a silent failure. Both files are excluded
from the widget's graph today, and the one live `superagent` persona call sits in
the editor, but upstream plainly intends the commented-out `ChatBlockView` one to
return. Nothing about that change would move a file, so the CI build guard would
not notice. The widget build therefore **asserts `superagent` is absent from the
bundle**, so its reappearance on a reused path fails CI loudly rather than
shipping untokenised requests.

**Storage needs the same treatment.** `useBackendChat.js` reads and writes
`localStorage` directly for its `chat-last-awake` key. In Safari with storage
blocked, property access on `localStorage` *throws*, inside a file we cannot
edit. The shell therefore installs a storage guard at boot alongside the fetch
wrapper — same pattern, same reason.

**What the origin check is actually worth.** `Sec-Fetch-Site` reports only
`same-site`/`cross-site` — never *which* site — so the check rests on `Referer`,
which an embedding page can suppress with `Referrer-Policy: no-referrer`. When
`Referer` is absent we **serve the widget anyway** rather than break legitimate
tenants, which means the header check is advisory. `frame-ancestors` is the
control that still holds in that case, so it is load-bearing rather than
defence-in-depth.

Together these stop casual re-embedding — someone dropping the key on their own
site in a browser. They do **not** stop determined abuse: a server-side client
can send any headers it likes. Browser-enforced controls only bind browsers.

**Pinning the tenant.** The proxy must not be a general-purpose authenticated
tunnel into Onyx:

- Only an explicit allowlist of Onyx paths is proxied.
- The assistant id and every other tenant-scoped request field are **injected
  server-side from the tenant record**, and client-supplied values are ignored.
  This matters because today the assistant is client config (`ChatWindow`
  receives `persona` from block data); proxying it unchanged would let a caller
  point one tenant's endpoint at another tenant's assistant.

**Cost control is the real defence.** Metering happens at **turn admission** —
the counter increments before the request is proxied and is never refunded if the
stream aborts. Metering on completion would be gameable in exactly the direction
the cap exists to prevent: inference is billed as tokens are produced, so a
client that aborts every stream just before the end would spend without ever
being counted.

Counters live in Redis (already deployed): a per-tenant key on a UTC daily
window, plus a per-IP limit over a short rolling window. The client IP comes from
Fly's `Fly-Client-IP` header, which is the only forwarded header we trust. The
per-tenant daily cap is a **required** field on the tenant record. If Redis is
unavailable the middleware refuses turns rather than serving uncapped — an
outage is cheaper than an unbounded inference bill.

Onyx credentials stay in middleware environment variables and never reach the
browser — the property the current Volto middleware exists to provide.

Whether visitors need a disclosure that transcripts are processed by Onyx and the
inference provider is a policy decision, not a technical one.

## Degradation

- HallOumi unavailable — the answer still renders, the grounding badge is omitted.
- Onyx error or dropped stream — the partial answer is kept and marked incomplete.
  Retry **resends the original message as a new turn** and discards the partial;
  resuming a half-finished stream is not supported.
- Rate limited or over cap — an explicit message, so a site owner can tell "over
  quota" from "broken".
- Config unavailable — no launcher.
- **Session token expired** — the panel is designed to live on a page
  indefinitely, so the token will outlive its lifetime on an SPA host that never
  navigates. On a `401` the shell's `fetch` wrapper silently re-mints against
  `GET /w/<tenant>/session` and retries the request **once**; a second failure
  surfaces as an error rather than looping.
- **Storage unavailable** — browsers partition (and can block) storage in
  third-party iframes, so session persistence is best-effort. If the session id
  cannot be read or written the widget starts a fresh conversation rather than
  failing. Partitioning per top-level site is desirable here anyway: it keeps one
  visitor's conversations on different tenants separate.

## Testing

Testing concentrates on the new boundaries, where the risk is.

**Middleware**, which holds the security properties:

- `GET /w/<tenant>` accepts an allowlisted embedding origin and rejects others
- a missing `Referer` still serves the widget (advisory check), while
  `frame-ancestors` is set from the tenant's allowlist
- a `/_da/*` call without a valid session token is rejected
- a client-supplied assistant id is ignored in favour of the tenant record's
- a non-allowlisted Onyx path is refused, and the five allowlisted ones pass
- a turn is metered at admission and **not** refunded when the client aborts
  the stream early
- rate limit and spend cap fail closed, including when Redis is unavailable
- the Onyx service cookie never appears in a client response
- streaming is incremental rather than buffered
- HallOumi failure degrades to an answer without grounding

**Loader**, the only code in the host page:

- injects exactly one iframe, and is idempotent if a site includes the script twice
- ignores `postMessage` from any origin but ours

**Widget shell:** a failed config fetch renders no launcher; config drives starter
prompts, title and theme; a stored session id resumes the conversation after a
simulated navigation.

The `fetch` wrapper specifically:

- attaches the token to `/_da/*` and `/_ha/*`, and to nothing else
- returns the `Response` untouched, so streaming stays incremental
- forwards `init.signal`, without which the admission-metering abort test cannot
  pass
- re-mints once on a `401`, and surfaces an error rather than looping on a second

The shell seeds `rewakeUrl` as a **path** (`/_da/health`), not an absolute URL —
the wrapper matches on path prefix, so an absolute URL would send the health ping
untokenised.

**CI bundle guard:** `superagent` must be absent from the widget bundle.

**Reused components.** `src/ChatBlock/` has tests for eight modules, but several
on the widget's critical path have none — `ChatWindow.jsx`, `useBackendChat.js`,
`ChatMessageFeedback.jsx`, `MarkdownComponents.jsx`. We do not add unit tests
there, because they are upstream files and diverging tests invite conflicts. The
end-to-end test is what covers that path.

**CI build guard.** Building the widget bundle on every CI run is the tripwire for
importing upstream components by path: if EEA moves a file, CI goes red instead of
a customer's site breaking at runtime.

**End to end.** One Playwright test: a static host page with the script tag, click
the launcher, send a message, assert a streamed answer with a citation.

### Test infrastructure

`tests-playwright/fixtures/mock-plone-server.js` already mocks the Onyx side —
`/api/persona/-1` (the credential check the middleware performs),
`/api/chat/send-message` with chunked transfer encoding, and `/_da/*` routing.

It needs three changes, all safe because these files are ours alone:

1. Extract the Onyx mocking into a standalone `mock-onyx-server.js`, since the
   widget needs Onyx without Plone.
2. Add HallOumi mocking, which does not exist today.
3. Add a `/config` fixture.

CI then runs against the mock, with no live Onyx and no inference spend.

## Out of scope

Inline (non-floating) embedding, host-site identity, permission-filtered answers,
and a config admin UI.

Two existing block fields are out of scope and are therefore **absent from the
tenant config schema**, with their features hard-disabled in the widget shell
rather than left to default: `qgenAsistantId` (question generation) and
`enableMatomoTracking`.

The remaining block fields map onto the tenant record as part of defining the
shared config contract. That mapping is the first implementation task and lands
as a schema module in `middleware/`, imported by the widget shell for typing and
by the tenant seed migration — so there is one artifact to point at rather than a
convention to remember. It must also cover the two registry-only settings,
`rewakeUrl` and `rewakeDelay`.
