import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';

// Exercises the wiring between the built widget and the service: without a
// widgetDist the service happily serves a page with no widget in it, which looks
// fine in every other test and is broken in a browser.

const SECRET = 'test-secret';
const tenant = {
  tenantId: 'lecc',
  assistantId: '7',
  dailyTurnCap: 100,
  allowedOrigins: ['https://lecc.test'],
};

let dist;

beforeAll(() => {
  // A stand-in for the widget build rather than the real one, so this does not
  // require a build to have run.
  dist = mkdtempSync(join(tmpdir(), 'widget-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<script type="module" crossorigin src="/assets/widget-abc.js"></script>' +
      '</head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(dist, 'assets', 'widget-abc.js'), 'export const built = true;');
  writeFileSync(join(dist, 'loader.js'), 'window.__LOADER__ = true;');
});

afterAll(() => rmSync(dist, { recursive: true, force: true }));

const appWith = () =>
  createApp({
    secret: SECRET,
    tenants: { get: async (id) => (id === 'lecc' ? tenant : null) },
    redis: { incr: async () => 1, expire: async () => {} },
    onyx: { baseUrl: 'http://onyx.invalid', anonymous: true },
    halloumi: { url: 'http://halloumi.invalid/generate', token: 't' },
    widgetDist: dist,
  });

describe('serving the built widget', () => {
  it('serves the built document rather than a hand-written placeholder', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://lecc.test/p');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/assets/widget-abc.js');
  });

  it('hands the session token to the page', async () => {
    const res = await request(appWith()).get('/w/lecc').set('Referer', 'https://lecc.test/p');
    expect(res.text).toContain('window.__CHAT_TOKEN__');
    expect(res.text).toContain('window.__CHAT_TENANT__="lecc"');
  });

  it('serves the hashed assets the document references', async () => {
    const res = await request(appWith()).get('/assets/widget-abc.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('built = true');
  });

  it('serves loader.js, which host pages reference by name', async () => {
    const res = await request(appWith()).get('/loader.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('__LOADER__');
  });

  it('does not let host pages cache loader.js indefinitely', async () => {
    // It is unhashed, so a long-lived cache would pin sites to an old loader
    // with no way to roll it forward.
    const res = await request(appWith()).get('/loader.js');
    expect(res.headers['cache-control']).toMatch(/no-cache/);
  });

  it('caches the hashed assets hard, since their names change on rebuild', async () => {
    const res = await request(appWith()).get('/assets/widget-abc.js');
    expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
  });
});
