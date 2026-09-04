# Embeddable Widget Middleware Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone multi-tenant middleware that serves the embeddable chatbot widget — tenant config, session tokens, an allowlisted Onyx proxy with streaming, HallOumi grounding, and spend metering.

**Architecture:** A standalone Express service in a new `middleware/` workspace. It ports the auth-proxy logic out of the Volto add-on's `src/middleware.js` and `src/halloumi/middleware.js` (which stay where they are and keep serving Plone), adding what multi-tenancy needs: an embedding-origin check at the widget document, a tenant-bound session token that proxy calls must carry, server-side pinning of tenant-scoped fields, and admission-time metering. It ships and is fully testable against a mock Onyx with no widget.

**Tech Stack:** Node 20, Express 4, Redis (`ioredis`), Postgres (`pg`), Vitest, Playwright (existing).

**Spec:** `docs/superpowers/specs/2026-08-19-embeddable-chatbot-widget-design.md`

**Plan 2** (widget shell, six `@plone` shims, `loader.js`, E2E) depends on the config contract and routes built here.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | Add `workspaces` (root is currently a single package) |
| `middleware/package.json` | Service deps and scripts |
| `middleware/src/contract.js` | **Shared config contract** — the one artifact the widget also imports |
| `middleware/src/tenants.js` | Tenant record load from Postgres, validation against the contract |
| `middleware/src/onyxAuth.js` | Service-account login and cookie caching (ported) |
| `middleware/src/proxy.js` | `/_da/*` — allowlist, tenant pinning, streaming passthrough |
| `middleware/src/halloumi.js` | `/_ha/*` — grounding proxy (ported) |
| `middleware/src/session.js` | Token mint/verify (HMAC), origin check helpers |
| `middleware/src/metering.js` | Redis admission counters, fail-closed |
| `middleware/src/routes.js` | Route wiring: `/w/:tenant`, `/w/:tenant/config`, `/w/:tenant/session` |
| `middleware/src/app.js` | Express app assembly (no `listen`, so tests can import it) |
| `middleware/src/server.js` | `listen` only |
| `middleware/migrations/001_tenants.sql` | Tenant table + seed |
| `tests-playwright/fixtures/mock-onyx-server.js` | Onyx + HallOumi mock, extracted so it runs without Plone |

Each file has one responsibility and is small enough to hold in context. `proxy.js` is the security-critical one and stays free of routing and config concerns.

---

## Task 1: Workspaces and the middleware package

**Files:**
- Modify: `package.json`
- Create: `middleware/package.json`, `middleware/vitest.config.js`

- [ ] **Step 1: Add the workspaces field**

In root `package.json`, after `"main"`, add:

```json
  "workspaces": ["middleware", "widget"],
```

`widget/` does not exist yet; npm tolerates a missing workspace dir only if it is never installed, so create a placeholder in Step 2 to be safe.

- [ ] **Step 2: Create the middleware package**

`middleware/package.json`:

```json
{
  "name": "@pretagov/chatbot-middleware",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0",
    "superagent": "^8.0.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "supertest": "^7.0.0"
  }
}
```

`middleware/vitest.config.js`:

```js
export default {
  test: { environment: 'node', include: ['src/**/*.test.js'] },
};
```

- [ ] **Step 3: Install and verify**

Run: `npm install --workspace @pretagov/chatbot-middleware`
Expected: installs without error; `middleware/node_modules` or root hoisting present.

- [ ] **Step 4: Commit**

```bash
git add package.json middleware/package.json middleware/vitest.config.js
git commit -m "chore: add middleware workspace"
```

---

## Task 2: The shared config contract

This is the artifact the spec calls "the first implementation task". The widget imports it in Plan 2, so it must not import Express, Postgres or anything server-only.

**Files:**
- Create: `middleware/src/contract.js`
- Test: `middleware/src/contract.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { DEFAULTS, validateTenantConfig, toWidgetConfig } from './contract.js';

describe('config contract', () => {
  it('rejects a tenant without an assistant id', () => {
    expect(() => validateTenantConfig({ tenantId: 'a', dailyTurnCap: 100 }))
      .toThrow(/assistantId/);
  });

  it('rejects a tenant without a spend cap', () => {
    expect(() => validateTenantConfig({ tenantId: 'a', assistantId: '7' }))
      .toThrow(/dailyTurnCap/);
  });

  it('fills presentation defaults', () => {
    const cfg = validateTenantConfig({
      tenantId: 'a', assistantId: '7', dailyTurnCap: 100, allowedOrigins: ['https://x.test'],
    });
    expect(cfg.chatTitle).toBe(DEFAULTS.chatTitle);
    expect(cfg.rewakeUrl).toBe('/_da/health');
  });

  it('never leaks server-only fields to the widget', () => {
    const cfg = validateTenantConfig({
      tenantId: 'a', assistantId: '7', dailyTurnCap: 100, allowedOrigins: ['https://x.test'],
    });
    const widget = toWidgetConfig(cfg);
    expect(widget.assistantId).toBeUndefined();
    expect(widget.dailyTurnCap).toBeUndefined();
    expect(widget.allowedOrigins).toBeUndefined();
    expect(widget.chatTitle).toBe(DEFAULTS.chatTitle);
  });
});
```

