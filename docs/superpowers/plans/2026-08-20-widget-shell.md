# Embeddable Widget Shell Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser half of the embeddable chatbot — a loader script, an iframe-hosted React shell that reuses the add-on's chat components unmodified, and the guards that make those components work outside Volto.

**Architecture:** A new `packages/widget` workspace built with Vite. It imports `src/ChatBlock/*` **in place** and resolves their Volto-specific imports through build-time aliases, so upstream files are never edited and keep merging cleanly. The shell supplies what Volto used to: config (from `/w/:tenant/config`), a settings registry, a `fetch` wrapper that attaches the session token, and a storage guard.

**Tech Stack:** Vite 5, React 18, Vitest + jsdom, Playwright (existing), LESS.

**Spec:** `docs/superpowers/specs/2026-08-19-embeddable-chatbot-widget-design.md`
**Depends on:** Plan 1 (`packages/middleware`) — routes and the config contract.

---

## What the spec got wrong

Verified against the source before writing this. An implementer following the spec alone would hit all three:

| Spec | Reality |
| --- | --- |
| Styles are SCSS | They are **LESS** (`style.less`, `colors.less`). Vite needs the `less` package. |
| Six `@plone/*` shims | Also `@eeacms/volto-matomo/utils` (**4 call sites**) and `@loadable/component`. |
| — | `ChatWindow` imports `#stores/sidebarStore`, a package `imports` subpath mapping to `./src/sidebar/stores/*`. |

`ChatWindow` also takes `rehypePrism` and `remarkGfm` **as props**, injected by `injectLazyLibs` — the shell must supply them.

## The real alias surface

| Specifier | Approach |
| --- | --- |
| `@plone/volto/helpers/Loadable/Loadable`, `@plone/volto/helpers/Loadable` | Shim `injectLazyLibs` as a HOC passing the libs it is asked for. Both paths are used. |
| `@plone/volto/helpers` | Reimplement `usePrevious`. |
| `@plone/registry` | Writable settings singleton the shell seeds with `volto-chatbot` settings. |
| `@plone/volto-slate/editor/render` | Real dependency if it installs standalone, else a minimal `serializeNodes`. |
| `@plone/volto/icons/*.svg` | Local SVG files (Vite returns a URL string). |
| `@eeacms/volto-matomo/utils` | **No-op `trackEvent`.** Matomo is out of scope, but 4 components import it. |
| `@loadable/component` | Real npm dependency — works outside Volto. |
| `#stores/*` | Vite alias to `src/sidebar/stores/*`. |
| `@plone/volto/components` | **No shim** — editor-only (`ChatBlockEdit.jsx`), outside the graph. |

---

## Task 1: Widget package and Vite build

**Files:** Create `packages/widget/{package.json,vite.config.js,index.html,src/main.jsx}`

- [ ] **Step 1: Create the package**

