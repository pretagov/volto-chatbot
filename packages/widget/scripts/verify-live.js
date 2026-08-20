#!/usr/bin/env node
/**
 * Drives a real chat turn against live Onyx through the widget's own fetch
 * wrapper, with no server in between.
 *
 * The unit tests prove the translation is correct against a mock we wrote. This
 * is the check that the real backend emits what we think it does - which
 * matters, because a mock serving a dead contract is exactly what hid the
 * broken demo in the first place.
 *
 * Usage:
 *   node scripts/verify-live.js
 *   ONYX_URL=https://pg-demo-onyx.fly.dev  PERSONA=12  TOOL=1  QUESTION="..."
 */
import { installFetchWrapper } from '../src/app/fetchWrapper.js';

const ONYX_URL = process.env.ONYX_URL || 'https://pg-demo-onyx.fly.dev';
const PERSONA = process.env.PERSONA || '12';
const TOOL = process.env.TOOL || '1';
const QUESTION = process.env.QUESTION || 'How do I pay my council tax?';

installFetchWrapper({ onyxBaseUrl: ONYX_URL, personaId: PERSONA, forcedToolId: TOOL });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log(`\nverifying against ${ONYX_URL} as persona ${PERSONA}, no server\n`);

// The widget calls these exact paths; the wrapper is what turns them into Onyx.
const health = await fetch('/_da/health');
check('health reaches Onyx', health.ok, `status ${health.status}`);

const sessionRes = await fetch('/_da/chat/create-chat-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const session = await sessionRes.json().catch(() => ({}));
check('create-chat-session succeeds', sessionRes.ok, `status ${sessionRes.status}`);
check('a session id comes back', Boolean(session.chat_session_id));

if (!session.chat_session_id) {
  console.log('\nno session, cannot send a message\n');
  process.exit(1);
}

const answerRes = await fetch('/_da/chat/send-message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: QUESTION, chat_session_id: session.chat_session_id }),
});
check('send-message reaches the renamed endpoint', answerRes.ok, `status ${answerRes.status}`);

const packets = (await answerRes.text())
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => {
    try {
      return JSON.parse(line);
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
check(
  'documents came through',
  packets.some((p) => p.top_documents),
);

if (text) console.log(`\n  answer: ${text.slice(0, 300)}${text.length > 300 ? '…' : ''}\n`);
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
