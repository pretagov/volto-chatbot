#!/usr/bin/env node
/**
 * Runs the middleware locally against LIVE Onyx and proves a real chat turn
 * survives translation.
 *
 * The unit and integration tests only prove the translation is correct against a
 * mock we wrote. This is the check that the real backend emits what we think it
 * does — which matters, because a mock serving a dead contract is exactly what
 * hid the broken demo in the first place.
 *
 * Usage:
 *   ONYX_API_KEY=... node scripts/verify-live.js
 *   ONYX_URL=https://pg-demo-onyx.fly.dev  (default)
 *   TENANT_ASSISTANT_ID=0                  (persona to pin, default 0)
 */
import { createApp } from '../src/app.js';
import { mintToken } from '../src/session.js';

const ONYX_URL = process.env.ONYX_URL || 'https://pg-demo-onyx.fly.dev';
const API_KEY = process.env.ONYX_API_KEY;
const ANONYMOUS = process.env.ONYX_ANONYMOUS === 'true';
const ASSISTANT_ID = process.env.TENANT_ASSISTANT_ID || '0';
const SECRET = 'local-verify-secret';

if (!ANONYMOUS && !API_KEY) {
  console.error('Set ONYX_API_KEY, or ONYX_ANONYMOUS=true to call Onyx anonymously.');
  process.exit(1);
}

const tenant = {
  tenantId: 'local',
  assistantId: ASSISTANT_ID,
  dailyTurnCap: 50,
  allowedOrigins: ['http://localhost'],
  rewakeUrl: '/_da/health',
  rewakeDelay: 15,
};

// In-memory stand-ins so this needs no Postgres or Redis.
const app = createApp({
  secret: SECRET,
  tenants: { get: async () => tenant },
  redis: { incr: async () => 1, expire: async () => {} },
  onyx: ANONYMOUS
    ? { baseUrl: ONYX_URL, anonymous: true }
    : { baseUrl: ONYX_URL, apiKey: API_KEY },
  halloumi: { url: process.env.LLMGW_URL, token: process.env.LLMGW_TOKEN },
});

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const token = mintToken('local', SECRET, 3600);
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

function report(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

let failures = 0;
const check = (label, ok, detail) => {
  if (!report(label, ok, detail)) failures += 1;
};

try {
  console.log(`\nverifying against ${ONYX_URL}\n`);

  // 1. Health, which now lives at the root rather than under /api.
  const health = await fetch(`${base}/_da/health`, { headers: auth });
  check('health reaches the root endpoint', health.ok, `status ${health.status}`);

  // 2. Session creation, where the tenant's assistant is pinned.
  const sessionRes = await fetch(`${base}/_da/chat/create-chat-session`, {
    method: 'POST',
    headers: auth,
    // Deliberately ask for a different persona: the middleware must override it.
    body: JSON.stringify({ persona_id: 99999, description: 'live verification' }),
  });
  const session = await sessionRes.json().catch(() => ({}));
  check('create-chat-session succeeds', sessionRes.ok, `status ${sessionRes.status}`);
  check('a session id comes back', Boolean(session.chat_session_id), JSON.stringify(session).slice(0, 120));

  if (!session.chat_session_id) throw new Error('no session, cannot send a message');

  // 3. The chat turn: old path in, translated old-format packets out.
  const answer = await fetch(`${base}/_da/chat/send-message`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      // Retrieval is agentic now: the assistant decides whether to search. A
      // question it can answer conversationally will not exercise the search
      // packets, so ask one that requires the corpus.
      message:
        process.env.QUESTION ||
        'Search the indexed documents and tell me what topics they cover.',
      chat_session_id: session.chat_session_id,
      // Retrieval is the assistant's choice now, so these let the check probe
      // whether forcing the search tool or switching model changes the outcome.
      ...(process.env.FORCED_TOOL_ID
        ? { forced_tool_id: Number(process.env.FORCED_TOOL_ID) }
        : {}),
      ...(process.env.MODEL
        ? {
            llm_override: {
              model_provider: process.env.MODEL_PROVIDER,
              model_version: process.env.MODEL,
            },
          }
        : {}),
    }),
  });
  check('send-message reaches the renamed endpoint', answer.ok, `status ${answer.status}`);

  const raw = await answer.text();
  const packets = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  check('packets came back', packets.length > 0, `${packets.length} packets`);
  check(
    'no Packet envelopes survived translation',
    packets.every((p) => p.obj === undefined),
  );

  const pieces = packets.filter((p) => p.answer_piece && !p.answer_type);
  const text = pieces.map((p) => p.answer_piece).join('');
  check('an answer arrived', text.length > 0, `${text.length} chars`);
  check('it streamed in pieces rather than one block', pieces.length > 1, `${pieces.length} pieces`);

  const docs = packets.filter((p) => p.top_documents);
  check('documents came through', docs.length > 0, `${docs.length} document packets`);

  const steps = packets.filter((p) => p.answer_type === 'agent_sub_answer');
  console.log(`  note  ${steps.length} progress step packet(s)` + (steps.length ? '' : ' (none — expected unless TableRAG ran)'));

  if (text) console.log(`\n  answer: ${text.slice(0, 300)}${text.length > 300 ? '…' : ''}\n`);
} catch (error) {
  failures += 1;
  console.error(`\n  FAILED: ${error.message}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
