import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { mintToken } from './session.js';

const SECRET = 'test-secret';

const tenant = {
  tenantId: 'lecc',
  assistantId: '7',
  dailyTurnCap: 100,
  allowedOrigins: ['https://lecc.test'],
  chatTitle: 'Ask LECC',
  rewakeUrl: '/_da/health',
  rewakeDelay: 15,
};

function appWith(overrides = {}) {
  return createApp({
    secret: SECRET,
    tenants: { get: async (id) => (id === 'lecc' ? tenant : null) },
    redis: { incr: async () => 1, expire: async () => {} },
    onyx: { baseUrl: 'http://onyx.invalid', apiKey: 'service-key' },
    halloumi: { url: 'http://halloumi.invalid/generate', token: 't' },
    ...overrides,
  });
}

const validToken = () => mintToken('lecc', SECRET, 3600);

describe('GET /w/:tenant', () => {
  it('serves the widget document for an allowlisted embedding origin', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://lecc.test/page');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('sets frame-ancestors from the tenant allowlist', async () => {
    // This is the control that actually holds, since the Referer check is only
    // advisory.
    const res = await request(appWith()).get('/w/lecc');
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers['content-security-policy']).toContain('https://lecc.test');
  });

  it('rejects an embedding origin that is not allowlisted', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://evil.test/');
    expect(res.status).toBe(403);
  });

  it('404s an unknown tenant', async () => {
    expect((await request(appWith()).get('/w/nope')).status).toBe(404);
  });

  it('hands the widget a token and its tenant, not the assistant id', async () => {
    const res = await request(appWith()).get('/w/lecc');
    expect(res.text).toMatch(/__CHAT_TOKEN__/);
    expect(res.text).toMatch(/__CHAT_TENANT__/);
    expect(res.text).not.toContain('"7"');
  });
});

describe('GET /w/:tenant/config', () => {
  it('returns the widget config', async () => {
    const res = await request(appWith()).get('/w/lecc/config');
    expect(res.status).toBe(200);
    expect(res.body.chatTitle).toBe('Ask LECC');
    expect(res.body.rewakeUrl).toBe('/_da/health');
  });

  it('never includes server-only fields', async () => {
    const res = await request(appWith()).get('/w/lecc/config');
    expect(res.body.assistantId).toBeUndefined();
    expect(res.body.dailyTurnCap).toBeUndefined();
    expect(res.body.allowedOrigins).toBeUndefined();
  });
});

describe('GET /w/:tenant/session', () => {
  it('re-mints from an expired but validly signed token', async () => {
    const expired = mintToken('lecc', SECRET, -1);
    const res = await request(appWith())
      .get('/w/lecc/session')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('refuses to mint from nothing, so it cannot be a token faucet', async () => {
    expect((await request(appWith()).get('/w/lecc/session')).status).toBe(401);
  });

  it('refuses a token signed with another secret', async () => {
    const forged = mintToken('lecc', 'other-secret', 3600);
    const res = await request(appWith())
      .get('/w/lecc/session')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('refuses to re-mint across tenants', async () => {
    const other = mintToken('bathnes', SECRET, 3600);
    const res = await request(appWith())
      .get('/w/lecc/session')
      .set('Authorization', `Bearer ${other}`);
    expect(res.status).toBe(401);
  });
});

describe('proxy authentication', () => {
  it('rejects a call with no token', async () => {
    expect((await request(appWith()).post('/_da/chat/send-message').send({})).status).toBe(401);
  });

  it('rejects a forged token', async () => {
    const forged = mintToken('lecc', 'other-secret', 3600);
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${forged}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects an expired token on the proxy, unlike the re-mint endpoint', async () => {
    const expired = mintToken('lecc', SECRET, -1);
    const res = await request(appWith())
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${expired}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('refuses a path outside the allowlist even with a valid token', async () => {
    const res = await request(appWith())
      .post('/_da/admin/delete-everything')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('refuses the turn when metering is unavailable', async () => {
    const res = await request(
      appWith({ redis: { incr: async () => { throw new Error('down'); }, expire: async () => {} } }),
    )
      .post('/_da/chat/send-message')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({ message: 'hi' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('metering_unavailable');
  });
});