The last test encodes a spec requirement: the assistant id is pinned server-side, so it must never reach the browser where a caller could substitute it.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, "Failed to resolve import ./contract.js".

- [ ] **Step 3: Implement**

```js
// The one config contract. Two sources fill it: the Volto shell derives it from
// block data, this service serves it from a tenant record. Keep this file free of
// server-only imports — the widget bundles it.

export const DEFAULTS = {
  chatTitle: 'Ask a question',
  placeholderPrompt: 'Ask me anything…',
  starterPromptsHeading: '',
  enableStarterPrompts: true,
  starterPrompts: [],
  enableFeedback: true,
  showAssistantTitle: true,
  showAssistantDescription: false,
  showToolCalls: false,
  qualityCheck: false,
  qualityCheckContext: '',
  noSupportDocumentsMessage: '',
  // Registry-only settings. lib.js and useBackendChat.js read these from the
  // settings singleton, not from props, so the contract must carry them.
  // rewakeUrl MUST stay a path: the widget's fetch wrapper matches on path
  // prefix, and an absolute URL would send the health ping untokenised.
  rewakeUrl: '/_da/health',
  rewakeDelay: 15,
};

// Fields the widget must never see.
const SERVER_ONLY = ['assistantId', 'dailyTurnCap', 'allowedOrigins', 'tenantId'];

export function validateTenantConfig(record) {
  if (!record?.tenantId) throw new Error('tenant record needs a tenantId');
  if (!record.assistantId) throw new Error('tenant record needs an assistantId');
  // Required, not optional: an uncapped public endpoint that costs inference
  // credits per turn is a billing risk, not just a traffic one.
  if (typeof record.dailyTurnCap !== 'number') {
    throw new Error('tenant record needs a numeric dailyTurnCap');
  }
  return { ...DEFAULTS, allowedOrigins: [], ...record };
}

export function toWidgetConfig(config) {
  const out = { ...config };
  for (const key of SERVER_ONLY) delete out[key];
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/contract.js middleware/src/contract.test.js
git commit -m "feat(middleware): shared config contract with server-only field stripping"
```

---

## Task 3: Session tokens

**Files:**
- Create: `middleware/src/session.js`
- Test: `middleware/src/session.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { mintToken, verifyToken, originAllowed } from './session.js';

const SECRET = 'test-secret';

describe('session tokens', () => {
  it('round-trips a tenant-bound token', () => {
    const t = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(t, 'lecc', SECRET).valid).toBe(true);
  });

  it('rejects a token minted for another tenant', () => {
    const t = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(t, 'bathnes', SECRET).valid).toBe(false);
  });

  it('rejects a tampered token', () => {
    const t = mintToken('lecc', SECRET, 3600);
    expect(verifyToken(t.slice(0, -2) + 'xx', 'lecc', SECRET).valid).toBe(false);
  });

  it('reports expiry separately, so re-minting can require a valid signature', () => {
    const t = mintToken('lecc', SECRET, -1);
    const result = verifyToken(t, 'lecc', SECRET);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.signatureValid).toBe(true);
  });
});

describe('origin check', () => {
  it('allows a listed origin', () => {
    expect(originAllowed('https://x.test/page', ['https://x.test'])).toBe(true);
  });
  it('rejects an unlisted origin', () => {
    expect(originAllowed('https://evil.test/', ['https://x.test'])).toBe(false);
  });
  it('allows a missing referer — the check is advisory, frame-ancestors is load-bearing', () => {
    expect(originAllowed(undefined, ['https://x.test'])).toBe(true);
  });
});
```

