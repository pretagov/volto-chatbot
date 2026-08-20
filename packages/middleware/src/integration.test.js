import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import { createApp } from './app.js';
import { mintToken } from './session.js';
import { __resetCache } from './onyxAuth.js';

// The mock is CommonJS and shared with the Playwright suite. createRequire lets
// this ESM test load it as-is rather than keeping a second copy in sync.
const require = createRequire(import.meta.url);
const { createOnyxMock } = require('../../../tests-playwright/fixtures/mock-onyx-server.js');

const SECRET = 'integration-secret';

const tenant = {
  tenantId: 'lecc',
  assistantId: '7',
  dailyTurnCap: 100,
  allowedOrigins: ['https://lecc.test'],
};

let onyxServer;
let baseUrl;

beforeAll(async () => {
  const mock = express();
  mock.use(express.json());
  mock.use(createOnyxMock());
  await new Promise((resolve) => {
    onyxServer = mock.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${onyxServer.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => onyxServer.close(resolve));
});

function appWith(overrides = {}) {
  return createApp({
    secret: SECRET,
    tenants: { get: async (id) => (id === 'lecc' ? tenant : null) },
    redis: { incr: async () => 1, expire: async () => {} },
    onyx: { baseUrl, username: 'admin', password: 'service-password' },
    halloumi: { url: `${baseUrl}/halloumi/generate`, token: 'llmgw-token' },
    ...overrides,
  });
}

const token = () => mintToken('lecc', SECRET, 3600);

describe('proxy against a real Onyx mock', () => {
  it('streams an answer through, logging in to Onyx on the way', async () => {
    __resetCache();
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((response, callback) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => callback(null, raw));
      })
      .send({ message: 'what is this about' });

    expect(res.status).toBe(200);
    // Chunked upstream means the widget gets an event stream.
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(String(res.body).length).toBeGreaterThan(0);
  });

  it('never leaks the Onyx session cookie or password to the client', async () => {
    // The entire reason this proxy exists.
    __resetCache();
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((response, callback) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => callback(null, raw));
      })
      .send({ message: 'hi' });

    const everything = JSON.stringify(res.headers) + String(res.body);
    expect(everything).not.toContain('service-password');
    expect(everything.toLowerCase()).not.toContain('set-cookie');
    expect(everything).not.toMatch(/fastapiusersauth/i);
  });

  it('reaches the health endpoint the rewake ping uses', async () => {
    const res = await request(appWith())
      .get('/_da/health')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
  });

  it('refuses a path outside the allowlist even with a valid token', async () => {
    const res = await request(appWith())
      .post('/_da/persona/-1')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('refuses turns when metering is unavailable', async () => {
    const res = await request(
      appWith({
        redis: {
          incr: async () => {
            throw new Error('redis down');
          },
          expire: async () => {},
        },
      }),
    )
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token()}`)
      .send({ message: 'hi' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('metering_unavailable');
  });
});

describe('grounding against the mock', () => {
  it('returns grounding claims', async () => {
    const res = await request(appWith())
      .post('/_ha/generate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ context: 'c', claims: ['a'] });

    expect(res.status).toBe(200);
    expect(res.body.claims[0].supported).toBe(true);
  });

  it('degrades to an answer without grounding when HallOumi is down', async () => {
    const res = await request(appWith({ halloumi: { url: 'http://127.0.0.1:1/nope' } }))
      .post('/_ha/generate')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.error).toBe('grounding unavailable');
  });
});

describe('protocol translation end to end', () => {
  it('delivers the old flat format to the client from a new-protocol backend', async () => {
    // The whole point: the backend speaks Packet envelopes, the components still
    // parse answer_piece, and neither had to change.
    __resetCache();
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((response, callback) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => callback(null, raw));
      })
      .send({ message: 'what is this about' });

    expect(res.status).toBe(200);

    const packets = String(res.body)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    // No Packet envelopes should survive translation.
    expect(packets.every((p) => p.obj === undefined)).toBe(true);

    // The answer arrives as answer_piece, in more than one piece.
    const pieces = packets.filter((p) => p.answer_piece && !p.answer_type);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((p) => p.answer_piece).join('')).toMatch(/mock answer/i);

    // TableRAG progress surfaces as agent sub-answers.
    const steps = packets.filter((p) => p.answer_type === 'agent_sub_answer');
    expect(steps.length).toBeGreaterThan(0);

    // Documents and citations come through.
    expect(packets.some((p) => p.top_documents)).toBe(true);
    expect(packets.some((p) => p.citations)).toBe(true);
  });

  it('reaches the renamed endpoint without the client knowing', async () => {
    __resetCache();
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((response, callback) => {
        let raw = '';
        response.on('data', (c) => {
          raw += c;
        });
        response.on('end', () => callback(null, raw));
      })
      .send({ message: 'hi' });

    // A 404 here would mean it hit the old, now-missing endpoint.
    expect(res.status).toBe(200);
  });
});

describe('tenant pinning under the new protocol', () => {
  it('pins the assistant when the session is created, not when a message is sent', async () => {
    // The new API has no persona field on SendMessageRequest — the assistant is
    // fixed by the chat session. So pinning has to happen at session creation, or
    // a caller could open a session against another tenant's assistant.
    __resetCache();

    let seenBody = null;
    const recorder = express();
    recorder.use(express.json());
    recorder.post('/api/chat/create-chat-session', (req, res) => {
      seenBody = req.body;
      res.json({ chat_session_id: 'recorded' });
    });
    const server = await new Promise((resolve) => {
      const s2 = recorder.listen(0, () => resolve(s2));
    });
    const recorderUrl = `http://127.0.0.1:${server.address().port}`;

    const app = createApp({
      secret: SECRET,
      tenants: { get: async () => tenant },
      redis: { incr: async () => 1, expire: async () => {} },
      onyx: { baseUrl: recorderUrl, apiKey: 'k' },
    });

    await request(app)
      .post('/_da/chat/create-chat-session')
      .set('Authorization', `Bearer ${token()}`)
      .send({ persona_id: 999, description: 'mine' });

    await new Promise((resolve) => server.close(resolve));

    // Whatever the client asked for, the tenant's assistant wins.
    expect(seenBody).not.toBeNull();
    expect(seenBody.persona_id).toBe(7);
    expect(seenBody.description).toBe('mine');
  });
});
