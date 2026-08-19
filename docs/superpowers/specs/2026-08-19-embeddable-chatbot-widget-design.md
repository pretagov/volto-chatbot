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

`src/ChatBlock/` imports eight distinct `@plone/*` specifiers. Each needs a
decision, and two are not trivial:

| Specifier | Approach |
| --- | --- |
| `@plone/volto/icons/code.svg`, `icons/zoom.svg` | Local SVG files. Trivial. |
| `@plone/volto/helpers/Loadable/Loadable` and `@plone/volto/helpers/Loadable` | Both paths are used and both need aliases. `injectLazyLibs` is Volto's loadable-library HOC wired to `config.settings.loadables`, which this add-on populates with `rehypePrism`, `remarkGfm` and `luxon`. Reimplement as a small HOC that resolves those three through dynamic import; do not vendor Volto's loadable machinery. |
| `@plone/volto/helpers` (`usePrevious`) | Reimplement — a few lines. |
| `@plone/registry` | Shim the lookup used, rather than depending on the package. |
| `@plone/volto-slate/editor/render` (`serializeNodes`) | Renders Slate JSON to React. The largest shim. Depend on `@plone/volto-slate` directly if it installs standalone; otherwise a minimal renderer covering the node types the config fields actually use. Resolve this early — it gates the build. |
| `@plone/volto/components` (`BlockDataForm`, `SidebarPortal`) | **No shim needed.** Only `ChatBlockEdit.jsx` imports these, and that file is editor-only and outside the widget's import graph. |

The widget imports the view path: `ChatWindow`, `ChatMessageBubble`, `Citation`,
`CompactSourceCard`, the agent thinking display and their dependencies. It does
not import `ChatBlockEdit.jsx` or the block schema.

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
- `POST /da/*` — Onyx proxy with streaming passthrough, ported from `middleware.js`.
- `POST /ha/*` — HallOumi grounding, ported from `halloumi/middleware.js`.

The `_da`/`_ha` prefixes are kept from the existing add-on deliberately: the mock
server and the Volto proxy already use them, and a generic `/api/*` on our origin
would read confusingly next to Onyx's own `/api/...` paths that the proxy targets.

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

**A chat turn.** The widget POSTs same-origin to `/da/chat` carrying its session
token → the middleware validates the token, applies rate and spend limits,
overrides tenant-scoped fields from the tenant record, attaches the cached Onyx
service-account cookie, and proxies to Onyx (`/api/chat/send-message`) → the
response streams back unbuffered → the widget renders tokens, agent thinking,
then citations and highlights. Grounding runs through `/ha/*` and updates the
answer's support state.

## Trust model

The tenant key sits in a public script tag. It is not a secret and cannot be
treated as one.

**Where the origin check actually happens.** The widget is served from our
origin, so requests from it to `/da/*` are same-origin and carry *our* `Origin`
header — an origin allowlist on those calls would always pass and is worthless.
The embedding site's origin is only observable on the `GET /w/<tenant>` document
request, via `Sec-Fetch-Site` and `Referer`, and enforceable through
`frame-ancestors`. So:

- `GET /w/<tenant>` checks the embedding origin against the tenant's allowlist
  and sets `frame-ancestors` accordingly.
- On success it mints a **short-lived, tenant-bound session token**, which the
  widget must present on every `/da/*` and `/ha/*` call.
- Those calls validate the token, not an origin.

This stops casual re-embedding — someone dropping the key on their own site in a
browser. It does **not** stop determined abuse: a server-side client can send any
headers it likes. Browser-enforced controls only bind browsers.

**Pinning the tenant.** The proxy must not be a general-purpose authenticated
tunnel into Onyx:

- Only an explicit allowlist of Onyx paths is proxied.
- The assistant id and every other tenant-scoped request field are **injected
  server-side from the tenant record**, and client-supplied values are ignored.
  This matters because today the assistant is client config (`ChatWindow`
  receives `persona` from block data); proxying it unchanged would let a caller
  point one tenant's endpoint at another tenant's assistant.

**Cost control is the real defence.** Metering is per **completed chat turn**,
counted in Redis (already deployed) under a per-tenant key with a UTC daily
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

## Testing

Testing concentrates on the new boundaries, where the risk is.

**Middleware**, which holds the security properties:

- `GET /w/<tenant>` accepts an allowlisted embedding origin and rejects others
- a `/da/*` call without a valid session token is rejected
- a client-supplied assistant id is ignored in favour of the tenant record's
- a non-allowlisted Onyx path is refused
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

**Reused components.** `src/ChatBlock/` has tests for eight modules, but several
on the widget's critical path have none — `ChatWindow.jsx`, `useBackendChat.js`,
`withDanswerData.jsx`, `ChatMessageFeedback.jsx`, `MarkdownComponents.jsx`. We do
not add unit tests there, because they are upstream files and diverging tests
invite conflicts. The end-to-end test is what covers that path.

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
`enableMatomoTracking`. The remaining block fields map onto the tenant record as
part of defining the shared config contract.