```json
{
  "name": "@pretagov/chatbot-widget",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run"
  },
  "dependencies": {
    "@loadable/component": "^5.16.4",
    "@nanostores/react": "^0.7.2",
    "nanostores": "^0.10.3",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "semantic-ui-react": "^2.1.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "less": "^4.2.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Vite config with the alias map**

Aliases point at `src/shims/*` and at the add-on's own `src/`. Order matters: the
longer `@plone/volto/helpers/Loadable/Loadable` must precede
`@plone/volto/helpers`.

- [ ] **Step 3: Verify the toolchain**

Run: `pnpm install --filter @pretagov/chatbot-widget && pnpm --filter @pretagov/chatbot-widget exec vite --version`
Expected: a version prints.

- [ ] **Step 4: Commit**

---

## Task 2: The shims

**Files:** Create `packages/widget/src/shims/{loadable.jsx,helpers.js,registry.js,matomo.js,slate.jsx}`
**Test:** `packages/widget/src/shims/shims.test.js`

- [ ] **Step 1: Write the failing test** — `injectLazyLibs` passes named libs as props; `usePrevious` returns the prior value; the registry is writable and readable; `trackEvent` is callable and returns undefined.

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement each shim**, smallest thing that satisfies the consumer:
  - `loadable.jsx` — `injectLazyLibs(names)(Component)` resolving `rehypePrism`, `remarkGfm`, `luxon` via dynamic import
  - `helpers.js` — `usePrevious`
  - `registry.js` — `{ settings: {} }` default export, seeded at boot
  - `matomo.js` — `export const trackEvent = () => {}`
  - `slate.jsx` — `serializeNodes`

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

---

## Task 3: The fetch wrapper

The mechanism that makes the whole reuse strategy work: the reused components
issue bare `fetch()` calls with no header hook, and cannot be edited.

**Files:** Create `packages/widget/src/app/fetchWrapper.js`
**Test:** `packages/widget/src/app/fetchWrapper.test.js`

- [ ] **Step 1: Write the failing test**

Assert all of:
- attaches `Authorization` to `/_da/*` and `/_ha/*`
- attaches nothing to other URLs
- returns the `Response` **untouched**, so streaming stays incremental
- forwards `init.signal`, or the middleware's abort-metering behaviour cannot be exercised
- on `401`, re-mints once against `/w/<tenant>/session` and retries
- a second `401` surfaces rather than looping

- [ ] **Step 2: Run, expect failure**
- [ ] **Step 3: Implement** — patch `window.fetch`, preserving the original for re-mint calls
- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Commit**

---

## Task 4: The storage guard

`useBackendChat.js` touches `localStorage` directly for `chat-last-awake`. In
Safari with storage blocked, property access *throws*, inside a file we cannot
edit.

**Files:** Create `packages/widget/src/app/storageGuard.js`
**Test:** `packages/widget/src/app/storageGuard.test.js`

- [ ] **Step 1: Write the failing test** — with a `localStorage` whose getter throws, `getItem`/`setItem` must not throw after the guard is installed.
- [ ] **Step 2: Run, expect failure**
- [ ] **Step 3: Implement** — install an in-memory fallback when access throws
- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Commit**

---

## Task 5: Config provider and registry seeding

**Files:** Create `packages/widget/src/app/{ConfigProvider.jsx,boot.js}`
**Test:** `packages/widget/src/app/ConfigProvider.test.jsx`

- [ ] **Step 1: Write the failing test**
  - fetches `/w/<tenant>/config` using the tenant from `window.__CHAT_TENANT__`
  - a failed fetch renders **nothing** (fail closed — no broken bubble)
  - seeds the registry with `volto-chatbot` settings including `rewakeUrl` and `rewakeDelay`
- [ ] **Step 2–5:** implement, verify, commit

---

## Task 6: Launcher and panel shell

**Files:** Create `packages/widget/src/app/{Launcher.jsx,Panel.jsx,App.jsx}`
**Test:** `packages/widget/src/app/App.test.jsx`

- [ ] **Step 1: Write the failing test** — clicking the launcher posts an `open` message to the parent; closing posts `close`; the panel renders `ChatWindow` with config-driven props.
- [ ] **Step 2–5:** implement, verify, commit

---

## Task 7: Session persistence

**Files:** Modify `packages/widget/src/app/App.jsx`
**Test:** `packages/widget/src/app/session.test.js`

- [ ] **Step 1: Write the failing test** — the chat session id is stored per tenant and reused on reload; unreadable storage starts a fresh conversation rather than failing.
- [ ] **Step 2–5:** implement, verify, commit

---

## Task 8: `loader.js`

**Files:** Create `packages/widget/src/loader/loader.js`
**Test:** `packages/widget/src/loader/loader.test.js`

- [ ] **Step 1: Write the failing test**
  - injects exactly one iframe, and is idempotent if the script is included twice
  - reads `data-tenant` and `data-position`
  - resizes the iframe on `open`/`close`
  - **ignores `postMessage` from any origin but ours** (security test)
- [ ] **Step 2–5:** implement, verify, commit

---

## Task 9: CI guards

**Files:** Modify `packages/widget/package.json`, create `packages/widget/scripts/check-bundle.js`

- [ ] **Step 1:** Script asserting `superagent` is absent from the built bundle. `superagent`'s XHR calls would bypass the fetch wrapper entirely — no token, silent failure — and its reappearance on a reused path moves no file, so nothing else would catch it.
- [ ] **Step 2:** Wire into `build` so CI fails loudly.
- [ ] **Step 3:** Commit

---

## Task 10: End-to-end

**Files:** Create `tests-playwright/integration/widget-embed.spec.ts`, `tests-playwright/fixtures/host-page.html`

- [ ] **Step 1:** A plain host page with the script tag, pointed at the middleware and the extracted Onyx mock.
- [ ] **Step 2:** Click the launcher, send a message, assert a streamed answer with a citation.
- [ ] **Step 3:** Commit

---

## Done when

- `pnpm --filter @pretagov/chatbot-widget test` passes
- `pnpm --filter @pretagov/chatbot-widget build` passes, including the superagent guard
- The E2E spec passes against the middleware plus the Onyx mock
- No file under `src/ChatBlock/` has been modified
