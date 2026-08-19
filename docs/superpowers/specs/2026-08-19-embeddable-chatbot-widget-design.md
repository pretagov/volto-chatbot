# Embeddable chatbot widget — design

## Problem

The chatbot is a Volto add-on, so it only runs inside Plone. We want the same
assistant on any website, added with a script tag, without that site running
Plone or knowing anything about Onyx.

Three things currently tie it to Plone:

| Part | Coupling |
| --- | --- |
| Chat UI (`src/ChatBlock/`) | Light — four `@plone/volto` imports (icon, Loadable, a component, slate render) |
| Config | Heavy — `SidebarDisplay` reads the current page's blocks through Volto's Redux store (`useSelector`, `getBlocksFieldname`) |
| Middleware (`src/middleware.js`, `src/halloumi/middleware.js`) | Structural — Express routes injected into Volto's SSR server via `config.settings.expressMiddleware` |

The middleware exists to keep Onyx credentials out of the browser: it logs in
with a service account, caches the cookie, and streams responses back. Any
replacement has to preserve that property.

## Decisions

- **Multi-tenant, hosted by us.** One deployment serves every site. Sites add a
  script tag and need no backend of their own.
- **Public, anonymous end users.** No host-site identity, no permission
  filtering. Answers come from that tenant's public content.
- **Floating launcher and panel.** Not inline. The panel has its own dimensions,
  so the iframe never has to resize to fit page content.
- **Config served per tenant from the middleware.** One source of truth,
  changeable without the site editing anything, and security-relevant fields stay
  under our control.
- **Loader script plus iframe.** Chosen over a Shadow DOM web component: the UI
  carries `semantic-ui-react` and SCSS that assume global stylesheets, and an
  iframe isolates CSS, JS and CSP in both directions.
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
- The four `@plone/volto` imports resolve through build-time aliases to small
  shims, so the components load outside Volto without being edited.
- The Volto-coupled parts are not reused: `SidebarEntrypoint` and
  `SidebarDisplay` look config up through Redux and Plone blocks, so the widget
  gets its own entrypoint instead.

The cost is a dependency on upstream's internal file paths. If EEA moves a file
the widget build breaks — one loud failure in CI, which is far cheaper than
conflicts spread across every component on every merge.

`tests-playwright/` is different: we added it and upstream has no version of it,
so it can be restructured freely.

## Architecture

Three pieces, deployed as one Fly app so the widget's API calls are same-origin
and there is one thing to release.

**`loader.js`** — a few KB, no dependencies. Reads `data-*` from its own script
tag, injects a fixed-position iframe, and resizes it between launcher and panel
in response to `postMessage`. It is the only code running in the host page.

**Widget app** — React, served from our origin, running in the iframe. New shell
code (entrypoint, config provider, theme injection, launcher and panel) around
upstream's presentational components, reused unchanged.

**Middleware** — a standalone Express service:

- `/config` — tenant lookup
- `/api/*` — Onyx auth-proxy with streaming passthrough, ported from `middleware.js`
- `/ha/*` — HallOumi grounding, ported from `halloumi/middleware.js`

Tenant config lives in a Postgres table. No admin UI in v1; seed through a
migration and add one later if it earns its place.

### Layout

```
volto-chatbot/
  src/                      # upstream add-on — untouched, merges cleanly
    ChatBlock/              #   reused in place by the widget
    sidebar/                #   ours: the Volto shell
  widget/                   # new — standalone embeddable
    src/loader/             #   loader.js
    src/app/                #   entrypoint, config provider, panel shell
    src/shims/              #   @plone/volto aliases
  middleware/               # new — standalone service
```

The widget and middleware share an API contract and version together.

## Data flow

**Boot.** Script tag → loader injects an iframe at `/w/<tenant>` → widget fetches
`/config` → launcher renders. A failed config fetch renders nothing rather than a
broken bubble.

**A chat turn.** Widget POSTs same-origin to `/api/chat` → middleware checks
tenant, origin and rate limit → attaches the cached Onyx service-account cookie →
proxies to Onyx → the response streams back unbuffered → widget renders tokens,
agent thinking, then citations and highlights. Grounding runs through `/ha/*` and
updates the answer's support state.

## Trust model

The tenant key sits in a public script tag. It is not a secret and cannot be
treated as one.

- **Origin allowlist** per tenant, plus `frame-ancestors` on the widget HTML.
  This stops casual re-embedding: someone dropping the key on their own site in a
  browser.
- It does **not** stop determined abuse. A server-side client can send any
  `Origin` header. Browser-enforced controls only bind browsers.
- **Cost control is the real defence.** Per-tenant and per-IP rate limits, plus a
  hard spend cap that is a required field on the tenant record. Every turn costs
  inference credits, so an uncapped public endpoint is a billing risk as much as
  a traffic one.
- Onyx credentials stay in middleware environment variables and never reach the
  browser — the property the current Volto middleware exists to provide.

Whether visitors need a disclosure that transcripts are processed by Onyx and the
inference provider is a policy decision, not a technical one.

## Degradation

- HallOumi unavailable — the answer still renders, the grounding badge is omitted.
- Onyx error or dropped stream — the partial answer is kept, with a retry
  affordance, and the conversation stays intact.
- Rate limited or over cap — an explicit message, so a site owner can tell "over
  quota" from "broken".
- Config unavailable — no launcher.

## Testing

Upstream's presentational components already have tests and we are not changing
them. Testing concentrates on the new boundaries.

**Middleware**, which holds the security properties:

- an allowed origin is accepted and others are rejected
- rate limit and spend cap fail closed
- the Onyx service cookie never appears in a client response
- streaming is incremental rather than buffered
- HallOumi failure degrades to an answer without grounding

**Loader**, the only code in the host page:

- injects exactly one iframe, and is idempotent if a site includes the script twice
- ignores `postMessage` from any origin but ours

**Widget shell:** a failed config fetch renders no launcher; config drives starter
prompts, title and theme.

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
question generation (`qgen`), Matomo tracking, and a config admin UI.
