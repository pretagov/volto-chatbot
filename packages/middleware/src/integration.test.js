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
