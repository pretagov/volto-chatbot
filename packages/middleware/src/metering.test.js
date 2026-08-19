import { describe, it, expect } from 'vitest';
import { admitTurn } from './metering.js';

// Minimal Redis stand-in. Counts per key so the tenant and IP counters stay
// independent, which is what the limits rely on.
function fakeRedis({ seed = {}, fail = false } = {}) {
  const counts = { ...seed };
  return {
    counts,
    async incr(key) {
      if (fail) throw new Error('redis down');
      counts[key] = (counts[key] ?? 0) + 1;
      return counts[key];
    },
    async expire() {
      if (fail) throw new Error('redis down');
    },
  };
}

const tenant = { tenantId: 'lecc', dailyTurnCap: 5 };

describe('admitTurn', () => {
  it('admits a turn under the cap', async () => {
    const result = await admitTurn(fakeRedis(), tenant, '1.2.3.4');
    expect(result.admitted).toBe(true);
  });

  it('refuses once the tenant daily cap is reached', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < 5; i += 1) await admitTurn(redis, tenant, '1.2.3.4');
    const result = await admitTurn(redis, tenant, '1.2.3.4');
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('tenant_cap');
  });

  it('counts at admission, so an aborted stream still consumes quota', async () => {
    // Inference is billed as tokens are produced. Counting completed turns would
    // let a client abort every stream just before the end and never be metered.
    const redis = fakeRedis();
    await admitTurn(redis, tenant, '1.2.3.4');
    const key = Object.keys(redis.counts).find((k) => !k.includes(':ip:'));
    expect(redis.counts[key]).toBe(1);
  });

  it('keeps tenants independent of one another', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < 5; i += 1) await admitTurn(redis, tenant, '1.2.3.4');
    const other = await admitTurn(redis, { tenantId: 'bathnes', dailyTurnCap: 5 }, '1.2.3.4');
    expect(other.admitted).toBe(true);
  });

  it('refuses a client that exceeds the per-IP burst limit', async () => {
    const redis = fakeRedis();
    const generous = { tenantId: 'lecc', dailyTurnCap: 10000 };
    let last;
    for (let i = 0; i < 25; i += 1) last = await admitTurn(redis, generous, '9.9.9.9');
    expect(last.admitted).toBe(false);
    expect(last.reason).toBe('ip_rate');
  });

  it('fails closed when Redis is unavailable', async () => {
    // An outage is cheaper than an unbounded inference bill.
    const result = await admitTurn(fakeRedis({ fail: true }), tenant, '1.2.3.4');
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('metering_unavailable');
  });
});