The expiry test matters: `/w/:tenant/session` must re-mint only from an expired-but-validly-signed token, never from nothing, or it is a token faucet.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./session.js`.

- [ ] **Step 3: Implement**

```js
import crypto from 'node:crypto';

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function mintToken(tenantId, secret, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${tenantId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Returns signatureValid and expired separately so the re-mint endpoint can
// accept an expired token with a good signature and refuse everything else.
export function verifyToken(token, tenantId, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { valid: false, signatureValid: false, expired: false };
  const [tid, exp, mac] = parts;
  const expected = sign(`${tid}.${exp}`, secret);
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  const signatureValid =
    macBuf.length === expBuf.length && crypto.timingSafeEqual(macBuf, expBuf);
  const expired = Number(exp) < Math.floor(Date.now() / 1000);
  const sameTenant = tid === tenantId;
  return { valid: signatureValid && sameTenant && !expired, signatureValid, expired, sameTenant };
}

// Sec-Fetch-Site never names the origin, so this rests on Referer, which a page
// can suppress with Referrer-Policy: no-referrer. Absent Referer therefore
// passes — rejecting would break legitimate tenants — which makes this advisory.
// frame-ancestors is the control that still holds.
export function originAllowed(referer, allowedOrigins) {
  if (!referer) return true;
  let origin;
  try {
    origin = new URL(referer).origin;
  } catch {
    return true;
  }
  return allowedOrigins.includes(origin);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/session.js middleware/src/session.test.js
git commit -m "feat(middleware): tenant-bound session tokens and advisory origin check"
```

---

## Task 4: Metering

**Files:**
- Create: `middleware/src/metering.js`
- Test: `middleware/src/metering.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { admitTurn } from './metering.js';

function fakeRedis({ tenantCount = 0, ipCount = 0, fail = false } = {}) {
  return {
    async incr(key) {
      if (fail) throw new Error('redis down');
      return key.includes(':ip:') ? ++ipCount : ++tenantCount;
    },
    async expire() { if (fail) throw new Error('redis down'); },
  };
}

describe('admitTurn', () => {
  it('admits under the cap', async () => {
    const r = await admitTurn(fakeRedis(), { tenantId: 'a', dailyTurnCap: 5 }, '1.2.3.4');
    expect(r.admitted).toBe(true);
  });

  it('refuses over the tenant cap', async () => {
    const r = await admitTurn(fakeRedis({ tenantCount: 5 }), { tenantId: 'a', dailyTurnCap: 5 }, '1.2.3.4');
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('tenant_cap');
  });

  it('fails closed when redis is unavailable', async () => {
    const r = await admitTurn(fakeRedis({ fail: true }), { tenantId: 'a', dailyTurnCap: 5 }, '1.2.3.4');
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('metering_unavailable');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./metering.js`.

- [ ] **Step 3: Implement**

```js
const IP_WINDOW_SECONDS = 60;
const IP_LIMIT = 20;

function dayKey() {
  return new Date().toISOString().slice(0, 10); // UTC
}

// Metered at ADMISSION, never refunded. Inference is billed as tokens are
// produced, so counting completed turns would let a client abort every stream
// just before the end and spend without ever being counted.
export async function admitTurn(redis, tenant, clientIp) {
  try {
    const tenantKey = `chat:turns:${tenant.tenantId}:${dayKey()}`;
    const count = await redis.incr(tenantKey);
    await redis.expire(tenantKey, 60 * 60 * 26);
    if (count > tenant.dailyTurnCap) return { admitted: false, reason: 'tenant_cap' };

    const ipKey = `chat:turns:${tenant.tenantId}:ip:${clientIp}`;
    const ipCount = await redis.incr(ipKey);
    await redis.expire(ipKey, IP_WINDOW_SECONDS);
    if (ipCount > IP_LIMIT) return { admitted: false, reason: 'ip_rate' };

    return { admitted: true };
  } catch {
    // An outage is cheaper than an unbounded inference bill.
    return { admitted: false, reason: 'metering_unavailable' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/metering.js middleware/src/metering.test.js
git commit -m "feat(middleware): admission metering that fails closed"
```

---

## Task 5: Onyx auth (ported)

Port of `src/middleware.js` lines 18–65. Behaviour is unchanged; it moves into its own module so `proxy.js` stays focused.

**Files:**
- Create: `middleware/src/onyxAuth.js`
- Test: `middleware/src/onyxAuth.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAuthHeaders, __resetCache } from './onyxAuth.js';

beforeEach(() => __resetCache());

describe('getAuthHeaders', () => {
  it('uses the api key when one is configured, without logging in', async () => {
    const login = vi.fn();
    const headers = await getAuthHeaders({ apiKey: 'k' }, login);
    expect(headers.Authorization).toBe('Bearer k');
    expect(login).not.toHaveBeenCalled();
  });

  it('logs in once and reuses the cached cookie', async () => {
    const login = vi.fn().mockResolvedValue({ cookie: 'c=1', maxAge: 3600 });
    await getAuthHeaders({ username: 'u', password: 'p' }, login);
    const headers = await getAuthHeaders({ username: 'u', password: 'p' }, login);
    expect(login).toHaveBeenCalledTimes(1);
    expect(headers.Cookie).toBe('c=1');
  });

  it('throws when neither api key nor credentials are configured', async () => {
    await expect(getAuthHeaders({}, vi.fn())).rejects.toThrow(/configuration/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./onyxAuth.js`.

- [ ] **Step 3: Implement**

```js
import superagent from 'superagent';

let cached = null; // { cookie, expiresAt }

export function __resetCache() { cached = null; }

export async function loginToOnyx({ baseUrl, apiPrefix = '/api', username, password }) {
  const response = await superagent
    .post(`${baseUrl}${apiPrefix}/auth/login`)
    .type('form')
    .send({ username, password });
  const header = response.headers['set-cookie'][0];
  const maxAgeMatch = header.match(/Max-Age=(\d+)/);
  return {
    cookie: header.split(';')[0],
    maxAge: maxAgeMatch ? Number(maxAgeMatch[1]) : 3600,
  };
}

export async function getAuthHeaders(creds, login = loginToOnyx) {
  if (creds.apiKey) return { Authorization: `Bearer ${creds.apiKey}` };
  if (!(creds.username && creds.password)) {
    throw new Error('Invalid configuration: set an api key or a username and password');
  }
  const now = Date.now();
  if (!cached || cached.expiresAt <= now) {
    const { cookie, maxAge } = await login(creds);
    cached = { cookie, expiresAt: now + (maxAge - 60) * 1000 };
  }
  return { Cookie: cached.cookie };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/onyxAuth.js middleware/src/onyxAuth.test.js
git commit -m "feat(middleware): port Onyx service-account auth with cookie caching"
```

---

## Task 6: The proxy — allowlist and tenant pinning

The security-critical file. Two properties must hold: only allowlisted Onyx paths are reachable, and tenant-scoped fields come from the tenant record rather than the client.

**Files:**
- Create: `middleware/src/proxy.js`
- Test: `middleware/src/proxy.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { resolveOnyxPath, pinTenantFields, ALLOWED_PATHS } from './proxy.js';

describe('resolveOnyxPath', () => {
  it('maps a proxied path onto the Onyx api prefix', () => {
    expect(resolveOnyxPath('/_da/chat/send-message')).toBe('/api/chat/send-message');
  });

  it('allows exactly the four documented paths', () => {
    expect([...ALLOWED_PATHS].sort()).toEqual([
      'chat/create-chat-message-feedback',
      'chat/create-chat-session',
      'chat/send-message',
      'health',
    ]);
  });

  it('refuses a path that is not allowlisted', () => {
    expect(resolveOnyxPath('/_da/persona/-1')).toBeNull();
    expect(resolveOnyxPath('/_da/admin/delete-everything')).toBeNull();
  });

  it('refuses traversal attempts', () => {
    expect(resolveOnyxPath('/_da/chat/../admin')).toBeNull();
  });
});

describe('pinTenantFields', () => {
  it('overrides a client-supplied assistant id', () => {
    const body = pinTenantFields({ message: 'hi', persona_id: '999' }, { assistantId: '7' });
    expect(body.persona_id).toBe('7');
    expect(body.alternate_assistant_id).toBe('7');
    expect(body.message).toBe('hi');
  });
});
```

The `pinTenantFields` test encodes the cross-tenant leak the spec calls out: the assistant is client config today, so proxying it unchanged would let one tenant's endpoint drive another tenant's assistant.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./proxy.js`.

- [ ] **Step 3: Implement**

```js
// Exactly the paths the reused components call. persona/-1 is deliberately
// absent: the credential check hits it server-to-server inside login(), never
// through this proxy, so allowing it would widen the surface this list narrows.
export const ALLOWED_PATHS = new Set([
  'chat/send-message',
  'chat/create-chat-session',
  'chat/create-chat-message-feedback',
  'health',
]);

const API_PREFIX = '/api';

export function resolveOnyxPath(url) {
  const withoutPrefix = String(url).replace(/^\/_da\//, '');
  const path = withoutPrefix.split('?')[0];
  if (path.includes('..')) return null;
  if (!ALLOWED_PATHS.has(path)) return null;
  return `${API_PREFIX}/${path}`;
}

// Tenant-scoped fields come from the tenant record; client values are ignored.
export function pinTenantFields(body, tenant) {
  if (!body || typeof body !== 'object') return body;
  const pinned = { ...body };
  if ('persona_id' in pinned || 'alternate_assistant_id' in pinned || true) {
    pinned.persona_id = tenant.assistantId;
    pinned.alternate_assistant_id = tenant.assistantId;
  }
  return pinned;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/proxy.js middleware/src/proxy.test.js
git commit -m "feat(middleware): Onyx path allowlist and server-side tenant pinning"
```

---

## Task 7: Streaming passthrough

Ported from `src/middleware.js` lines 100–124. The property that matters is that the response is piped, not buffered.

**Files:**
- Modify: `middleware/src/proxy.js`
- Test: `middleware/src/proxy.test.js`

- [ ] **Step 1: Write the failing test**

Append to `proxy.test.js`:

```js
import { forwardToOnyx } from './proxy.js';
import { Readable } from 'node:stream';

describe('forwardToOnyx', () => {
  it('pipes the body through rather than buffering it', async () => {
    const chunks = ['a', 'b', 'c'];
    const upstream = {
      headers: new Map([['transfer-encoding', 'chunked']]),
      body: Readable.from(chunks),
    };
    upstream.headers.get = (k) => new Map([['transfer-encoding', 'chunked']]).get(k);

    const written = [];
    const res = {
      set: () => {},
      write: (c) => written.push(String(c)),
      end: () => {},
      on: () => {},
    };
    await forwardToOnyx(upstream, res, {});
    expect(written.join('')).toBe('abc');
  });

  it('marks a chunked upstream response as an event stream', async () => {
    const set = {};
    const upstream = { headers: { get: () => 'chunked' }, body: Readable.from(['x']) };
    const res = { set: (k, v) => (set[k] = v), write: () => {}, end: () => {}, on: () => {} };
    await forwardToOnyx(upstream, res, {});
    expect(set['Content-Type']).toBe('text/event-stream');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, `forwardToOnyx is not a function`.

- [ ] **Step 3: Implement**

Append to `proxy.js`:

```js
// Streaming must stay incremental: the widget renders tokens as they arrive.
export async function forwardToOnyx(upstream, res, { apiKey } = {}) {
  if (apiKey) {
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
  } else if (upstream.headers.get('transfer-encoding') === 'chunked') {
    res.set('Content-Type', 'text/event-stream');
  } else {
    res.set('Content-Type', 'application/json');
  }

  return new Promise((resolve, reject) => {
    upstream.body.on('error', reject);
    upstream.body.on('end', resolve);
    upstream.body.pipe(res);
  });
}
```

Note: the test's fake `res` implements `write`/`end`/`on`, which `pipe` needs.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/proxy.js middleware/src/proxy.test.js
git commit -m "feat(middleware): stream Onyx responses without buffering"
```

---

## Task 8: Tenant store

**Files:**
- Create: `middleware/src/tenants.js`, `middleware/migrations/001_tenants.sql`
- Test: `middleware/src/tenants.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { rowToTenant } from './tenants.js';

describe('rowToTenant', () => {
  it('maps a database row through the contract, filling defaults', () => {
    const tenant = rowToTenant({
      tenant_id: 'lecc',
      assistant_id: '7',
      daily_turn_cap: 500,
      allowed_origins: ['https://lecc.test'],
      config: { chatTitle: 'Ask LECC' },
    });
    expect(tenant.assistantId).toBe('7');
    expect(tenant.chatTitle).toBe('Ask LECC');
    expect(tenant.rewakeUrl).toBe('/_da/health');
  });

  it('refuses a row with no cap', () => {
    expect(() => rowToTenant({ tenant_id: 'a', assistant_id: '7', config: {} }))
      .toThrow(/dailyTurnCap/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./tenants.js`.

- [ ] **Step 3: Implement**

`middleware/src/tenants.js`:

```js
import { validateTenantConfig } from './contract.js';

export function rowToTenant(row) {
  return validateTenantConfig({
    tenantId: row.tenant_id,
    assistantId: row.assistant_id,
    dailyTurnCap: row.daily_turn_cap,
    allowedOrigins: row.allowed_origins || [],
    ...(row.config || {}),
  });
}

export function createTenantStore(pool) {
  return {
    async get(tenantId) {
      const { rows } = await pool.query(
        'SELECT * FROM chatbot_tenant WHERE tenant_id = $1', [tenantId],
      );
      return rows[0] ? rowToTenant(rows[0]) : null;
    },
  };
}
```

`middleware/migrations/001_tenants.sql`:

```sql
CREATE TABLE IF NOT EXISTS chatbot_tenant (
    tenant_id       TEXT PRIMARY KEY,
    assistant_id    TEXT        NOT NULL,
    -- Required, not nullable: an uncapped public endpoint is a billing risk.
    daily_turn_cap  INTEGER     NOT NULL,
    allowed_origins TEXT[]      NOT NULL DEFAULT '{}',
    config          JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/tenants.js middleware/src/tenants.test.js middleware/migrations/001_tenants.sql
git commit -m "feat(middleware): tenant store and schema"
```

---

## Task 9: Routes and app assembly

**Files:**
- Create: `middleware/src/routes.js`, `middleware/src/app.js`, `middleware/src/server.js`
- Test: `middleware/src/app.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

const tenant = {
  tenantId: 'lecc', assistantId: '7', dailyTurnCap: 100,
  allowedOrigins: ['https://lecc.test'], chatTitle: 'Ask LECC', rewakeUrl: '/_da/health',
};

function appWith(overrides = {}) {
  return createApp({
    secret: 's',
    tenants: { get: async (id) => (id === 'lecc' ? tenant : null) },
    redis: { incr: async () => 1, expire: async () => {} },
    onyx: { baseUrl: 'http://onyx.test', apiKey: 'k' },
    ...overrides,
  });
}

describe('GET /w/:tenant', () => {
  it('serves the widget document and sets frame-ancestors from the allowlist', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://lecc.test/a');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self' https://lecc.test");
  });

  it('rejects an unlisted embedding origin', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://evil.test/');
    expect(res.status).toBe(403);
  });

  it('404s an unknown tenant', async () => {
    const res = await request(appWith()).get('/w/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /w/:tenant/config', () => {
  it('returns widget config without server-only fields', async () => {
    const res = await request(appWith()).get('/w/lecc/config');
    expect(res.status).toBe(200);
    expect(res.body.chatTitle).toBe('Ask LECC');
    expect(res.body.assistantId).toBeUndefined();
    expect(res.body.allowedOrigins).toBeUndefined();
  });
});

describe('proxy auth', () => {
  it('rejects a /_da/ call with no token', async () => {
    const res = await request(appWith()).post('/_da/chat/send-message').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, cannot resolve `./app.js`.

- [ ] **Step 3: Implement**

`middleware/src/routes.js`:

```js
import { toWidgetConfig } from './contract.js';
import { mintToken, verifyToken, originAllowed } from './session.js';
import { admitTurn } from './metering.js';
import { resolveOnyxPath, pinTenantFields, forwardToOnyx } from './proxy.js';
import { getAuthHeaders } from './onyxAuth.js';

const TOKEN_TTL_SECONDS = 60 * 60;

export function registerRoutes(app, deps) {
  const { tenants, secret, redis, onyx, renderWidget } = deps;

  async function loadTenant(req, res, next) {
    const tenant = await tenants.get(req.params.tenant);
    if (!tenant) return res.status(404).send({ error: 'unknown tenant' });
    req.tenant = tenant;
    next();
  }

  // The embedding origin is only observable here, on the document request.
  app.get('/w/:tenant', loadTenant, (req, res) => {
    if (!originAllowed(req.get('referer'), req.tenant.allowedOrigins)) {
      return res.status(403).send({ error: 'origin not allowed' });
    }
    const ancestors = ["'self'", ...req.tenant.allowedOrigins].join(' ');
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    res.set('Content-Type', 'text/html');
    res.send(renderWidget(req.tenant, mintToken(req.tenant.tenantId, secret, TOKEN_TTL_SECONDS)));
  });

  app.get('/w/:tenant/config', loadTenant, (req, res) => {
    res.send(toWidgetConfig(req.tenant));
  });

  // Re-mint. Never mints from nothing: requires an expired but validly signed
  // token for the same tenant, or it is a token faucet.
  app.get('/w/:tenant/session', loadTenant, (req, res) => {
    const presented = (req.get('authorization') || '').replace(/^Bearer /, '');
    const result = verifyToken(presented, req.tenant.tenantId, secret);
    if (!result.signatureValid || !result.sameTenant) {
      return res.status(401).send({ error: 'invalid token' });
    }
    res.send({ token: mintToken(req.tenant.tenantId, secret, TOKEN_TTL_SECONDS) });
  });

  async function authenticateProxy(req, res, next) {
    const presented = (req.get('authorization') || '').replace(/^Bearer /, '');
    const tenantId = presented.split('.')[0];
    const tenant = await tenants.get(tenantId);
    if (!tenant) return res.status(401).send({ error: 'unauthenticated' });
    if (!verifyToken(presented, tenantId, secret).valid) {
      return res.status(401).send({ error: 'unauthenticated' });
    }
    req.tenant = tenant;
    next();
  }

  app.all('/_da/*', authenticateProxy, async (req, res) => {
    const onyxPath = resolveOnyxPath(req.url);
    if (!onyxPath) return res.status(403).send({ error: 'path not allowed' });

    if (req.method === 'POST') {
      const admission = await admitTurn(redis, req.tenant, req.get('fly-client-ip') || req.ip);
      if (!admission.admitted) {
        return res.status(429).send({ error: admission.reason });
      }
    }

    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders(onyx)) };
    const body = req.method === 'POST'
      ? JSON.stringify(pinTenantFields(req.body, req.tenant))
      : undefined;

    const upstream = await fetch(`${onyx.baseUrl}${onyxPath}`, { method: req.method, headers, body });
    await forwardToOnyx(upstream, res, onyx);
  });
}
```

`middleware/src/app.js`:

```js
import express from 'express';
import { registerRoutes } from './routes.js';

const defaultRenderWidget = (tenant, token) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<script>window.__CHAT_TOKEN__=${JSON.stringify(token)};` +
  `window.__CHAT_TENANT__=${JSON.stringify(tenant.tenantId)};</script>` +
  `</head><body><div id="root"></div></body></html>`;

export function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerRoutes(app, { renderWidget: defaultRenderWidget, ...deps });
  return app;
}
```

`middleware/src/server.js`:

```js
import pg from 'pg';
import Redis from 'ioredis';
import { createApp } from './app.js';
import { createTenantStore } from './tenants.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp({
  secret: process.env.SESSION_SECRET,
  tenants: createTenantStore(pool),
  redis: new Redis(process.env.REDIS_URL),
  onyx: {
    baseUrl: process.env.DANSWER_URL,
    username: process.env.DANSWER_USERNAME,
    password: process.env.DANSWER_PASSWORD,
    apiKey: process.env.DANSWER_API_KEY,
  },
});

app.listen(process.env.PORT || 8080);
```

The widget bundle is injected into `renderWidget` in Plan 2; the token and tenant are handed to the shell on `window` so the fetch wrapper has them before any component runs.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS, 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/routes.js middleware/src/app.js middleware/src/server.js middleware/src/app.test.js
git commit -m "feat(middleware): routes, origin check, frame-ancestors and proxy auth"
```

---

## Task 10: HallOumi proxy

**Files:**
- Create: `middleware/src/halloumi.js`
- Modify: `middleware/src/routes.js`
- Test: `middleware/src/app.test.js`

- [ ] **Step 1: Write the failing test**

Append to `app.test.js`:

```js
describe('GET /_ha/*', () => {
  it('rejects an unauthenticated grounding call', async () => {
    const res = await request(appWith()).post('/_ha/generate').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: FAIL, 404 rather than 401 (route absent).

- [ ] **Step 3: Implement**

`middleware/src/halloumi.js`:

```js
// Ported from src/halloumi/middleware.js. Grounding is not streamed.
export async function callHalloumi(body, { url, token }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return response.json();
}
```

In `routes.js`, add after the `/_da/*` handler:

```js
  app.all('/_ha/*', authenticateProxy, async (req, res) => {
    // Grounding failure must degrade to an answer without a badge, never 500.
    try {
      res.send(await callHalloumi(req.body, deps.halloumi));
    } catch (error) {
      res.status(200).send({ error: 'grounding unavailable' });
    }
  });
```

Import `callHalloumi` at the top of `routes.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add middleware/src/halloumi.js middleware/src/routes.js middleware/src/app.test.js
git commit -m "feat(middleware): HallOumi grounding proxy that degrades on failure"
```

---

## Task 11: Extract the Onyx mock

`tests-playwright/fixtures/mock-plone-server.js` mocks both Plone and Onyx. The widget needs Onyx without Plone. These files are ours alone — upstream has no version — so restructuring is safe.

**Files:**
- Create: `tests-playwright/fixtures/mock-onyx-server.js`
- Modify: `tests-playwright/fixtures/mock-plone-server.js`

- [ ] **Step 1: Create the Onyx mock**

Move the Onyx routes (`/api/auth/login`, `/api/persona/-1`, `/api/chat/create-chat-session`, `/api/chat/send-message`) out of `mock-plone-server.js` into a router:

```js
// Onyx (Danswer) + HallOumi mock, usable without Plone.
const express = require('express');

function createOnyxMock() {
  const router = express.Router();

  router.post('/api/auth/login', (req, res) => {
    res.set('set-cookie', 'fastapiusersauth=mock-cookie; Max-Age=3600; Path=/');
    res.send({ ok: true });
  });

  router.get('/api/persona/-1', (req, res) => res.send({ id: -1, name: 'mock' }));

  router.post('/api/chat/create-chat-session', (req, res) =>
    res.send({ chat_session_id: 'mock-session' }));

  // Chunked, so streaming stays testable.
  router.post('/api/chat/send-message', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    const packets = [
      { answer_piece: 'Hello ' },
      { answer_piece: 'from the mock.' },
      { top_documents: [{ document_id: 'doc-1', semantic_identifier: 'Mock doc', blurb: 'b' }] },
    ];
    let i = 0;
    const tick = setInterval(() => {
      if (i >= packets.length) { clearInterval(tick); return res.end(); }
      res.write(JSON.stringify(packets[i++]) + '\n');
    }, 10);
  });

  router.post('/api/chat/create-chat-message-feedback', (req, res) => res.send({ ok: true }));
  router.get('/api/health', (req, res) => res.send({ status: 'ok' }));

  // HallOumi — absent from the original mock.
  router.post('/halloumi/generate', (req, res) =>
    res.send({ claims: [{ supported: true, score: 0.9 }] }));

  return router;
}

module.exports = { createOnyxMock };

if (require.main === module) {
  const app = express();
  app.use(express.json());
  app.use(createOnyxMock());
  app.listen(process.env.PORT || 9000);
}
```

- [ ] **Step 2: Mount it from the Plone mock**

In `mock-plone-server.js`, delete the moved route handlers and add near the other `app.use` calls:

```js
const { createOnyxMock } = require('./mock-onyx-server');
app.use(createOnyxMock());
```

- [ ] **Step 3: Verify the existing Playwright suite still passes**

Run: `npm run test:playwright`
Expected: same results as before the extraction — no new failures.

- [ ] **Step 4: Commit**

```bash
git add tests-playwright/fixtures/mock-onyx-server.js tests-playwright/fixtures/mock-plone-server.js
git commit -m "test: extract the Onyx mock so it runs without Plone, add HallOumi"
```

---

## Task 12: Middleware integration test against the mock

**Files:**
- Create: `middleware/src/integration.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from './app.js';
import { mintToken } from './session.js';
const { createOnyxMock } = require('../../tests-playwright/fixtures/mock-onyx-server.js');

let onyxServer, baseUrl;

beforeAll(async () => {
  const mock = express();
  mock.use(express.json());
  mock.use(createOnyxMock());
  await new Promise((r) => (onyxServer = mock.listen(0, r)));
  baseUrl = `http://127.0.0.1:${onyxServer.address().port}`;
});

afterAll(() => onyxServer.close());

const tenant = {
  tenantId: 'lecc', assistantId: '7', dailyTurnCap: 100, allowedOrigins: ['https://lecc.test'],
};

function app() {
  return createApp({
    secret: 's',
    tenants: { get: async (id) => (id === 'lecc' ? tenant : null) },
    redis: { incr: async () => 1, expire: async () => {} },
    onyx: { baseUrl, apiKey: 'k' },
    halloumi: { url: `${baseUrl}/halloumi/generate`, token: 't' },
  });
}

describe('proxy end to end', () => {
  it('streams an answer and never leaks the service credential', async () => {
    const token = mintToken('lecc', 's', 3600);
    const res = await request(app())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hi', persona_id: '999' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello');
    expect(JSON.stringify(res.headers)).not.toMatch(/mock-cookie|Bearer k/);
  });

  it('refuses a path outside the allowlist', async () => {
    const token = mintToken('lecc', 's', 3600);
    const res = await request(app())
      .post('/_da/admin/delete')
      .set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
  });

  it('refuses turns when metering is unavailable', async () => {
    const token = mintToken('lecc', 's', 3600);
    const failing = createApp({
      secret: 's',
      tenants: { get: async () => tenant },
      redis: { incr: async () => { throw new Error('down'); }, expire: async () => {} },
      onyx: { baseUrl, apiKey: 'k' },
    });
    const res = await request(failing)
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token}`).send({ message: 'hi' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('metering_unavailable');
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test --workspace @pretagov/chatbot-middleware`
Expected: PASS. If the CommonJS `require` of the mock fails under ESM, convert the mock to `export function createOnyxMock` and import it — do not duplicate the mock.

- [ ] **Step 3: Commit**

```bash
git add middleware/src/integration.test.js
git commit -m "test(middleware): integration coverage against the Onyx mock"
```

---

## Done when

- `npm test --workspace @pretagov/chatbot-middleware` passes
- `npm run test:playwright` still passes after the mock extraction
- The service starts with `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `DANSWER_URL` and either `DANSWER_API_KEY` or `DANSWER_USERNAME`/`DANSWER_PASSWORD`

**Not in this plan** (Plan 2): `loader.js`, the widget shell, the six `@plone` shims, the fetch wrapper and storage guard, the superagent bundle guard, and the end-to-end test through a real host page.
